import { useEffect, useState } from 'preact/hooks';
import {
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Columns2,
  PenLine,
  Plus,
  Trash2,
  X,
} from 'lucide-preact';
import {
  computeRMultiple,
  type Strategy,
  type Trade,
  type TradeMode,
  type TradeSide,
} from '../db/journalDb';
import { formatPrice } from '../config/symbols';

export interface TradeFormSeed {
  id?: string;
  side: TradeSide;
  mode: TradeMode;
  symbol: string;
  timeframe: string;
  entryTime: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
}

interface TradesTabProps {
  symbol: string;
  timeframe: string;
  lastPrice: number | null;
  replayActive: boolean;
  strategies: Strategy[];
  trades: Trade[];
  seed: TradeFormSeed | null;
  selectedTradeId: string | null;
  onSelectTrade: (id: string | null) => void;
  onSaveTrade: (trade: Trade) => Promise<void>;
  onDeleteTrade: (id: string) => Promise<void>;
  onClearSeed: () => void;
  onCaptureChart: () => Promise<string>;
  onGetDrawings: () => unknown;
  onRestoreDrawings: (doc: unknown) => boolean;
}

const EMOTIONS = ['Kỷ luật', 'Tự tin', 'Lo lắng', 'FOMO', 'Nóng vội', 'Bình tĩnh'];
const MISTAKE_OPTIONS = [
  'Vào sớm chưa chờ xác nhận',
  'Dời SL xa hơn kế hoạch',
  'Vào khối lượng quá lớn',
  'FOMO đuổi giá',
  'Bỏ qua checklist',
];

function formatShortTime(ts?: number): string {
  if (!ts) return '';
  return new Date(ts).toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function TradesTab(props: TradesTabProps) {
  const defaultStrat = props.strategies[0];
  const [editingId, setEditingId] = useState<string | null>(null);
  const [side, setSide] = useState<TradeSide>('long');
  const [mode, setMode] = useState<TradeMode>(props.replayActive ? 'replay' : 'live');
  const [entryTime, setEntryTime] = useState<number>(Date.now());
  const [entryPrice, setEntryPrice] = useState<string>('');
  const [stopLoss, setStopLoss] = useState<string>('');
  const [takeProfit, setTakeProfit] = useState<string>('');
  const [exitPrice, setExitPrice] = useState<string>('');
  const [status, setStatus] = useState<'open' | 'closed'>('open');
  const [strategyId, setStrategyId] = useState<string>(defaultStrat?.id ?? '');
  const [checklist, setChecklist] = useState<boolean[]>(
    defaultStrat ? defaultStrat.rules.map(() => false) : []
  );
  const [emotion, setEmotion] = useState<string>('Kỷ luật');
  const [mistakes, setMistakes] = useState<string[]>([]);
  const [notes, setNotes] = useState<string>('');
  const [beforeImage, setBeforeImage] = useState<string | undefined>(undefined);
  const [afterImage, setAfterImage] = useState<string | undefined>(undefined);
  const [beforeCapturedAt, setBeforeCapturedAt] = useState<number | undefined>(undefined);
  const [afterCapturedAt, setAfterCapturedAt] = useState<number | undefined>(undefined);
  const [drawingsSnapshot, setDrawingsSnapshot] = useState<unknown>(undefined);

  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [showAllSymbols, setShowAllSymbols] = useState(false);
  const [compareTrade, setCompareTrade] = useState<Trade | null>(null);

  const activeStrat =
    props.strategies.find((s) => s.id === strategyId) ?? props.strategies[0];

  useEffect(() => {
    if (!strategyId && props.strategies[0]) {
      setStrategyId(props.strategies[0].id);
      setChecklist(props.strategies[0].rules.map(() => false));
    }
  }, [props.strategies, strategyId]);

  useEffect(() => {
    if (props.seed) {
      setEditingId(props.seed.id ?? null);
      setSide(props.seed.side);
      setMode(props.seed.mode);
      setEntryTime(props.seed.entryTime);
      setEntryPrice(String(props.seed.entryPrice));
      setStopLoss(String(props.seed.stopLoss));
      setTakeProfit(String(props.seed.takeProfit));
      setExitPrice('');
      setStatus('open');
    }
  }, [props.seed]);

  useEffect(() => {
    if (!compareTrade) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCompareTrade(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [compareTrade]);

  const loadTradeIntoForm = (t: Trade) => {
    setEditingId(t.id);
    setSide(t.side);
    setMode(t.mode);
    setEntryTime(t.entryTime);
    setEntryPrice(String(t.entryPrice));
    setStopLoss(String(t.stopLoss));
    setTakeProfit(String(t.takeProfit));
    setExitPrice(t.exitPrice != null ? String(t.exitPrice) : '');
    setStatus(t.status);
    setStrategyId(t.strategyId);
    setChecklist(t.checklist);
    setEmotion(t.emotion || 'Kỷ luật');
    setMistakes(t.mistakes || []);
    setNotes(t.notes || '');
    setBeforeImage(t.beforeImage);
    setAfterImage(t.afterImage);
    setBeforeCapturedAt(t.beforeCapturedAt);
    setAfterCapturedAt(t.afterCapturedAt);
    setDrawingsSnapshot(t.drawingsSnapshot);
    props.onSelectTrade(t.id);
  };

  const resetForm = () => {
    setEditingId(null);
    const p = props.lastPrice ?? 0;
    setSide('long');
    setMode(props.replayActive ? 'replay' : 'live');
    setEntryTime(Date.now());
    setEntryPrice(p ? String(p) : '');
    setStopLoss(p ? String(Number((p * 0.99).toFixed(4))) : '');
    setTakeProfit(p ? String(Number((p * 1.02).toFixed(4))) : '');
    setExitPrice('');
    setStatus('open');
    setChecklist(activeStrat ? activeStrat.rules.map(() => false) : []);
    setEmotion('Kỷ luật');
    setMistakes([]);
    setNotes('');
    setBeforeImage(undefined);
    setAfterImage(undefined);
    setBeforeCapturedAt(undefined);
    setAfterCapturedAt(undefined);
    setDrawingsSnapshot(undefined);
    props.onClearSeed();
    props.onSelectTrade(null);
  };

  const handleStrategyChange = (nextId: string) => {
    setStrategyId(nextId);
    const s = props.strategies.find((x) => x.id === nextId);
    setChecklist(s ? s.rules.map(() => false) : []);
  };

  const handleCaptureBefore = async () => {
    setCapturing(true);
    try {
      const img = await props.onCaptureChart();
      const drawings = props.onGetDrawings();
      if (img) {
        setBeforeImage(img);
        setBeforeCapturedAt(Date.now());
      }
      if (drawings) {
        setDrawingsSnapshot(drawings);
      }
    } finally {
      setCapturing(false);
    }
  };

  const handleCaptureAfterInForm = async () => {
    setCapturing(true);
    try {
      const img = await props.onCaptureChart();
      if (img) {
        setAfterImage(img);
        setAfterCapturedAt(Date.now());
      }
    } finally {
      setCapturing(false);
    }
  };

  const handleCaptureAfterOnTrade = async (t: Trade) => {
    const img = await props.onCaptureChart();
    if (!img) return;
    const updated: Trade = {
      ...t,
      afterImage: img,
      afterCapturedAt: Date.now(),
    };
    await props.onSaveTrade(updated);
    if (editingId === t.id) {
      setAfterImage(img);
      setAfterCapturedAt(updated.afterCapturedAt);
    }
  };

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    const ep = Number(entryPrice);
    const sl = Number(stopLoss);
    const tp = Number(takeProfit);
    const ex = exitPrice.trim() ? Number(exitPrice) : undefined;
    if (!Number.isFinite(ep) || !Number.isFinite(sl) || !Number.isFinite(tp)) return;

    let finalBefore = beforeImage;
    let finalBeforeAt = beforeCapturedAt;
    let finalDrawings = drawingsSnapshot;

    // Auto-capture beforeImage if user hasn't clicked "Chụp chart ngay" yet
    if (!finalBefore) {
      const captured = await props.onCaptureChart();
      if (captured) {
        finalBefore = captured;
        finalBeforeAt = Date.now();
      }
      if (!finalDrawings) {
        finalDrawings = props.onGetDrawings() ?? undefined;
      }
    }

    const finalStatus: 'open' | 'closed' = ex !== undefined ? 'closed' : status;
    const rMult =
      finalStatus === 'closed'
        ? computeRMultiple(side, ep, sl, ex, tp)
        : computeRMultiple(side, ep, sl, undefined, tp);

    const existing = editingId ? props.trades.find((x) => x.id === editingId) : undefined;
    const trade: Trade = {
      id: editingId ?? `tr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      mode,
      symbol: props.symbol,
      timeframe: props.timeframe,
      side,
      entryTime,
      entryPrice: ep,
      stopLoss: sl,
      takeProfit: tp,
      exitTime: finalStatus === 'closed' ? Date.now() : undefined,
      exitPrice: finalStatus === 'closed' ? ex ?? tp : undefined,
      strategyId: activeStrat?.id ?? 'ema9-wma45-trend',
      checklist,
      emotion,
      mistakes,
      notes,
      rMultiple: rMult,
      status: finalStatus,
      createdAt: existing?.createdAt ?? Date.now(),
      beforeImage: finalBefore,
      afterImage,
      beforeCapturedAt: finalBeforeAt,
      afterCapturedAt,
      drawingsSnapshot: finalDrawings,
    };
    await props.onSaveTrade(trade);
    resetForm();
  };

  const visibleTrades = props.trades
    .filter((t) => (showAllSymbols ? true : t.symbol === props.symbol))
    .sort((a, b) => b.createdAt - a.createdAt);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <form class="card" onSubmit={handleSubmit} data-testid="trade-form">
        <div class="card-title">
          <span>{editingId ? 'Sửa lệnh' : `Ghi lệnh mới (${props.symbol})`}</span>
          <div style={{ display: 'flex', gap: '4px' }}>
            <button
              type="button"
              data-testid="side-long-btn"
              class={`btn ${side === 'long' ? 'btn-bull' : ''}`}
              style={{ padding: '3px 8px' }}
              onClick={() => setSide('long')}
            >
              LONG
            </button>
            <button
              type="button"
              data-testid="side-short-btn"
              class={`btn ${side === 'short' ? 'btn-bear' : ''}`}
              style={{ padding: '3px 8px' }}
              onClick={() => setSide('short')}
            >
              SHORT
            </button>
          </div>
        </div>

        {/* 1 compact row: Entry, SL, TP */}
        <div class="grid-3" style={{ marginBottom: '8px' }}>
          <div>
            <label class="field-label">Giá vào</label>
            <input
              class="input"
              data-testid="trade-entry-input"
              style={{ width: '100%' }}
              type="number"
              step="any"
              value={entryPrice}
              onInput={(e) => setEntryPrice((e.target as HTMLInputElement).value)}
              required
            />
          </div>
          <div>
            <label class="field-label">Stop Loss</label>
            <input
              class="input"
              data-testid="trade-sl-input"
              style={{ width: '100%' }}
              type="number"
              step="any"
              value={stopLoss}
              onInput={(e) => setStopLoss((e.target as HTMLInputElement).value)}
              required
            />
          </div>
          <div>
            <label class="field-label">Take Profit</label>
            <input
              class="input"
              data-testid="trade-tp-input"
              style={{ width: '100%' }}
              type="number"
              step="any"
              value={takeProfit}
              onInput={(e) => setTakeProfit((e.target as HTMLInputElement).value)}
              required
            />
          </div>
        </div>

        {/* Ghi chú lệnh */}
        <div style={{ marginBottom: '8px' }}>
          <label class="field-label">Ghi chú lệnh</label>
          <textarea
            class="textarea"
            data-testid="trade-notes-input"
            style={{ width: '100%', minHeight: '58px', resize: 'vertical' }}
            placeholder="Lý do vào lệnh, bối cảnh thị trường..."
            value={notes}
            onInput={(e) => setNotes((e.target as HTMLTextAreaElement).value)}
          />
        </div>

        {/* Ảnh chụp chart Trước & Sau */}
        <div
          style={{
            marginBottom: '8px',
            padding: '8px',
            borderRadius: '6px',
            background: '#0b0f17',
            border: '1px solid #1e293b',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '6px',
              gap: '6px',
            }}
          >
            <span style={{ fontSize: '11px', fontWeight: 600, color: '#cbd5e1' }}>
              Ảnh chart Trước / Sau
            </span>
            <div style={{ display: 'flex', gap: '4px' }}>
              <button
                type="button"
                class="btn"
                data-testid="capture-before-btn"
                disabled={capturing}
                style={{ padding: '4px 8px', fontSize: '11px', borderColor: '#38bdf8', color: '#38bdf8' }}
                onClick={handleCaptureBefore}
              >
                <Camera size={12} /> {capturing ? 'Đang chụp...' : 'Chụp chart ngay'}
              </button>
              {(editingId || beforeImage) && (
                <button
                  type="button"
                  class="btn"
                  data-testid="capture-after-btn"
                  disabled={capturing}
                  style={{ padding: '4px 8px', fontSize: '11px' }}
                  onClick={handleCaptureAfterInForm}
                >
                  <Camera size={12} /> Ảnh Sau
                </button>
              )}
            </div>
          </div>

          <div class="grid-2" style={{ gap: '6px' }}>
            <div
              style={{
                borderRadius: '5px',
                border: '1px solid #1e293b',
                background: '#0f1623',
                overflow: 'hidden',
                minHeight: '64px',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '2px 6px',
                  fontSize: '10px',
                  color: '#94a3b8',
                  borderBottom: '1px solid #1e293b',
                }}
              >
                <span>Trước {beforeCapturedAt ? `· ${formatShortTime(beforeCapturedAt)}` : ''}</span>
                {beforeImage && (
                  <button
                    type="button"
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#94a3b8',
                      cursor: 'pointer',
                      padding: 0,
                      display: 'flex',
                    }}
                    onClick={() => {
                      setBeforeImage(undefined);
                      setBeforeCapturedAt(undefined);
                    }}
                  >
                    <X size={11} />
                  </button>
                )}
              </div>
              {beforeImage ? (
                <img
                  src={beforeImage}
                  data-testid="form-before-preview"
                  alt="Ảnh chart Trước"
                  style={{ width: '100%', height: '72px', objectFit: 'cover', display: 'block' }}
                />
              ) : (
                <div
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '10.5px',
                    color: '#64748b',
                    padding: '6px',
                    textAlign: 'center',
                  }}
                >
                  Tự chụp khi lưu lệnh
                </div>
              )}
            </div>

            <div
              style={{
                borderRadius: '5px',
                border: '1px solid #1e293b',
                background: '#0f1623',
                overflow: 'hidden',
                minHeight: '64px',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '2px 6px',
                  fontSize: '10px',
                  color: '#94a3b8',
                  borderBottom: '1px solid #1e293b',
                }}
              >
                <span>Sau {afterCapturedAt ? `· ${formatShortTime(afterCapturedAt)}` : ''}</span>
                {afterImage && (
                  <button
                    type="button"
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#94a3b8',
                      cursor: 'pointer',
                      padding: 0,
                      display: 'flex',
                    }}
                    onClick={() => {
                      setAfterImage(undefined);
                      setAfterCapturedAt(undefined);
                    }}
                  >
                    <X size={11} />
                  </button>
                )}
              </div>
              {afterImage ? (
                <img
                  src={afterImage}
                  data-testid="form-after-preview"
                  alt="Ảnh chart Sau"
                  style={{ width: '100%', height: '72px', objectFit: 'cover', display: 'block' }}
                />
              ) : (
                <div
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '10.5px',
                    color: '#64748b',
                    padding: '6px',
                    textAlign: 'center',
                  }}
                >
                  Cập nhật sau khi đóng
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Collapsible: Kỷ luật & Nâng cao (collapsed by default) */}
        <div style={{ marginBottom: '8px' }}>
          <button
            type="button"
            data-testid="toggle-advanced-btn"
            class="btn"
            style={{
              width: '100%',
              justifyContent: 'space-between',
              padding: '5px 8px',
              fontSize: '11.5px',
              background: '#0b0f17',
              color: '#cbd5e1',
            }}
            onClick={() => setAdvancedOpen((v) => !v)}
          >
            <span>Kỷ luật & Nâng cao</span>
            {advancedOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>

          {advancedOpen && (
            <div
              data-testid="advanced-section"
              style={{
                marginTop: '6px',
                padding: '8px',
                borderRadius: '6px',
                background: '#0b0f17',
                border: '1px solid #1e293b',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <div class="grid-2">
                <div>
                  <label class="field-label">Trường phái</label>
                  <select
                    class="select"
                    style={{ width: '100%' }}
                    value={strategyId}
                    onChange={(e) => handleStrategyChange((e.target as HTMLSelectElement).value)}
                  >
                    {props.strategies.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label class="field-label">Cảm xúc</label>
                  <select
                    class="select"
                    style={{ width: '100%' }}
                    value={emotion}
                    onChange={(e) => setEmotion((e.target as HTMLSelectElement).value)}
                  >
                    {EMOTIONS.map((em) => (
                      <option key={em} value={em}>
                        {em}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {activeStrat && activeStrat.rules.length > 0 && (
                <div>
                  <label class="field-label">
                    Checklist quy tắc ({checklist.filter(Boolean).length}/{activeStrat.rules.length})
                  </label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {activeStrat.rules.map((rule, idx) => (
                      <label
                        key={idx}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          fontSize: '11.5px',
                          cursor: 'pointer',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={Boolean(checklist[idx])}
                          onChange={(e) => {
                            const next = [...checklist];
                            next[idx] = (e.target as HTMLInputElement).checked;
                            setChecklist(next);
                          }}
                        />
                        <span>{rule}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label class="field-label">Lỗi mắc phải (nếu có)</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {MISTAKE_OPTIONS.map((m) => {
                    const active = mistakes.includes(m);
                    return (
                      <button
                        type="button"
                        key={m}
                        class={`btn ${active ? 'btn-bear' : ''}`}
                        style={{ padding: '2px 6px', fontSize: '10.5px' }}
                        onClick={() =>
                          setMistakes((prev) =>
                            prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]
                          )
                        }
                      >
                        {m}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div class="grid-2">
                <div>
                  <label class="field-label">Giá thoát (đóng lệnh)</label>
                  <input
                    class="input"
                    style={{ width: '100%' }}
                    type="number"
                    step="any"
                    placeholder="Để trống nếu đang mở"
                    value={exitPrice}
                    onInput={(e) => setExitPrice((e.target as HTMLInputElement).value)}
                  />
                </div>
                <div>
                  <label class="field-label">Chế độ</label>
                  <select
                    class="select"
                    style={{ width: '100%' }}
                    value={mode}
                    onChange={(e) => setMode((e.target as HTMLSelectElement).value as TradeMode)}
                  >
                    <option value="live">Live</option>
                    <option value="replay">Replay</option>
                    <option value="backtest">Backtest</option>
                  </select>
                </div>
              </div>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            type="submit"
            class="btn btn-primary"
            style={{ flex: 1, justifyContent: 'center' }}
            data-testid="save-trade-btn"
          >
            <Plus size={14} /> {editingId ? 'Cập nhật lệnh' : 'Lưu lệnh'}
          </button>
          {editingId && (
            <button type="button" class="btn" onClick={resetForm}>
              Hủy
            </button>
          )}
        </div>
      </form>

      {/* Trade list */}
      <div class="card">
        <div class="card-title">
          <span>Danh sách lệnh ({visibleTrades.length})</span>
          <label style={{ fontSize: '11px', fontWeight: 400, color: '#94a3b8', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={showAllSymbols}
              onChange={(e) => setShowAllSymbols((e.target as HTMLInputElement).checked)}
            />{' '}
            Tất cả mã
          </label>
        </div>

        {visibleTrades.length === 0 ? (
          <div style={{ color: '#94a3b8', fontSize: '12px' }}>
            Chưa có lệnh nào. Chọn công cụ Long/Short ở thanh trái hoặc điền form trên.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {visibleTrades.slice(0, 40).map((t) => (
              <div
                key={t.id}
                data-testid={`trade-item-${t.id}`}
                onClick={() => loadTradeIntoForm(t)}
                style={{
                  padding: '8px',
                  borderRadius: '6px',
                  background: '#0b0f17',
                  border:
                    props.selectedTradeId === t.id
                      ? '1px solid #38bdf8'
                      : '1px solid #1e293b',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span class={`pill ${t.side === 'long' ? 'pill-bull' : 'pill-bear'}`}>
                      {t.side.toUpperCase()}
                    </span>
                    <strong>{t.symbol}</strong>
                    <span style={{ color: '#94a3b8', fontSize: '11px' }}>
                      {t.timeframe} · {t.mode}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span
                      style={{
                        fontWeight: 700,
                        color: t.rMultiple >= 0 ? '#00F59B' : '#FF3B5C',
                      }}
                    >
                      {t.status === 'closed'
                        ? `${t.rMultiple >= 0 ? '+' : ''}${t.rMultiple}R`
                        : `Mục tiêu ${t.rMultiple}R`}
                    </span>
                    {t.status === 'open' && props.lastPrice !== null && t.symbol === props.symbol && (
                      <button
                        type="button"
                        class="btn"
                        title="Đóng lệnh ở giá hiện tại"
                        style={{ padding: '2px 5px' }}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          const exitP = props.lastPrice!;
                          props.onSaveTrade({
                            ...t,
                            status: 'closed',
                            exitPrice: exitP,
                            exitTime: Date.now(),
                            rMultiple: computeRMultiple(
                              t.side,
                              t.entryPrice,
                              t.stopLoss,
                              exitP,
                              t.takeProfit
                            ),
                          });
                        }}
                      >
                        <CheckCircle2 size={12} color="#00F59B" />
                      </button>
                    )}
                    <button
                      type="button"
                      class="btn"
                      style={{ padding: '2px 5px' }}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        props.onDeleteTrade(t.id);
                      }}
                    >
                      <Trash2 size={12} color="#FF3B5C" />
                    </button>
                  </div>
                </div>

                <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                  Vào: {formatPrice(t.entryPrice, t.symbol)} · SL: {formatPrice(t.stopLoss, t.symbol)} · TP:{' '}
                  {formatPrice(t.takeProfit, t.symbol)}
                </div>

                {t.notes && (
                  <div
                    style={{
                      fontSize: '11.5px',
                      color: '#cbd5e1',
                      whiteSpace: 'pre-wrap',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}
                  >
                    {t.notes}
                  </div>
                )}

                {/* Side-by-side Before & After thumbnails */}
                {(t.beforeImage || t.afterImage) && (
                  <div class="grid-2" style={{ gap: '6px' }}>
                    <div
                      data-testid={`thumb-before-${t.id}`}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        setCompareTrade(t);
                      }}
                      style={{
                        borderRadius: '4px',
                        overflow: 'hidden',
                        border: '1px solid #1e293b',
                        background: '#0f1623',
                        position: 'relative',
                      }}
                    >
                      <div
                        style={{
                          fontSize: '9.5px',
                          padding: '2px 5px',
                          background: 'rgba(11,15,23,0.85)',
                          color: '#94a3b8',
                        }}
                      >
                        Trước
                      </div>
                      {t.beforeImage ? (
                        <img
                          src={t.beforeImage}
                          alt="Trước"
                          style={{ width: '100%', height: '58px', objectFit: 'cover', display: 'block' }}
                        />
                      ) : (
                        <div style={{ height: '58px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: '#64748b' }}>
                          Chưa có
                        </div>
                      )}
                    </div>

                    <div
                      data-testid={`thumb-after-${t.id}`}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        setCompareTrade(t);
                      }}
                      style={{
                        borderRadius: '4px',
                        overflow: 'hidden',
                        border: '1px solid #1e293b',
                        background: '#0f1623',
                        position: 'relative',
                      }}
                    >
                      <div
                        style={{
                          fontSize: '9.5px',
                          padding: '2px 5px',
                          background: 'rgba(11,15,23,0.85)',
                          color: '#94a3b8',
                        }}
                      >
                        Sau
                      </div>
                      {t.afterImage ? (
                        <img
                          src={t.afterImage}
                          alt="Sau"
                          style={{ width: '100%', height: '58px', objectFit: 'cover', display: 'block' }}
                        />
                      ) : (
                        <div style={{ height: '58px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: '#64748b' }}>
                          Chưa chụp
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Quick actions: Update After image, Compare, Restore drawings */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  <button
                    type="button"
                    class="btn"
                    data-testid={`capture-after-${t.id}`}
                    style={{ padding: '3px 7px', fontSize: '10.5px' }}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      handleCaptureAfterOnTrade(t);
                    }}
                  >
                    <Camera size={11} /> Cập nhật ảnh Sau
                  </button>

                  {(t.beforeImage || t.afterImage) && (
                    <button
                      type="button"
                      class="btn"
                      data-testid={`compare-btn-${t.id}`}
                      style={{ padding: '3px 7px', fontSize: '10.5px' }}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        setCompareTrade(t);
                      }}
                    >
                      <Columns2 size={11} /> So sánh Trước / Sau
                    </button>
                  )}

                  {Boolean(t.drawingsSnapshot) && (
                    <button
                      type="button"
                      class="btn"
                      data-testid={`restore-drawings-${t.id}`}
                      style={{ padding: '3px 7px', fontSize: '10.5px' }}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        props.onRestoreDrawings(t.drawingsSnapshot);
                      }}
                    >
                      <PenLine size={11} /> Khôi phục nét vẽ
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Full-screen Before / After Lightbox Modal */}
      {compareTrade && (
        <div
          data-testid="compare-modal"
          onClick={() => setCompareTrade(null)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(6, 10, 16, 0.88)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
          }}
        >
          <div
            onClick={(ev) => ev.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: '1240px',
              maxHeight: '92vh',
              background: '#0f1623',
              border: '1px solid #2b3c58',
              borderRadius: '10px',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 14px',
                background: '#131f33',
                borderBottom: '1px solid #2b3c58',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <span class={`pill ${compareTrade.side === 'long' ? 'pill-bull' : 'pill-bear'}`}>
                  {compareTrade.side.toUpperCase()}
                </span>
                <strong style={{ fontSize: '14px' }}>{compareTrade.symbol}</strong>
                <span style={{ color: '#94a3b8', fontSize: '12px' }}>
                  Khung {compareTrade.timeframe} · Vào {formatPrice(compareTrade.entryPrice, compareTrade.symbol)} · SL{' '}
                  {formatPrice(compareTrade.stopLoss, compareTrade.symbol)} · TP{' '}
                  {formatPrice(compareTrade.takeProfit, compareTrade.symbol)}
                </span>
                <span
                  style={{
                    fontWeight: 700,
                    color: compareTrade.rMultiple >= 0 ? '#00F59B' : '#FF3B5C',
                  }}
                >
                  {compareTrade.status === 'closed'
                    ? `${compareTrade.rMultiple >= 0 ? '+' : ''}${compareTrade.rMultiple}R`
                    : `Mục tiêu ${compareTrade.rMultiple}R`}
                </span>
              </div>
              <button
                type="button"
                class="btn"
                data-testid="close-compare-modal"
                onClick={() => setCompareTrade(null)}
              >
                <X size={14} /> Đóng
              </button>
            </div>

            <div
              style={{
                padding: '14px',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
              }}
            >
              <div class="grid-2" style={{ gap: '12px' }}>
                <div
                  style={{
                    background: '#0b0f17',
                    border: '1px solid #1e293b',
                    borderRadius: '8px',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      padding: '6px 10px',
                      borderBottom: '1px solid #1e293b',
                      fontSize: '12px',
                      fontWeight: 600,
                      color: '#38bdf8',
                      display: 'flex',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span>TRƯỚC KHI VÀO / LÚC GHI LỆNH</span>
                    <span style={{ color: '#94a3b8', fontWeight: 400 }}>
                      {formatShortTime(compareTrade.beforeCapturedAt)}
                    </span>
                  </div>
                  {compareTrade.beforeImage ? (
                    <img
                      src={compareTrade.beforeImage}
                      data-testid="modal-before-img"
                      alt="Chart Trước"
                      style={{ width: '100%', maxHeight: '58vh', objectFit: 'contain', display: 'block' }}
                    />
                  ) : (
                    <div
                      style={{
                        height: '240px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#64748b',
                      }}
                    >
                      Chưa có ảnh Trước
                    </div>
                  )}
                </div>

                <div
                  style={{
                    background: '#0b0f17',
                    border: '1px solid #1e293b',
                    borderRadius: '8px',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      padding: '6px 10px',
                      borderBottom: '1px solid #1e293b',
                      fontSize: '12px',
                      fontWeight: 600,
                      color: '#00F59B',
                      display: 'flex',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span>SAU KHI DIỄN BIẾN / ĐÓNG LỆNH</span>
                    <span style={{ color: '#94a3b8', fontWeight: 400 }}>
                      {formatShortTime(compareTrade.afterCapturedAt)}
                    </span>
                  </div>
                  {compareTrade.afterImage ? (
                    <img
                      src={compareTrade.afterImage}
                      data-testid="modal-after-img"
                      alt="Chart Sau"
                      style={{ width: '100%', maxHeight: '58vh', objectFit: 'contain', display: 'block' }}
                    />
                  ) : (
                    <div
                      style={{
                        height: '240px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#64748b',
                      }}
                    >
                      Chưa có ảnh Sau
                    </div>
                  )}
                </div>
              </div>

              {compareTrade.notes && (
                <div
                  style={{
                    padding: '10px 12px',
                    borderRadius: '8px',
                    background: '#0b0f17',
                    border: '1px solid #1e293b',
                    fontSize: '12.5px',
                    color: '#e2e8f0',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  <strong style={{ color: '#94a3b8', display: 'block', marginBottom: '4px', fontSize: '11px' }}>
                    GHI CHÚ LỆNH
                  </strong>
                  {compareTrade.notes}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
