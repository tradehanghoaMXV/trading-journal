export type WorkspaceLayout = '1' | '2h' | '4';

export interface PersistedIndicator {
  type: string;
  inputs?: Record<string, unknown>;
}

export interface PersistedPaneState {
  symbol: string;
  timeframe: string;
  drawings?: unknown;
  indicators?: PersistedIndicator[];
}

export interface PersistedWorkspaceState {
  version: 1;
  layout: WorkspaceLayout;
  activePaneIndex: number;
  panes: PersistedPaneState[];
}

export const WORKSPACE_STORAGE_KEY = 'tj_workspace_state_v1';
const LEGACY_VELA_PERSIST_KEY = 'trading-journal-ws-v1';

export const PANE_IDS = ['pane-1', 'pane-2', 'pane-3', 'pane-4'] as const;

export function layoutPaneCount(layout: WorkspaceLayout): number {
  if (layout === '4') return 4;
  if (layout === '2h') return 2;
  return 1;
}

export function normalizeLayout(raw: unknown): WorkspaceLayout {
  if (raw === '2h' || raw === '4' || raw === '1') return raw;
  return '1';
}

export function createDefaultPaneState(symbol = 'BTCUSDT', timeframe = '60'): PersistedPaneState {
  return { symbol, timeframe };
}

export function createDefaultWorkspaceState(): PersistedWorkspaceState {
  return {
    version: 1,
    layout: '1',
    activePaneIndex: 0,
    panes: [
      createDefaultPaneState('BTCUSDT', '60'),
      createDefaultPaneState('BTCUSDT', '60'),
      createDefaultPaneState('BTCUSDT', '60'),
      createDefaultPaneState('BTCUSDT', '60'),
    ],
  };
}

function sanitizePane(raw: unknown, fallbackSymbol = 'BTCUSDT', fallbackTimeframe = '60'): PersistedPaneState {
  if (!raw || typeof raw !== 'object') {
    return createDefaultPaneState(fallbackSymbol, fallbackTimeframe);
  }
  const obj = raw as Record<string, unknown>;
  const symbol =
    typeof obj.symbol === 'string' && obj.symbol.trim().length > 0
      ? obj.symbol.trim().toUpperCase()
      : fallbackSymbol;
  const timeframe =
    typeof obj.timeframe === 'string' && obj.timeframe.trim().length > 0
      ? obj.timeframe.trim()
      : fallbackTimeframe;

  const pane: PersistedPaneState = { symbol, timeframe };

  if (obj.drawings && typeof obj.drawings === 'object') {
    pane.drawings = obj.drawings;
  }

  if (Array.isArray(obj.indicators)) {
    const validIndicators: PersistedIndicator[] = [];
    for (const item of obj.indicators) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      if (typeof rec.type !== 'string' || rec.type.trim().length === 0) continue;
      const entry: PersistedIndicator = { type: rec.type };
      if (rec.inputs && typeof rec.inputs === 'object' && !Array.isArray(rec.inputs)) {
        entry.inputs = { ...(rec.inputs as Record<string, unknown>) };
      }
      validIndicators.push(entry);
    }
    pane.indicators = validIndicators;
  }

  return pane;
}

export function sanitizeWorkspaceState(raw: unknown): PersistedWorkspaceState | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const layout = normalizeLayout(obj.layout);
  const rawPanes = Array.isArray(obj.panes) ? obj.panes : [];
  const panes: PersistedPaneState[] = [];
  for (let i = 0; i < 4; i++) {
    panes.push(sanitizePane(rawPanes[i]));
  }
  const maxActive = layoutPaneCount(layout) - 1;
  const rawActive = typeof obj.activePaneIndex === 'number' && Number.isFinite(obj.activePaneIndex)
    ? Math.floor(obj.activePaneIndex)
    : 0;
  const activePaneIndex = Math.max(0, Math.min(maxActive, rawActive));

  return {
    version: 1,
    layout,
    activePaneIndex,
    panes,
  };
}

export function loadWorkspaceState(): PersistedWorkspaceState {
  try {
    const raw = localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (!raw) return createDefaultWorkspaceState();
    const parsed = JSON.parse(raw);
    return sanitizeWorkspaceState(parsed) ?? createDefaultWorkspaceState();
  } catch {
    return createDefaultWorkspaceState();
  }
}

export function saveWorkspaceState(state: PersistedWorkspaceState): void {
  try {
    localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore quota / privacy errors
  }
}

export function resetWorkspaceState(): PersistedWorkspaceState {
  const fresh = createDefaultWorkspaceState();
  try {
    localStorage.removeItem(WORKSPACE_STORAGE_KEY);
    localStorage.removeItem(LEGACY_VELA_PERSIST_KEY);
  } catch {
    // ignore
  }
  saveWorkspaceState(fresh);
  return fresh;
}
