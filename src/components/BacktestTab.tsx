import { useState } from 'preact/hooks';
import { Play, Save } from 'lucide-preact';
import type { OHLCV } from '@luxalgo/vela';
import type { Strategy, Trade } from '../db/journalDb';
import type {
  BacktestParams,
  BacktestResult,
  BacktestStrategyKind,
} from '../backtest/backtestEngine';

interface BacktestTabProps {
  symbol: string;
  timeframe: string;
  bars: OHLCV[];
  strategies: Strategy[];
  onSaveBacktestTrades: (trades: Trade[]) => Promise<void>;
}

export function BacktestTab(props: BacktestTabProps) {
  const [kind, setKind] = useState<BacktestStrategyKind>('ema_wma');
  const [strategyId, setStrategyId] = useState<string>(
    props.strategies.find((s) => s.id === 'ema9-wma45-trend')?.id ??
      props.strategies[0]?.id ??
      ''
  );
  const [atrMult, setAtrMult] = useState(1.5);
  const [rrRatio, setRrRatio] = useState(2.0);
  const [spreadBps, setSpreadBps] = useState(4);
  const [emaLen, setEmaLen] = useState(9);
  const [wmaLen, setWmaLen] = useState(45);
  const [entryLen, setEntryLen] = useState(20);
  const [exitLen, setExitLen] = useState(10);
  const [rsiLen, setRsiLen] = useState(14);
  const [rsiOversold, setRsiOversold] = useState(30);
  const [rsiOverbought, setRsiOverbought] = useState(70);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [savedNotice, setSavedNotice] = useState('');

  const handleRun = () => {
    if (props.bars.length < 60) return;
    setRunning(true);
    setSavedNotice('');
    const params: BacktestParams = {
      kind,
      symbol: props.symbol,
      timeframe: props.timeframe,
      strategyId,
      spreadBps,
      atrPeriod: 14,
      atrMult,
      rrRatio,
      emaLen,
      wmaLen,
      entryLen,
      exitLen,
      rsiLen,
      rsiOversold,
      rsiOverbought,
    };
    const worker = new Worker(
      new URL('../backtest/backtest.worker.ts', import.meta.url),
      { type: 'module' }
    );
    worker.onmessage = (ev: MessageEvent<BacktestResult>) => {
      setResult(ev.data);
      setRunning(false);
      worker.terminate();
    };
    worker.onerror = () => {
      setRunning(false);
      worker.terminate();
    };
    worker.postMessage({ bars: props.bars, params });
  };

  const handleSaveToJournal = async () => {
    if (!result || result.trades.length === 0) return;
    await props.onSaveBacktestTrades(result.trades);
    setSavedNotice(`Đã lưu ${result.trades.length} lệnh backtest vào Nhật ký!`);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }} data-testid="backtest-tab">
      <div class="card">
        <div class="card-title">
          Backtest tự động ({props.symbol} · {props.bars.length} nến)
        </div>

        <div style={{ marginBottom: '8px' }}>
          <label class="field-label">Chiến lược mẫu</label>
          <select
            class="select"
            style={{ width: '100%' }}
            value={kind}
            onChange={(e) => {
              const next = (e.target as HTMLSelectElement).value as BacktestStrategyKind;
              setKind(next);
              if (next === 'donchian') setStrategyId('turtle-breakout');
              else if (next === 'ema_wma') setStrategyId('ema9-wma45-trend');
            }}
          >
            <option value="ema_wma">EMA 9 cắt WMA 45 (Theo xu hướng)</option>
            <option value="donchian">Turtle / Donchian Breakout 20/10</option>
            <option value="rsi">RSI (14) Mean Reversion 30/70</option>
          </select>
        </div>

        <div class="grid-3" style={{ marginBottom: '8px' }}>
          <div>
            <label class="field-label">SL × ATR(14)</label>
            <input
              class="input"
              style={{ width: '100%' }}
              type="number"
              step="0.1"
              value={atrMult}
              onInput={(e) => setAtrMult(Number((e.target as HTMLInputElement).value))}
            />
          </div>
          <div>
            <label class="field-label">Tỷ lệ R:R</label>
            <input
              class="input"
              style={{ width: '100%' }}
              type="number"
              step="0.1"
              value={rrRatio}
              onInput={(e) => setRrRatio(Number((e.target as HTMLInputElement).value))}
            />
          </div>
          <div>
            <label class="field-label">Phí/Spread (bps)</label>
            <input
              class="input"
              style={{ width: '100%' }}
              type="number"
              step="1"
              value={spreadBps}
              onInput={(e) => setSpreadBps(Number((e.target as HTMLInputElement).value))}
            />
          </div>
        </div>

        {kind === 'ema_wma' && (
          <div class="grid-2" style={{ marginBottom: '8px' }}>
            <div>
              <label class="field-label">Chu kỳ EMA</label>
              <input
                class="input"
                style={{ width: '100%' }}
                type="number"
                value={emaLen}
                onInput={(e) => setEmaLen(Number((e.target as HTMLInputElement).value))}
              />
            </div>
            <div>
              <label class="field-label">Chu kỳ WMA</label>
              <input
                class="input"
                style={{ width: '100%' }}
                type="number"
                value={wmaLen}
                onInput={(e) => setWmaLen(Number((e.target as HTMLInputElement).value))}
              />
            </div>
          </div>
        )}

        {kind === 'donchian' && (
          <div class="grid-2" style={{ marginBottom: '8px' }}>
            <div>
              <label class="field-label">Kênh vào (N)</label>
              <input
                class="input"
                style={{ width: '100%' }}
                type="number"
                value={entryLen}
                onInput={(e) => setEntryLen(Number((e.target as HTMLInputElement).value))}
              />
            </div>
            <div>
              <label class="field-label">Kênh thoát (M)</label>
              <input
                class="input"
                style={{ width: '100%' }}
                type="number"
                value={exitLen}
                onInput={(e) => setExitLen(Number((e.target as HTMLInputElement).value))}
              />
            </div>
          </div>
        )}

        {kind === 'rsi' && (
          <div class="grid-3" style={{ marginBottom: '8px' }}>
            <div>
              <label class="field-label">RSI kỳ</label>
              <input
                class="input"
                style={{ width: '100%' }}
                type="number"
                value={rsiLen}
                onInput={(e) => setRsiLen(Number((e.target as HTMLInputElement).value))}
              />
            </div>
            <div>
              <label class="field-label">Quá bán</label>
              <input
                class="input"
                style={{ width: '100%' }}
                type="number"
                value={rsiOversold}
                onInput={(e) => setRsiOversold(Number((e.target as HTMLInputElement).value))}
              />
            </div>
            <div>
              <label class="field-label">Quá mua</label>
              <input
                class="input"
                style={{ width: '100%' }}
                type="number"
                value={rsiOverbought}
                onInput={(e) => setRsiOverbought(Number((e.target as HTMLInputElement).value))}
              />
            </div>
          </div>
        )}

        <div style={{ marginBottom: '8px' }}>
          <label class="field-label">Gán vào trường phái khi lưu</label>
          <select
            class="select"
            style={{ width: '100%' }}
            value={strategyId}
            onChange={(e) => setStrategyId((e.target as HTMLSelectElement).value)}
          >
            {props.strategies.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <button
          class="btn btn-primary"
          data-testid="run-backtest-btn"
          style={{ width: '100%', justifyContent: 'center' }}
          disabled={running || props.bars.length < 60}
          onClick={handleRun}
        >
          <Play size={14} /> {running ? 'Đang chạy Web Worker...' : 'Chạy Backtest'}
        </button>
      </div>

      {result && (
        <div class="card" data-testid="backtest-results">
          <div class="card-title">
            <span>Kết quả ({result.trades.length} lệnh)</span>
            <button
              class="btn btn-bull"
              data-testid="save-backtest-btn"
              onClick={handleSaveToJournal}
            >
              <Save size={13} /> Lưu vào Nhật ký
            </button>
          </div>

          {savedNotice && (
            <div class="pill pill-bull" style={{ marginBottom: '8px' }}>
              {savedNotice}
            </div>
          )}

          <div class="grid-2" style={{ gap: '6px', marginBottom: '8px' }}>
            <div style={{ background: '#0b0f17', padding: '7px', borderRadius: '6px' }}>
              <div class="field-label">Win rate</div>
              <strong>{result.stats.winRate}%</strong>
            </div>
            <div style={{ background: '#0b0f17', padding: '7px', borderRadius: '6px' }}>
              <div class="field-label">Expectancy</div>
              <strong style={{ color: result.stats.expectancyR >= 0 ? '#00F59B' : '#FF3B5C' }}>
                {result.stats.expectancyR}R
              </strong>
            </div>
            <div style={{ background: '#0b0f17', padding: '7px', borderRadius: '6px' }}>
              <div class="field-label">Profit Factor</div>
              <strong>{result.stats.profitFactor}</strong>
            </div>
            <div style={{ background: '#0b0f17', padding: '7px', borderRadius: '6px' }}>
              <div class="field-label">Max Drawdown</div>
              <strong style={{ color: '#FF3B5C' }}>-{result.stats.maxDrawdownR}R</strong>
            </div>
          </div>

          <div style={{ maxHeight: '200px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {result.trades.slice(-20).reverse().map((t) => (
              <div
                key={t.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '5px 8px',
                  background: '#0b0f17',
                  borderRadius: '4px',
                  fontSize: '11.5px',
                }}
              >
                <span>
                  <strong style={{ color: t.side === 'long' ? '#00F59B' : '#FF3B5C' }}>
                    {t.side.toUpperCase()}
                  </strong>{' '}
                  {new Date(t.entryTime).toLocaleDateString('vi-VN')}
                </span>
                <span style={{ color: t.rMultiple >= 0 ? '#00F59B' : '#FF3B5C', fontWeight: 600 }}>
                  {t.rMultiple >= 0 ? '+' : ''}
                  {t.rMultiple}R
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
