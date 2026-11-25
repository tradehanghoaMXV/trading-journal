import { useEffect, useState } from 'preact/hooks';
import { CheckCircle2, Plus, Trash2 } from 'lucide-preact';
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
}

const EMOTIONS = ['Kỷ luật', 'Tự tin', 'Lo lắng', 'FOMO', 'Nóng vội', 'Bình tĩnh'];
const MISTAKE_OPTIONS = [
  'Vào sớm chưa chờ xác nhận',
  'Dời SL xa hơn kế hoạch',
  'Vào khối lượng quá lớn',
  'FOMO đuổi giá',
  'Bỏ qua checklist',
];

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
  const [showAllSymbols, setShowAllSymbols] = useState(false);

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
    props.onClearSeed();
    props.onSelectTrade(null);
  };

  const handleStrategyChange = (nextId: string) => {
    setStrategyId(nextId);
    const s = props.strategies.find((x) => x.id === nextId);
    setChecklist(s ? s.rules.map(() => false) : []);
  };

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    const ep = Number(entryPrice);
    const sl = Number(stopLoss);
    const tp = Number(takeProfit);
    const ex = exitPrice.trim() ? Number(exitPrice) : undefined;
    if (!Number.isFinite(ep) || !Number.isFinite(sl) || !Number.isFinite(tp)) return;

    const finalStatus: 'open' | 'closed' = ex !== undefined ? 'closed' : status;
    const rMult =
      finalStatus === 'closed'
        ? computeRMultiple(side, ep, sl, ex, tp)
        : computeRMultiple(side, ep, sl, undefined, tp);

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
      createdAt: Date.now(),
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
              class={`btn ${side === 'long' ? 'btn-bull' : ''}`}
              style={{ padding: '3px 8px' }}
              onClick={() => setSide('long')}
            >
              LONG
            </button>
            <button
              type="button"
              class={`btn ${side === 'short' ? 'btn-bear' : ''}`}
              style={{ padding: '3px 8px' }}
              onClick={() => setSide('short')}
            >
              SHORT
            </button>
          </div>
        </div>

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

        <div class="grid-2" style={{ marginBottom: '8px' }}>
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
          <div style={{ marginBottom: '8px' }}>
            <label class="field-label">Checklist quy tắc ({checklist.filter(Boolean).length}/{activeStrat.rules.length})</label>
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

        <div style={{ marginBottom: '8px' }}>
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

        <div class="grid-2" style={{ marginBottom: '8px' }}>
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

        <div style={{ marginBottom: '8px' }}>
          <label class="field-label">Ghi chú lệnh (Markdown)</label>
          <textarea
            class="textarea"
            style={{ width: '100%', minHeight: '52px', resize: 'vertical' }}
            placeholder="Lý do vào lệnh, bối cảnh thị trường..."
            value={notes}
            onInput={(e) => setNotes((e.target as HTMLTextAreaElement).value)}
          />
        </div>

        <div style={{ display: 'flex', gap: '6px' }}>
          <button type="submit" class="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} data-testid="save-trade-btn">
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
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
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span class={`pill ${t.side === 'long' ? 'pill-bull' : 'pill-bear'}`}>
                      {t.side.toUpperCase()}
                    </span>
                    <strong>{t.symbol}</strong>
                    <span style={{ color: '#94a3b8', fontSize: '11px' }}>{t.mode}</span>
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
                <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>
                  Vào: {formatPrice(t.entryPrice, t.symbol)} · SL: {formatPrice(t.stopLoss, t.symbol)} · TP:{' '}
                  {formatPrice(t.takeProfit, t.symbol)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
