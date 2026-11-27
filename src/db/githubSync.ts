import {
  hasSavedWorkspaceState,
  loadWorkspaceState,
  sanitizeWorkspaceState,
  saveWorkspaceState,
  type PersistedWorkspaceState,
} from '../chart/workspacePersistence';
import {
  db,
  exportJournalJson,
  type ChartNote,
  type DrawingRecord,
  type JournalExportPayload,
  type Strategy,
  type Trade,
} from './journalDb';

export const GITHUB_SYNC_CONFIG_KEY = 'tj_github_sync_v1';
export const DEFAULT_GITHUB_OWNER = 'tradehanghoaMXV';
export const DEFAULT_GITHUB_REPO = 'trading-journal-data';
export const DEFAULT_GITHUB_BRANCH = 'main';
export const DEFAULT_GITHUB_API_BASE = 'https://api.github.com';
const JOURNAL_FILE_PATH = 'journal.json';
const PUSH_DEBOUNCE_MS = 2500;

export interface GitHubSyncConfig {
  owner: string;
  repo: string;
  branch: string;
  token: string;
  apiBase?: string;
}

export type GitHubSyncState = 'unconfigured' | 'syncing' | 'synced' | 'error';

export interface GitHubSyncStatus {
  state: GitHubSyncState;
  lastSyncedAt?: number;
  errorMessage?: string;
}

export interface GitHubSyncResult {
  ok: boolean;
  tradeCount: number;
  noteCount: number;
  strategyCount: number;
  workspaceRestored: boolean;
  syncedAt: number;
  errorMessage?: string;
}

let currentStatus: GitHubSyncStatus = {
  state: isGitHubSyncConfigured() ? 'synced' : 'unconfigured',
};

const statusListeners = new Set<(status: GitHubSyncStatus) => void>();
let debounceTimer: number | null = null;
let inFlightSync: Promise<GitHubSyncResult> | null = null;
let pendingPushAfterFlight = false;
let lastKnownSha: string | undefined;

function emitStatus(next: GitHubSyncStatus): void {
  currentStatus = next;
  for (const cb of statusListeners) {
    try {
      cb(next);
    } catch {
      // ignore listener errors
    }
  }
}

export function getGitHubSyncStatus(): GitHubSyncStatus {
  return currentStatus;
}

export function onGitHubSyncStatusChange(
  listener: (status: GitHubSyncStatus) => void
): () => void {
  statusListeners.add(listener);
  listener(currentStatus);
  return () => {
    statusListeners.delete(listener);
  };
}

function normalizeApiBase(raw?: string): string {
  const trimmed = (raw ?? '').trim().replace(/\/+$/, '');
  return trimmed || DEFAULT_GITHUB_API_BASE;
}

export function loadGitHubSyncConfig(): GitHubSyncConfig {
  try {
    const raw = localStorage.getItem(GITHUB_SYNC_CONFIG_KEY);
    if (!raw) {
      return {
        owner: DEFAULT_GITHUB_OWNER,
        repo: DEFAULT_GITHUB_REPO,
        branch: DEFAULT_GITHUB_BRANCH,
        token: '',
        apiBase: DEFAULT_GITHUB_API_BASE,
      };
    }
    const parsed = JSON.parse(raw) as Partial<GitHubSyncConfig>;
    return {
      owner: (parsed.owner ?? DEFAULT_GITHUB_OWNER).trim() || DEFAULT_GITHUB_OWNER,
      repo: (parsed.repo ?? DEFAULT_GITHUB_REPO).trim() || DEFAULT_GITHUB_REPO,
      branch: (parsed.branch ?? DEFAULT_GITHUB_BRANCH).trim() || DEFAULT_GITHUB_BRANCH,
      token: (parsed.token ?? '').trim(),
      apiBase: normalizeApiBase(parsed.apiBase),
    };
  } catch {
    return {
      owner: DEFAULT_GITHUB_OWNER,
      repo: DEFAULT_GITHUB_REPO,
      branch: DEFAULT_GITHUB_BRANCH,
      token: '',
      apiBase: DEFAULT_GITHUB_API_BASE,
    };
  }
}

export function isGitHubSyncConfigured(cfg?: GitHubSyncConfig): boolean {
  const c = cfg ?? loadGitHubSyncConfig();
  return Boolean(c.owner.trim() && c.repo.trim() && c.branch.trim() && c.token.trim());
}

export function saveGitHubSyncConfig(partial: Partial<GitHubSyncConfig>): GitHubSyncConfig {
  const prev = loadGitHubSyncConfig();
  const next: GitHubSyncConfig = {
    owner: (partial.owner ?? prev.owner).trim() || DEFAULT_GITHUB_OWNER,
    repo: (partial.repo ?? prev.repo).trim() || DEFAULT_GITHUB_REPO,
    branch: (partial.branch ?? prev.branch).trim() || DEFAULT_GITHUB_BRANCH,
    token: (partial.token ?? prev.token).trim(),
    apiBase: normalizeApiBase(partial.apiBase ?? prev.apiBase),
  };
  try {
    localStorage.setItem(GITHUB_SYNC_CONFIG_KEY, JSON.stringify(next));
  } catch {
    // ignore storage errors
  }
  lastKnownSha = undefined;
  if (!isGitHubSyncConfigured(next)) {
    emitStatus({ state: 'unconfigured' });
  }
  return next;
}

export function clearGitHubSyncConfig(): void {
  if (debounceTimer !== null) {
    window.clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  pendingPushAfterFlight = false;
  lastKnownSha = undefined;
  const prev = loadGitHubSyncConfig();
  const cleared: GitHubSyncConfig = {
    owner: prev.owner || DEFAULT_GITHUB_OWNER,
    repo: prev.repo || DEFAULT_GITHUB_REPO,
    branch: prev.branch || DEFAULT_GITHUB_BRANCH,
    token: '',
    apiBase: prev.apiBase || DEFAULT_GITHUB_API_BASE,
  };
  try {
    localStorage.setItem(GITHUB_SYNC_CONFIG_KEY, JSON.stringify(cleared));
  } catch {
    // ignore
  }
  emitStatus({ state: 'unconfigured' });
}

export function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  const chunkSize = 0x4000;
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    chunks.push(String.fromCharCode(...slice));
  }
  return btoa(chunks.join(''));
}

export function base64ToUtf8(b64: string): string {
  const clean = b64.replace(/\s+/g, '');
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

function contentsUrl(cfg: GitHubSyncConfig, withRef = false): string {
  const base = normalizeApiBase(cfg.apiBase);
  const owner = encodeURIComponent(cfg.owner.trim());
  const repo = encodeURIComponent(cfg.repo.trim());
  const url = `${base}/repos/${owner}/${repo}/contents/${JOURNAL_FILE_PATH}`;
  return withRef ? `${url}?ref=${encodeURIComponent(cfg.branch.trim())}` : url;
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
  };
}

interface RemoteJournalFetch {
  exists: boolean;
  sha?: string;
  payload?: JournalExportPayload;
}

async function fetchRemoteJournal(cfg: GitHubSyncConfig): Promise<RemoteJournalFetch> {
  const res = await fetch(contentsUrl(cfg, true), {
    method: 'GET',
    headers: authHeaders(cfg.token),
    cache: 'no-store',
  });

  if (res.status === 404) {
    return { exists: false };
  }

  if (!res.ok) {
    throw new Error(formatGitHubHttpError(res.status, await safeReadErrorMessage(res)));
  }

  const data = (await res.json()) as {
    sha?: string;
    content?: string;
    encoding?: string;
    download_url?: string;
  };

  let rawJson = '';
  if (typeof data.content === 'string' && data.content.length > 0) {
    rawJson = base64ToUtf8(data.content);
  } else if (typeof data.download_url === 'string' && data.download_url.length > 0) {
    const dl = await fetch(data.download_url, { cache: 'no-store' });
    if (!dl.ok) {
      throw new Error(`Không tải được journal.json từ GitHub (HTTP ${dl.status}).`);
    }
    rawJson = await dl.text();
  } else {
    return { exists: true, sha: data.sha };
  }

  const parsed = JSON.parse(rawJson) as JournalExportPayload;
  return {
    exists: true,
    sha: data.sha,
    payload: parsed,
  };
}

async function putRemoteJournal(
  cfg: GitHubSyncConfig,
  payload: JournalExportPayload,
  sha?: string
): Promise<{ status: number; sha?: string; errorText?: string }> {
  const body: Record<string, unknown> = {
    message: `sync: update journal.json (${new Date(payload.exportedAt).toISOString()})`,
    content: utf8ToBase64(JSON.stringify(payload)),
    branch: cfg.branch.trim(),
  };
  if (sha) {
    body.sha = sha;
  }

  const res = await fetch(contentsUrl(cfg, false), {
    method: 'PUT',
    headers: {
      ...authHeaders(cfg.token),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (res.status === 409 || res.status === 422) {
    return { status: res.status, errorText: await safeReadErrorMessage(res) };
  }

  if (!res.ok) {
    throw new Error(formatGitHubHttpError(res.status, await safeReadErrorMessage(res)));
  }

  const json = (await res.json()) as { content?: { sha?: string } };
  return {
    status: res.status,
    sha: json.content?.sha,
  };
}

async function safeReadErrorMessage(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { message?: string };
    return data?.message || '';
  } catch {
    return '';
  }
}

function formatGitHubHttpError(status: number, detail: string): string {
  if (status === 401) {
    return 'Token GitHub không hợp lệ hoặc đã hết hạn (401).';
  }
  if (status === 403) {
    return 'Token thiếu quyền Contents (Read & Write) hoặc bị giới hạn rate limit (403).';
  }
  if (status === 404) {
    return 'Không tìm thấy repo/branch hoặc token chưa được cấp quyền truy cập repo (404).';
  }
  return detail ? `Lỗi GitHub (${status}): ${detail}` : `Lỗi GitHub HTTP ${status}.`;
}

function itemTimestamp(item: {
  updatedAt?: number;
  deletedAt?: number;
  createdAt?: number;
}): number {
  return item.updatedAt ?? item.deletedAt ?? item.createdAt ?? 0;
}

function mergeById<T extends { id: string; updatedAt?: number; deletedAt?: number; createdAt?: number }>(
  localItems: T[],
  remoteItems: T[]
): { merged: T[]; localHasChanges: boolean; remoteHasChanges: boolean } {
  const map = new Map<string, T>();
  const localMap = new Map<string, T>();
  const remoteMap = new Map<string, T>();

  for (const item of localItems) {
    localMap.set(item.id, item);
    map.set(item.id, item);
  }
  for (const item of remoteItems) {
    remoteMap.set(item.id, item);
    const existing = map.get(item.id);
    if (!existing) {
      map.set(item.id, item);
    } else {
      const rTs = itemTimestamp(item);
      const lTs = itemTimestamp(existing);
      if (rTs > lTs) {
        map.set(item.id, item);
      }
    }
  }

  let localHasChanges = false;
  let remoteHasChanges = false;
  for (const [id, winner] of map.entries()) {
    const l = localMap.get(id);
    const r = remoteMap.get(id);
    if (!l || itemTimestamp(winner) > itemTimestamp(l)) {
      localHasChanges = true;
    }
    if (!r || itemTimestamp(winner) > itemTimestamp(r)) {
      remoteHasChanges = true;
    }
  }

  return {
    merged: Array.from(map.values()),
    localHasChanges,
    remoteHasChanges,
  };
}

function mergeDrawings(
  localDrawings: DrawingRecord[],
  remoteDrawings: DrawingRecord[]
): { merged: DrawingRecord[]; remoteHasChanges: boolean } {
  const map = new Map<string, DrawingRecord>();
  const remoteMap = new Map<string, DrawingRecord>();
  for (const d of localDrawings) map.set(d.symbol, d);
  for (const d of remoteDrawings) {
    remoteMap.set(d.symbol, d);
    const existing = map.get(d.symbol);
    if (!existing || (d.updatedAt ?? 0) > (existing.updatedAt ?? 0)) {
      map.set(d.symbol, d);
    }
  }
  let remoteHasChanges = false;
  for (const [sym, winner] of map.entries()) {
    const r = remoteMap.get(sym);
    if (!r || (winner.updatedAt ?? 0) > (r.updatedAt ?? 0)) {
      remoteHasChanges = true;
    }
  }
  return { merged: Array.from(map.values()), remoteHasChanges };
}

async function applyMergedToLocalDb(
  strategies: Strategy[],
  trades: Trade[],
  notes: ChartNote[],
  drawings: DrawingRecord[]
): Promise<void> {
  await db.transaction('rw', db.strategies, db.trades, db.notes, db.drawings, async () => {
    if (strategies.length > 0) await db.strategies.bulkPut(strategies);
    if (trades.length > 0) await db.trades.bulkPut(trades);
    if (notes.length > 0) await db.notes.bulkPut(notes);
    if (drawings.length > 0) await db.drawings.bulkPut(drawings);
  });
}

async function mergeWithRemotePayload(remote: JournalExportPayload): Promise<{
  mergedPayload: JournalExportPayload;
  workspaceRestored: boolean;
  needsPush: boolean;
}> {
  const local = await exportJournalJson();
  const sMerge = mergeById(local.strategies, Array.isArray(remote.strategies) ? remote.strategies : []);
  const tMerge = mergeById(local.trades, Array.isArray(remote.trades) ? remote.trades : []);
  const nMerge = mergeById(local.notes, Array.isArray(remote.notes) ? remote.notes : []);
  const dMerge = mergeDrawings(local.drawings, Array.isArray(remote.drawings) ? remote.drawings : []);

  await applyMergedToLocalDb(sMerge.merged, tMerge.merged, nMerge.merged, dMerge.merged);

  let workspaceState: PersistedWorkspaceState | undefined = local.workspaceState;
  let workspaceRestored = false;
  let workspaceNeedsPush = false;

  const cleanRemoteWs = remote.workspaceState
    ? sanitizeWorkspaceState(remote.workspaceState)
    : null;

  if (cleanRemoteWs) {
    const localExists = hasSavedWorkspaceState();
    const localWsTs = local.workspaceState?.updatedAt ?? 0;
    const remoteWsTs = cleanRemoteWs.updatedAt ?? remote.exportedAt ?? 0;
    if (!localExists || remoteWsTs > localWsTs) {
      saveWorkspaceState(cleanRemoteWs, { silent: true });
      workspaceState = cleanRemoteWs;
      workspaceRestored = true;
    } else if (localWsTs > remoteWsTs) {
      workspaceNeedsPush = true;
    }
  } else if (hasSavedWorkspaceState()) {
    workspaceNeedsPush = true;
  }

  const mergedPayload: JournalExportPayload = {
    version: 1,
    exportedAt: Date.now(),
    strategies: sMerge.merged,
    trades: tMerge.merged,
    notes: nMerge.merged,
    drawings: dMerge.merged,
    workspaceState,
  };

  const needsPush =
    sMerge.remoteHasChanges ||
    tMerge.remoteHasChanges ||
    nMerge.remoteHasChanges ||
    dMerge.remoteHasChanges ||
    workspaceNeedsPush;

  return { mergedPayload, workspaceRestored, needsPush };
}

async function runSerializedSync<T>(fn: () => Promise<T>): Promise<T> {
  if (inFlightSync) {
    await inFlightSync.catch(() => undefined);
  }
  const p = fn();
  inFlightSync = p as unknown as Promise<GitHubSyncResult>;
  try {
    return await p;
  } finally {
    if (inFlightSync === (p as unknown as Promise<GitHubSyncResult>)) {
      inFlightSync = null;
    }
    if (pendingPushAfterFlight) {
      pendingPushAfterFlight = false;
      schedulePushToGitHub();
    }
  }
}

export async function pullFromGitHub(): Promise<GitHubSyncResult> {
  const cfg = loadGitHubSyncConfig();
  if (!isGitHubSyncConfigured(cfg)) {
    emitStatus({ state: 'unconfigured' });
    return {
      ok: false,
      tradeCount: 0,
      noteCount: 0,
      strategyCount: 0,
      workspaceRestored: false,
      syncedAt: Date.now(),
      errorMessage: 'Chưa cấu hình GitHub Token.',
    };
  }

  return runSerializedSync(async () => {
    emitStatus({ state: 'syncing', lastSyncedAt: currentStatus.lastSyncedAt });
    try {
      const remote = await fetchRemoteJournal(cfg);
      if (!remote.exists || !remote.payload || remote.payload.version !== 1) {
        const localPayload = await exportJournalJson();
        const putRes = await putRemoteJournal(cfg, localPayload, remote.sha);
        if (putRes.status === 409 || putRes.status === 422) {
          const retryRemote = await fetchRemoteJournal(cfg);
          if (retryRemote.payload && retryRemote.payload.version === 1) {
            const { mergedPayload, workspaceRestored } = await mergeWithRemotePayload(
              retryRemote.payload
            );
            const retryPut = await putRemoteJournal(cfg, mergedPayload, retryRemote.sha);
            lastKnownSha = retryPut.sha ?? retryRemote.sha;
            const now = Date.now();
            emitStatus({ state: 'synced', lastSyncedAt: now });
            return {
              ok: true,
              tradeCount: mergedPayload.trades.filter((t) => !t.deletedAt).length,
              noteCount: mergedPayload.notes.length,
              strategyCount: mergedPayload.strategies.length,
              workspaceRestored,
              syncedAt: now,
            };
          }
        }
        lastKnownSha = putRes.sha;
        const now = Date.now();
        emitStatus({ state: 'synced', lastSyncedAt: now });
        return {
          ok: true,
          tradeCount: localPayload.trades.filter((t) => !t.deletedAt).length,
          noteCount: localPayload.notes.length,
          strategyCount: localPayload.strategies.length,
          workspaceRestored: false,
          syncedAt: now,
        };
      }

      lastKnownSha = remote.sha;
      const { mergedPayload, workspaceRestored, needsPush } = await mergeWithRemotePayload(
        remote.payload
      );

      if (needsPush) {
        let putRes = await putRemoteJournal(cfg, mergedPayload, remote.sha);
        if (putRes.status === 409 || putRes.status === 422) {
          const freshRemote = await fetchRemoteJournal(cfg);
          if (freshRemote.payload && freshRemote.payload.version === 1) {
            const remerged = await mergeWithRemotePayload(freshRemote.payload);
            putRes = await putRemoteJournal(cfg, remerged.mergedPayload, freshRemote.sha);
          } else {
            putRes = await putRemoteJournal(cfg, mergedPayload, freshRemote.sha);
          }
        }
        if (putRes.sha) {
          lastKnownSha = putRes.sha;
        }
      }

      const now = Date.now();
      emitStatus({ state: 'synced', lastSyncedAt: now });
      return {
        ok: true,
        tradeCount: mergedPayload.trades.filter((t) => !t.deletedAt).length,
        noteCount: mergedPayload.notes.length,
        strategyCount: mergedPayload.strategies.length,
        workspaceRestored,
        syncedAt: now,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Không thể đồng bộ GitHub.';
      emitStatus({ state: 'error', lastSyncedAt: currentStatus.lastSyncedAt, errorMessage: msg });
      return {
        ok: false,
        tradeCount: 0,
        noteCount: 0,
        strategyCount: 0,
        workspaceRestored: false,
        syncedAt: Date.now(),
        errorMessage: msg,
      };
    }
  });
}

export async function pushToGitHub(): Promise<GitHubSyncResult> {
  const cfg = loadGitHubSyncConfig();
  if (!isGitHubSyncConfigured(cfg)) {
    emitStatus({ state: 'unconfigured' });
    return {
      ok: false,
      tradeCount: 0,
      noteCount: 0,
      strategyCount: 0,
      workspaceRestored: false,
      syncedAt: Date.now(),
      errorMessage: 'Chưa cấu hình GitHub Token.',
    };
  }

  return runSerializedSync(async () => {
    emitStatus({ state: 'syncing', lastSyncedAt: currentStatus.lastSyncedAt });
    try {
      let shaToUse = lastKnownSha;
      let payloadToPush = await exportJournalJson();
      let workspaceRestored = false;

      if (!shaToUse) {
        const remote = await fetchRemoteJournal(cfg);
        shaToUse = remote.sha;
        if (remote.exists && remote.payload && remote.payload.version === 1) {
          const merged = await mergeWithRemotePayload(remote.payload);
          payloadToPush = merged.mergedPayload;
          workspaceRestored = merged.workspaceRestored;
        }
      }

      let putRes = await putRemoteJournal(cfg, payloadToPush, shaToUse);
      if (putRes.status === 409 || putRes.status === 422) {
        const freshRemote = await fetchRemoteJournal(cfg);
        if (freshRemote.exists && freshRemote.payload && freshRemote.payload.version === 1) {
          const remerged = await mergeWithRemotePayload(freshRemote.payload);
          payloadToPush = remerged.mergedPayload;
          workspaceRestored = workspaceRestored || remerged.workspaceRestored;
        }
        putRes = await putRemoteJournal(cfg, payloadToPush, freshRemote.sha);
        if (putRes.status === 409 || putRes.status === 422) {
          throw new Error(`Xung đột phiên bản trên GitHub (${putRes.status}). Hãy thử đồng bộ lại.`);
        }
      }

      if (putRes.sha) {
        lastKnownSha = putRes.sha;
      }
      const now = Date.now();
      emitStatus({ state: 'synced', lastSyncedAt: now });
      return {
        ok: true,
        tradeCount: payloadToPush.trades.filter((t) => !t.deletedAt).length,
        noteCount: payloadToPush.notes.length,
        strategyCount: payloadToPush.strategies.length,
        workspaceRestored,
        syncedAt: now,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Không thể đẩy dữ liệu lên GitHub.';
      emitStatus({ state: 'error', lastSyncedAt: currentStatus.lastSyncedAt, errorMessage: msg });
      return {
        ok: false,
        tradeCount: 0,
        noteCount: 0,
        strategyCount: 0,
        workspaceRestored: false,
        syncedAt: Date.now(),
        errorMessage: msg,
      };
    }
  });
}

export function schedulePushToGitHub(): void {
  if (!isGitHubSyncConfigured()) return;
  if (inFlightSync) {
    pendingPushAfterFlight = true;
    return;
  }
  if (debounceTimer !== null) {
    window.clearTimeout(debounceTimer);
  }
  debounceTimer = window.setTimeout(() => {
    debounceTimer = null;
    void pushToGitHub();
  }, PUSH_DEBOUNCE_MS);
}
