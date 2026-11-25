import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { MousePointer2, TrendingUp, TrendingDown, MapPin, X } from 'lucide-preact';
import type { OHLCV, ReplayState } from '@luxalgo/vela';
import {
  computeRMultiple,
  db,
  ensureDefaultStrategies,
  type ChartNote,
  type Strategy,
  type Trade,
} from './db/journalDb';
import { VelaJournalHost, type ActiveTool } from './chart/velaHost';
import type { DraftPosition } from './chart/journalLayer';
import { TopBar } from './components/TopBar';
import { ReplayBar } from './components/ReplayBar';
import { TradesTab, type TradeFormSeed } from './components/TradesTab';
import { NotesTab, type NoteFormSeed } from './components/NotesTab';
import { ConsistencyTab } from './components/ConsistencyTab';
import { StrategiesTab } from './components/StrategiesTab';
import { BacktestTab } from './components/BacktestTab';
import { DataTab } from './components/DataTab';
import { SYMBOL_MAP } from './config/symbols';

type RightTabId = 'trades' | 'notes' | 'consistency' | 'strategies' | 'backtest' | 'data';

const DEFAULT_REPLAY: ReplayState = {
  active: false,
  playing: false,
  cursorTime: null,
  remaining: 0,
  nextTime: null,
  intervalMs: 1000,
};

export function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<VelaJournalHost | null>(null);

  const [symbol, setSymbol] = useState('BTCUSDT');
  const [timeframe, setTimeframe] = useState('60');
  const [layout, setLayout] = useState<'1' | '2h' | '4'>('1');
  const [lastPrice, setLastPrice] = useState<number | null>(null);
  const [bars, setBars] = useState<OHLCV[]>([]);
  const [replay, setReplay] = useState<ReplayState>(DEFAULT_REPLAY);
  const [replayBarOpen, setReplayBarOpen] = useState(false);

  const [panelOpen, setPanelOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<RightTabId>('trades');
  const [activeTool, setActiveTool] = useState<ActiveTool>('cursor');
  const [draft, setDraft] = useState<DraftPosition | null>(null);

  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [notes, setNotes] = useState<ChartNote[]>([]);
  const [selectedTradeId, setSelectedTradeId] = useState<string | null>(null);
  const [tradeSeed, setTradeSeed] = useState<TradeFormSeed | null>(null);
  const [noteSeed, setNoteSeed] = useState<NoteFormSeed | null>(null);

  const toolRef = useRef<ActiveTool>(activeTool);
  toolRef.current = activeTool;
  const draftRef = useRef<DraftPosition | null>(draft);
  draftRef.current = draft;
  const symbolRef = useRef(symbol);
  symbolRef.current = symbol;
  const timeframeRef = useRef(timeframe);
  timeframeRef.current = timeframe;
  const replayRef = useRef(replay);
  replayRef.current = replay;

  const loadDb = useCallback(async () => {
    await ensureDefaultStrategies();
    const [s, t, n] = await Promise.all([
      db.strategies.orderBy('createdAt').toArray(),
      db.trades.toArray(),
      db.notes.toArray(),
    ]);
    setStrategies(s);
    setTrades(t);
    setNotes(n);
  }, []);

  useEffect(() => {
    loadDb();
  }, [loadDb]);

  // Auto-close open replay trades when bar hits SL/TP
  const handleBarUpdate = useCallback(async (bar: OHLCV, barSym: string) => {
    setLastPrice(bar.close);
    if (!replayRef.current.active) return;

    const openReplay = await db.trades
      .where('symbol')
      .equals(barSym)
      .filter((t) => t.mode === 'replay' && t.status === 'open')
      .toArray();

    let changed = false;
    for (const t of openReplay) {
      let exitPrice: number | null = null;
      if (t.side === 'long') {
        if (t.stopLoss !== undefined && bar.low <= t.stopLoss) exitPrice = t.stopLoss;
        else if (t.takeProfit !== undefined && bar.high >= t.takeProfit) exitPrice = t.takeProfit;
      } else {
        if (t.stopLoss !== undefined && bar.high >= t.stopLoss) exitPrice = t.stopLoss;
        else if (t.takeProfit !== undefined && bar.low <= t.takeProfit) exitPrice = t.takeProfit;
      }
      if (exitPrice !== null) {
        const updated: Trade = {
          ...t,
          status: 'closed',
          exitTime: bar.time,
          exitPrice,
          rMultiple: computeRMultiple(t.side, t.entryPrice, t.stopLoss, exitPrice, t.takeProfit),
        };
        await db.trades.put(updated);
        changed = true;
      }
    }
    if (changed) {
      const all = await db.trades.toArray();
      setTrades(all);
    }
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    const host = new VelaJournalHost(containerRef.current, {
      initialSymbol: symbol,
      initialTimeframe: timeframe,
      onSnapshot: (snap) => {
        setSymbol(snap.symbol);
        setTimeframe(snap.timeframe);
        setBars(snap.bars);
        if (snap.lastBar) setLastPrice(snap.lastBar.close);
        setReplay(snap.replay);
      },
      onBarUpdate: handleBarUpdate,
    });
    hostRef.current = host;

    host.setToolHandler({
      getTool: () => toolRef.current,
      onClick: (time, price) => {
        const t = toolRef.current;
        const dec = SYMBOL_MAP.get(symbolRef.current)?.decimals ?? 2;
        const roundP = (v: number) => Number(v.toFixed(dec));
        const p = roundP(price);

        if (t === 'note') {
          setNoteSeed({ time, price: p });
          setActiveTab('notes');
          setPanelOpen(true);
          setActiveTool('cursor');
          return;
        }

        if (t === 'long' || t === 'short') {
          const cur = draftRef.current;
          if (!cur) {
            const offset = p * 0.005 || 1;
            setDraft({
              side: t,
              step: 'sl',
              entryTime: time,
              entryPrice: p,
              stopLoss: roundP(t === 'long' ? p - offset : p + offset),
              takeProfit: roundP(t === 'long' ? p + offset * 2 : p - offset * 2),
            });
          } else if (cur.step === 'sl') {
            setDraft({ ...cur, step: 'tp', stopLoss: p });
          } else if (cur.step === 'tp') {
            const finalDraft = { ...cur, takeProfit: p };
            setDraft(null);
            setActiveTool('cursor');
            setTradeSeed({
              side: finalDraft.side,
              mode: replayRef.current.active ? 'replay' : 'live',
              symbol: symbolRef.current,
              timeframe: timeframeRef.current,
              entryTime: finalDraft.entryTime,
              entryPrice: finalDraft.entryPrice,
              stopLoss: finalDraft.stopLoss,
              takeProfit: finalDraft.takeProfit,
            });
            setActiveTab('trades');
            setPanelOpen(true);
          }
        }
      },
      onMove: (_time, price) => {
        const cur = draftRef.current;
        if (!cur) return;
        const dec = SYMBOL_MAP.get(symbolRef.current)?.decimals ?? 2;
        const p = Number(price.toFixed(dec));
        if (cur.step === 'sl') {
          setDraft({ ...cur, stopLoss: p });
        } else if (cur.step === 'tp') {
          setDraft({ ...cur, takeProfit: p });
        }
      },
    });

    return () => {
      host.destroy();
      hostRef.current = null;
    };
  }, [handleBarUpdate]);

  // Push overlay data whenever trades, notes, draft, or symbol changes
  useEffect(() => {
    hostRef.current?.pushOverlayData({
      symbol,
      trades,
      notes,
      draft,
      selectedTradeId,
    });
  }, [symbol, trades, notes, draft, selectedTradeId, bars]);

  const handleSelectSymbol = async (sym: string) => {
    setSymbol(sym);
    await hostRef.current?.setMarket(sym, timeframe);
  };

  const handleSelectTimeframe = async (tf: string) => {
    setTimeframe(tf);
    await hostRef.current?.setMarket(symbol, tf);
  };

  const handleSelectLayout = (next: '1' | '2h' | '4') => {
    setLayout(next);
    hostRef.current?.setLayout(next);
  };

  const handleToggleReplay = () => {
    if (replayBarOpen) {
      hostRef.current?.ws.chart.replay.stop();
      setReplayBarOpen(false);
      setReplay(DEFAULT_REPLAY);
    } else {
      setReplayBarOpen(true);
    }
  };

  const isApproxGap = Boolean(hostRef.current?.dukascopyProvider.getApproxRange(symbol));

  const minBarTime = bars[0]?.time ?? Date.now() - 86_400_000 * 30;
  const maxBarTime = bars[bars.length - 1]?.time ?? Date.now();

  return (
    <div class="app-shell">
      <TopBar
        symbol={symbol}
        timeframe={timeframe}
        layout={layout}
        lastPrice={lastPrice}
        replayActive={replayBarOpen || replay.active}
        panelOpen={panelOpen}
        isApproxGap={isApproxGap}
        onSelectSymbol={handleSelectSymbol}
        onSelectTimeframe={handleSelectTimeframe}
        onSelectLayout={handleSelectLayout}
        onToggleReplay={handleToggleReplay}
        onOpenBacktest={() => {
          setActiveTab('backtest');
          setPanelOpen(true);
        }}
        onTogglePanel={() => setPanelOpen((v) => !v)}
      />

      {replayBarOpen && (
        <ReplayBar
          replay={replay}
          minTime={minBarTime}
          maxTime={maxBarTime}
          onStartFrom={async (fromMs) => {
            await hostRef.current?.ws.chart.replay.start({ from: fromMs });
            const st = hostRef.current?.ws.chart.replay.state;
            if (st) setReplay(st);
          }}
          onPlay={(intervalMs) => {
            hostRef.current?.ws.chart.replay.play(intervalMs);
            const st = hostRef.current?.ws.chart.replay.state;
            if (st) setReplay(st);
          }}
          onPause={() => {
            hostRef.current?.ws.chart.replay.pause();
            const st = hostRef.current?.ws.chart.replay.state;
            if (st) setReplay(st);
          }}
          onStep={() => {
            hostRef.current?.ws.chart.replay.step();
            const st = hostRef.current?.ws.chart.replay.state;
            if (st) setReplay(st);
          }}
          onStop={() => {
            hostRef.current?.ws.chart.replay.stop();
            setReplayBarOpen(false);
            setReplay(DEFAULT_REPLAY);
          }}
        />
      )}

      <div class="workspace-row">
        {/* Left custom journal tool rail */}
        <aside class="tool-rail">
          <button
            class={`tool-btn ${activeTool === 'cursor' ? 'active' : ''}`}
            title="Con trỏ"
            onClick={() => {
              setActiveTool('cursor');
              setDraft(null);
            }}
          >
            <MousePointer2 size={16} />
          </button>
          <button
            class={`tool-btn ${activeTool === 'long' ? 'active-bull' : ''}`}
            title="Ghi lệnh Long (Click Entry → SL → TP)"
            data-testid="tool-long-btn"
            onClick={() => {
              setActiveTool('long');
              setDraft(null);
            }}
          >
            <TrendingUp size={16} />
          </button>
          <button
            class={`tool-btn ${activeTool === 'short' ? 'active-bear' : ''}`}
            title="Ghi lệnh Short (Click Entry → SL → TP)"
            data-testid="tool-short-btn"
            onClick={() => {
              setActiveTool('short');
              setDraft(null);
            }}
          >
            <TrendingDown size={16} />
          </button>
          <button
            class={`tool-btn ${activeTool === 'note' ? 'active' : ''}`}
            title="Ghim ghi chú lên chart"
            data-testid="tool-note-btn"
            onClick={() => {
              setActiveTool('note');
              setDraft(null);
            }}
          >
            <MapPin size={16} />
          </button>
        </aside>

        {/* Chart workspace */}
        <main class="chart-stage">
          {activeTool !== 'cursor' && (
            <div class="tool-banner">
              <span>
                {activeTool === 'note'
                  ? 'Click lên biểu đồ để ghim ghi chú tại mức giá đó'
                  : !draft
                    ? `Ghi lệnh ${activeTool.toUpperCase()}: Bước 1/3 — Click chọn điểm vào (Entry)`
                    : draft.step === 'sl'
                      ? `Ghi lệnh ${activeTool.toUpperCase()}: Bước 2/3 — Click chọn Stop Loss`
                      : `Ghi lệnh ${activeTool.toUpperCase()}: Bước 3/3 — Click chọn Take Profit`}
              </span>
              <button
                class="btn"
                style={{ padding: '2px 6px' }}
                onClick={() => {
                  setActiveTool('cursor');
                  setDraft(null);
                }}
              >
                <X size={12} /> Hủy
              </button>
            </div>
          )}

          <div ref={containerRef} class="vela-container" data-testid="vela-chart-container" />
        </main>

        {/* Right tabbed panel */}
        {panelOpen && (
          <aside class="right-panel" data-testid="right-panel">
            <div class="tabs-header">
              {(
                [
                  ['trades', 'Lệnh'],
                  ['notes', 'Ghi chú'],
                  ['consistency', 'Độ nhất quán'],
                  ['strategies', 'Trường phái'],
                  ['backtest', 'Backtest'],
                  ['data', 'Dữ liệu'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  data-testid={`tab-${id}`}
                  class={`tab-btn ${activeTab === id ? 'active' : ''}`}
                  onClick={() => setActiveTab(id)}
                >
                  {label}
                </button>
              ))}
            </div>

            <div class="tab-body">
              {activeTab === 'trades' && (
                <TradesTab
                  symbol={symbol}
                  timeframe={timeframe}
                  lastPrice={lastPrice}
                  replayActive={replay.active}
                  strategies={strategies}
                  trades={trades}
                  seed={tradeSeed}
                  selectedTradeId={selectedTradeId}
                  onSelectTrade={setSelectedTradeId}
                  onSaveTrade={async (trade) => {
                    await db.trades.put(trade);
                    setTrades(await db.trades.toArray());
                  }}
                  onDeleteTrade={async (id) => {
                    await db.trades.delete(id);
                    setTrades(await db.trades.toArray());
                  }}
                  onClearSeed={() => setTradeSeed(null)}
                  onCaptureChart={async () => {
                    if (!hostRef.current) return '';
                    return hostRef.current.captureChartSnapshot();
                  }}
                  onGetDrawings={() => hostRef.current?.getDrawingsSnapshot() ?? null}
                  onRestoreDrawings={(doc) => hostRef.current?.restoreDrawingsSnapshot(doc) ?? false}
                />
              )}

              {activeTab === 'notes' && (
                <NotesTab
                  symbol={symbol}
                  lastPrice={lastPrice}
                  notes={notes}
                  seed={noteSeed}
                  onSaveNote={async (note) => {
                    await db.notes.put(note);
                    setNotes(await db.notes.toArray());
                  }}
                  onDeleteNote={async (id) => {
                    await db.notes.delete(id);
                    setNotes(await db.notes.toArray());
                  }}
                  onClearSeed={() => setNoteSeed(null)}
                />
              )}

              {activeTab === 'consistency' && (
                <ConsistencyTab strategies={strategies} trades={trades} />
              )}

              {activeTab === 'strategies' && (
                <StrategiesTab
                  strategies={strategies}
                  onSaveStrategy={async (s) => {
                    await db.strategies.put(s);
                    setStrategies(await db.strategies.orderBy('createdAt').toArray());
                  }}
                  onDeleteStrategy={async (id) => {
                    await db.strategies.delete(id);
                    setStrategies(await db.strategies.orderBy('createdAt').toArray());
                  }}
                />
              )}

              {activeTab === 'backtest' && (
                <BacktestTab
                  symbol={symbol}
                  timeframe={timeframe}
                  bars={bars.length > 0 ? bars : hostRef.current?.getActiveBars() ?? []}
                  strategies={strategies}
                  onSaveBacktestTrades={async (btTrades) => {
                    await db.trades.bulkPut(btTrades);
                    setTrades(await db.trades.toArray());
                  }}
                />
              )}

              {activeTab === 'data' && (
                <DataTab
                  tradeCount={trades.length}
                  noteCount={notes.length}
                  strategyCount={strategies.length}
                  onReloadData={loadDb}
                  onClearAllTradesAndNotes={async () => {
                    await Promise.all([db.trades.clear(), db.notes.clear()]);
                    await loadDb();
                  }}
                />
              )}
            </div>
          </aside>
        )}
      </div>

      <footer class="footer-bar">
        <span>Lịch sử: Dukascopy · Realtime: Gold-API / FXRates / Binance</span>
        <span>
          {symbol} · Khung {timeframe} · {bars.length} nến
        </span>
      </footer>
    </div>
  );
}
