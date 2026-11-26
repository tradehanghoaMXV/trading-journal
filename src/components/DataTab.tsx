import { useEffect, useState } from 'preact/hooks';
import { Cloud, Download, Trash2, Upload } from 'lucide-preact';
import { exportJournalJson, importJournalJson } from '../db/journalDb';
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
  onSaveOandaUrl: (url: string) => Promise<OandaHealthResult>;
  onClearOandaUrl: () => Promise<void>;
  onReloadData: () => Promise<void>;
  onResetWorkspace?: () => void;
  onClearAllTradesAndNotes: () => Promise<void>;
}

export function DataTab(props: DataTabProps) {
  const [msg, setMsg] = useState('');
  const [oandaUrl, setOandaUrl] = useState(() => getConfiguredOandaUrl());
  const [oandaBusy, setOandaBusy] = useState(false);
  const [oandaFeedback, setOandaFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    setOandaUrl(getConfiguredOandaUrl());
  }, [props.fxStatus]);

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
