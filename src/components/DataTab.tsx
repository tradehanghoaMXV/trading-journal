import { useEffect, useState } from 'preact/hooks';
import { Cloud, Download, ExternalLink, RefreshCw, Trash2, Unplug, Upload } from 'lucide-preact';
import { exportJournalJson, importJournalJson } from '../db/journalDb';
import {
  clearGitHubSyncConfig,
  isGitHubSyncConfigured,
  loadGitHubSyncConfig,
  saveGitHubSyncConfig,
  type GitHubSyncResult,
  type GitHubSyncStatus,
} from '../db/githubSync';
import {
  getConfiguredOandaUrl,
  type FxDataSourceStatus,
  type OandaHealthResult,
} from '../providers/dukascopyPythProvider';

interface DataTabProps {
  tradeCount: number;
  noteCount: number;
  strategyCount: number;
  fxStatus: FxDataSourceStatus;
  githubSyncStatus: GitHubSyncStatus;
  onSyncGitHubNow: () => Promise<GitHubSyncResult>;
  onSaveOandaUrl: (url: string) => Promise<OandaHealthResult>;
  onClearOandaUrl: () => Promise<void>;
  onReloadData: () => Promise<void>;
  onResetWorkspace?: () => void;
  onClearAllTradesAndNotes: () => Promise<void>;
}

function formatHm(ts?: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function DataTab(props: DataTabProps) {
  const [msg, setMsg] = useState('');
  const [ghRepo, setGhRepo] = useState(() => {
    const c = loadGitHubSyncConfig();
    return `${c.owner}/${c.repo}`;
  });
  const [ghToken, setGhToken] = useState(() => loadGitHubSyncConfig().token);
  const [ghBusy, setGhBusy] = useState(false);
  const [ghFeedback, setGhFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [ghConnected, setGhConnected] = useState(() => isGitHubSyncConfigured());

  const [oandaUrl, setOandaUrl] = useState(() => getConfiguredOandaUrl());
  const [oandaBusy, setOandaBusy] = useState(false);
  const [oandaFeedback, setOandaFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    setOandaUrl(getConfiguredOandaUrl());
  }, [props.fxStatus]);

  useEffect(() => {
    setGhConnected(isGitHubSyncConfigured());
  }, [props.githubSyncStatus]);

  const parseRepoSlug = (raw: string): { owner: string; repo: string } | null => {
    const parts = raw
      .trim()
      .replace(/^https?:\/\/github\.com\//i, '')
      .replace(/\.git$/i, '')
      .split('/')
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length !== 2) return null;
    return { owner: parts[0]!, repo: parts[1]! };
  };

  const handleConnectAndSyncGitHub = async () => {
    const parsed = parseRepoSlug(ghRepo);
    if (!parsed) {
      setGhFeedback({ ok: false, text: 'Tên repo phải theo định dạng owner/repo.' });
      return;
    }
    if (!ghToken.trim()) {
      setGhFeedback({ ok: false, text: 'Vui lòng dán GitHub Fine-Grained Token.' });
      return;
    }
    setGhBusy(true);
    setGhFeedback(null);
    try {
      saveGitHubSyncConfig({
        owner: parsed.owner,
        repo: parsed.repo,
        token: ghToken.trim(),
      });
      setGhConnected(true);
      const res = await props.onSyncGitHubNow();
      if (res.ok) {
        setGhFeedback({
          ok: true,
          text: `Đã kết nối & đồng bộ ${res.tradeCount} lệnh lên ${parsed.owner}/${parsed.repo} (${formatHm(res.syncedAt)})`,
        });
      } else {
        setGhFeedback({
          ok: false,
          text: res.errorMessage || 'Không thể đồng bộ lên GitHub.',
        });
      }
    } finally {
      setGhBusy(false);
    }
  };

  const handleManualSyncGitHub = async () => {
    setGhBusy(true);
    setGhFeedback(null);
    try {
      const cfg = loadGitHubSyncConfig();
      const res = await props.onSyncGitHubNow();
      if (res.ok) {
        setGhFeedback({
          ok: true,
          text: `Đã đồng bộ ${res.tradeCount} lệnh với ${cfg.owner}/${cfg.repo} (${formatHm(res.syncedAt)})`,
        });
      } else {
        setGhFeedback({
          ok: false,
          text: res.errorMessage || 'Đồng bộ GitHub thất bại.',
        });
      }
    } finally {
      setGhBusy(false);
    }
  };

  const handleDisconnectGitHub = () => {
    clearGitHubSyncConfig();
    setGhToken('');
    setGhConnected(false);
    setGhFeedback({ ok: true, text: 'Đã ngắt kết nối GitHub Cloud.' });
  };

  const handleSaveOanda = async () => {
    setOandaBusy(true);
    setOandaFeedback(null);
    try {
      const res = await props.onSaveOandaUrl(oandaUrl);
      if (res.ok && res.connected) {
        const acct = res.accountIdMasked ? ` · TK ${res.accountIdMasked}` : '';
        setOandaFeedback({
          ok: true,
          text: `Đã kết nối OANDA (${res.env || 'practice'}${acct}) và tải lại biểu đồ.`,
        });
      } else {
        setOandaFeedback({
          ok: false,
          text: res.error || 'Không thể kết nối tới OANDA Worker.',
        });
      }
    } finally {
      setOandaBusy(false);
    }
  };

  const handleClearOanda = async () => {
    setOandaBusy(true);
    setOandaFeedback(null);
    try {
      await props.onClearOandaUrl();
      setOandaUrl('');
      setOandaFeedback({
        ok: true,
        text: 'Đã xóa URL OANDA và chuyển về nguồn dự phòng/MT5.',
      });
    } finally {
      setOandaBusy(false);
    }
  };

  const handleExport = async () => {
    const payload = await exportJournalJson();
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nhat-ky-giao-dich-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMsg('Đã xuất file JSON thành công.');
  };

  const handleImport = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      await importJournalJson(parsed);
      await props.onReloadData();
      setMsg('Đã nhập dữ liệu JSON thành công.');
    } catch (err) {
      setMsg(`Lỗi nhập JSON: ${err instanceof Error ? err.message : 'Không hợp lệ'}`);
    }
    input.value = '';
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div class="card" data-testid="github-sync-card">
        <div class="card-title">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <Cloud size={14} color="#00F59B" /> ☁️ Lưu trữ đám mây trên GitHub (Tự động đồng bộ)
          </span>
          <span
            class={`pill ${
              props.githubSyncStatus.state === 'synced'
                ? 'pill-bull'
                : props.githubSyncStatus.state === 'error'
                  ? 'pill-bear'
                  : 'pill-accent'
            }`}
            data-testid="github-card-status"
          >
            {props.githubSyncStatus.state === 'syncing'
              ? 'Đang đồng bộ'
              : props.githubSyncStatus.state === 'synced'
                ? `Đã lưu${props.githubSyncStatus.lastSyncedAt ? ` ${formatHm(props.githubSyncStatus.lastSyncedAt)}` : ''}`
                : props.githubSyncStatus.state === 'error'
                  ? 'Lỗi'
                  : 'Chưa bật'}
          </span>
        </div>

        <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginBottom: '8px', lineHeight: 1.45 }}>
          Đồng bộ toàn bộ lệnh, ảnh Before/After, ghi chú, thùng rác &amp; bố cục chart qua{' '}
          <span style={{ color: '#e2e8f0', fontWeight: 600 }}>Repo riêng tư</span> GitHub (không cần backend).
        </div>

        <label class="field-label" for="github-repo-input">
          Repo riêng tư (owner/repo)
        </label>
        <input
          id="github-repo-input"
          data-testid="github-repo-input"
          type="text"
          class="input"
          style={{ width: '100%', marginBottom: '8px' }}
          placeholder="tradehanghoaMXV/trading-journal-data"
          value={ghRepo}
          onInput={(e) => setGhRepo((e.target as HTMLInputElement).value)}
        />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
          <label class="field-label" for="github-token-input" style={{ marginBottom: 0 }}>
            GitHub Fine-Grained Token
          </label>
          <a
            href="https://github.com/settings/personal-access-tokens/new"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: '10.5px',
              color: '#38bdf8',
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '3px',
            }}
          >
            Tạo Token GitHub (chỉ cấp quyền Contents cho trading-journal-data) ↗
            <ExternalLink size={10} />
          </a>
        </div>
        <input
          id="github-token-input"
          data-testid="github-token-input"
          type="password"
          class="input"
          style={{ width: '100%', marginBottom: '8px' }}
          placeholder="github_pat_..."
          value={ghToken}
          onInput={(e) => setGhToken((e.target as HTMLInputElement).value)}
        />

        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          <button
            type="button"
            class="btn btn-primary"
            style={{ flex: 1, justifyContent: 'center' }}
            data-testid="github-connect-btn"
            disabled={ghBusy}
            onClick={handleConnectAndSyncGitHub}
          >
            {ghBusy ? 'Đang đồng bộ...' : 'Kết nối & Đồng bộ'}
          </button>
          {ghConnected && (
            <>
              <button
                type="button"
                class="btn"
                data-testid="github-sync-now-btn"
                disabled={ghBusy}
                onClick={handleManualSyncGitHub}
              >
                <RefreshCw size={12} /> Đồng bộ ngay
              </button>
              <button
                type="button"
                class="btn btn-bear"
                data-testid="github-disconnect-btn"
                disabled={ghBusy}
                onClick={handleDisconnectGitHub}
              >
                <Unplug size={12} /> Ngắt kết nối
              </button>
            </>
          )}
        </div>

        {(ghFeedback || (props.githubSyncStatus.state === 'error' && props.githubSyncStatus.errorMessage)) && (
          <div
            data-testid="github-feedback"
            class={`pill ${
              ghFeedback
                ? ghFeedback.ok
                  ? 'pill-bull'
                  : 'pill-bear'
                : 'pill-bear'
            }`}
            style={{
              marginTop: '8px',
              width: '100%',
              justifyContent: 'center',
              borderRadius: '6px',
              padding: '6px 8px',
              textAlign: 'center',
              lineHeight: 1.35,
            }}
          >
            {ghFeedback ? ghFeedback.text : props.githubSyncStatus.errorMessage}
          </div>
        )}
      </div>

      <div class="card" data-testid="oanda-config-card">
        <div class="card-title">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <Cloud size={14} color="#38bdf8" /> Nguồn giá XAU/Forex 24/7 (OANDA Worker)
          </span>
          <span
            class={`pill ${props.fxStatus.mode === 'oanda' ? 'pill-bull' : 'pill-accent'}`}
            data-testid="oanda-card-status"
          >
            {props.fxStatus.mode === 'oanda'
              ? 'OANDA Live'
              : props.fxStatus.mode === 'mt5'
                ? 'MT5 Local'
                : 'Dukascopy'}
          </span>
        </div>
        <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginBottom: '8px', lineHeight: 1.45 }}>
          Dán URL Cloudflare Worker (<code>cloudflare-worker/worker.js</code>) để xem XAUUSD &amp; Forex 24/7 khớp TradingView <code>OANDA:XAUUSD</code> mà không cần mở Windows/MT5.
        </div>
        <label class="field-label" for="oanda-worker-url-input">
          Cloudflare Worker URL
        </label>
        <input
          id="oanda-worker-url-input"
          data-testid="oanda-url-input"
          type="url"
          class="input"
          style={{ width: '100%', marginBottom: '8px' }}
          placeholder="https://oanda-xau.xxx.workers.dev"
          value={oandaUrl}
          onInput={(e) => setOandaUrl((e.target as HTMLInputElement).value)}
        />
        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            type="button"
            class="btn btn-primary"
            style={{ flex: 1, justifyContent: 'center' }}
            data-testid="oanda-save-btn"
            disabled={oandaBusy}
            onClick={handleSaveOanda}
          >
            {oandaBusy ? 'Đang kiểm tra...' : 'Lưu & Kết nối'}
          </button>
          {(oandaUrl.trim().length > 0 || props.fxStatus.mode === 'oanda') && (
            <button
              type="button"
              class="btn"
              data-testid="oanda-clear-btn"
              disabled={oandaBusy}
              onClick={handleClearOanda}
            >
              Xóa URL
            </button>
          )}
        </div>
        {oandaFeedback && (
          <div
            data-testid="oanda-feedback"
            class={`pill ${oandaFeedback.ok ? 'pill-bull' : 'pill-bear'}`}
            style={{
              marginTop: '8px',
              width: '100%',
              justifyContent: 'center',
              borderRadius: '6px',
              padding: '6px 8px',
              textAlign: 'center',
              lineHeight: 1.35,
            }}
          >
            {oandaFeedback.text}
          </div>
        )}
      </div>

      <div class="card">
        <div class="card-title">Trạng thái IndexedDB (Dexie)</div>
        <div style={{ fontSize: '12px', color: '#cbd5e1', lineHeight: 1.7 }}>
          <div>• Trường phái: <strong>{props.strategyCount}</strong></div>
          <div>• Lệnh đã lưu: <strong>{props.tradeCount}</strong></div>
          <div>• Ghi chú trên chart: <strong>{props.noteCount}</strong></div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Sao lưu & Khôi phục JSON</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <button class="btn btn-primary" style={{ justifyContent: 'center' }} onClick={handleExport}>
            <Download size={14} /> Xuất toàn bộ dữ liệu (JSON)
          </button>

          <label class="btn" style={{ justifyContent: 'center', cursor: 'pointer' }}>
            <Upload size={14} /> Nhập dữ liệu từ JSON
            <input
              type="file"
              accept=".json,application/json"
              style={{ display: 'none' }}
              onChange={handleImport}
            />
          </label>

          {props.onResetWorkspace && (
            <button
              class="btn"
              style={{ justifyContent: 'center' }}
              data-testid="reset-workspace-btn"
              onClick={() => {
                props.onResetWorkspace?.();
                setMsg('Đã đặt lại bố cục biểu đồ về mặc định (1 biểu đồ).');
              }}
            >
              Đặt lại bố cục biểu đồ
            </button>
          )}

          <button
            class="btn btn-bear"
            style={{ justifyContent: 'center' }}
            onClick={async () => {
              await props.onClearAllTradesAndNotes();
              setMsg('Đã xóa toàn bộ lệnh và ghi chú.');
            }}
          >
            <Trash2 size={14} /> Xóa toàn bộ lệnh & ghi chú
          </button>

          {msg && (
            <div class="pill pill-accent" style={{ justifyContent: 'center' }}>
              {msg}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
