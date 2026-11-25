import { useState } from 'preact/hooks';
import {
  Activity,
  Columns2,
  Grid2x2,
  PlayCircle,
  Search,
  Square,
  PanelRightClose,
  PanelRightOpen,
} from 'lucide-preact';
import { ALL_SYMBOLS, TIMEFRAMES, formatPrice } from '../config/symbols';

interface TopBarProps {
  symbol: string;
  timeframe: string;
  layout: '1' | '2h' | '4';
  lastPrice: number | null;
  replayActive: boolean;
  panelOpen: boolean;
  isApproxGap: boolean;
  onSelectSymbol: (sym: string) => void;
  onSelectTimeframe: (tf: string) => void;
  onSelectLayout: (layout: '1' | '2h' | '4') => void;
  onToggleReplay: () => void;
  onOpenBacktest: () => void;
  onTogglePanel: () => void;
}

export function TopBar(props: TopBarProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');

  const filtered = ALL_SYMBOLS.filter(
    (s) =>
      s.symbol.toLowerCase().includes(query.toLowerCase()) ||
      s.name.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <header class="topbar">
      <div class="topbar-group">
        <span class="brand-title">NHẬT KÝ GIAO DỊCH</span>

        <div style={{ position: 'relative' }}>
          <button
            class="btn"
            data-testid="symbol-picker-btn"
            onClick={() => setSearchOpen((v) => !v)}
          >
            <Search size={14} />
            <strong>{props.symbol}</strong>
          </button>

          {searchOpen && (
            <div
              style={{
                position: 'absolute',
                top: '110%',
                left: 0,
                width: '280px',
                background: '#131f33',
                border: '1px solid #2b3c58',
                borderRadius: '8px',
                padding: '8px',
                zIndex: 50,
                boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
              }}
            >
              <input
                class="input"
                style={{ width: '100%', marginBottom: '6px' }}
                placeholder="Tìm mã (VD: BTCUSDT, XAUUSD)..."
                value={query}
                onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
                autoFocus
              />
              <div style={{ maxHeight: '260px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                {filtered.map((item) => (
                  <button
                    key={item.symbol}
                    class={`btn ${item.symbol === props.symbol ? 'btn-active' : ''}`}
                    style={{ justifyContent: 'space-between', width: '100%', border: 'none' }}
                    data-testid={`symbol-opt-${item.symbol}`}
                    onClick={() => {
                      props.onSelectSymbol(item.symbol);
                      setSearchOpen(false);
                      setQuery('');
                    }}
                  >
                    <span>
                      <strong>{item.symbol}</strong>{' '}
                      <span style={{ color: '#94a3b8', fontSize: '11px' }}>{item.name}</span>
                    </span>
                    <span class="pill pill-accent" style={{ fontSize: '10px' }}>
                      {item.group === 'crypto' ? 'Binance' : 'FX/Pyth'}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Timeframe buttons */}
        <div class="topbar-group" style={{ gap: '3px' }}>
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.id}
              data-testid={`tf-btn-${tf.id}`}
              class={`btn ${props.timeframe === tf.id ? 'btn-active' : ''}`}
              style={{ padding: '4px 8px' }}
              onClick={() => props.onSelectTimeframe(tf.id)}
            >
              {tf.label}
            </button>
          ))}
        </div>

        {/* Live price */}
        {props.lastPrice !== null && (
          <div
            data-testid="live-price-badge"
            class="pill pill-bull"
            style={{ fontFamily: 'Montserrat, monospace', fontSize: '12px', padding: '3px 9px' }}
          >
            {formatPrice(props.lastPrice, props.symbol)}
          </div>
        )}

        {props.isApproxGap && (
          <span class="pill pill-accent" title="Khoảng trống gần nhất được nội suy từ Pyth Hermes">
            Pyth xấp xỉ
          </span>
        )}
      </div>

      <div class="topbar-group">
        {/* Layout 1 / 2 / 4 */}
        <div class="topbar-group" style={{ gap: '3px' }}>
          <button
            class={`btn ${props.layout === '1' ? 'btn-active' : ''}`}
            title="1 Biểu đồ"
            onClick={() => props.onSelectLayout('1')}
          >
            <Square size={13} /> 1
          </button>
          <button
            class={`btn ${props.layout === '2h' ? 'btn-active' : ''}`}
            title="2 Biểu đồ"
            onClick={() => props.onSelectLayout('2h')}
          >
            <Columns2 size={13} /> 2
          </button>
          <button
            class={`btn ${props.layout === '4' ? 'btn-active' : ''}`}
            title="4 Biểu đồ"
            onClick={() => props.onSelectLayout('4')}
          >
            <Grid2x2 size={13} /> 4
          </button>
        </div>

        <button
          data-testid="replay-toggle-btn"
          class={`btn ${props.replayActive ? 'btn-active' : ''}`}
          onClick={props.onToggleReplay}
        >
          <PlayCircle size={14} /> Replay
        </button>

        <button
          data-testid="backtest-shortcut-btn"
          class="btn"
          onClick={props.onOpenBacktest}
        >
          <Activity size={14} /> Backtest
        </button>

        <button
          class="btn"
          title={props.panelOpen ? 'Ẩn panel phải' : 'Hiện panel phải'}
          onClick={props.onTogglePanel}
        >
          {props.panelOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
        </button>
      </div>
    </header>
  );
}
