import { VelaWorkspace } from '@luxalgo/vela/workspace';
import { registerLocale, registerRendererLayer, type RendererLayerArgs } from '@luxalgo/vela/plugin';
import viLocale from '@luxalgo/vela/locales/vi';
import type { OHLCV, ReplayState, Vela } from '@luxalgo/vela';
import { BinanceVisionProvider } from '../providers/binanceVisionProvider';
import { DukascopyPythProvider } from '../providers/dukascopyPythProvider';
import { registerJournalIndicators } from '../indicators/emaWma';
import { SYMBOL_MAP } from '../config/symbols';
import type { ChartNote, Trade, TradeSide } from '../db/journalDb';
import type { DraftPosition, JournalLayerPayload } from './journalLayer';
import {
  layoutPaneCount,
  loadWorkspaceState,
  normalizeLayout,
  PANE_IDS,
  resetWorkspaceState,
  saveWorkspaceState,
  type PersistedIndicator,
  type PersistedPaneState,
  type PersistedWorkspaceState,
  type WorkspaceLayout,
} from './workspacePersistence';

export type ActiveTool = 'cursor' | 'long' | 'short' | 'note';

export interface ChartSnapshot {
  symbol: string;
  timeframe: string;
  lastBar: OHLCV | null;
  bars: OHLCV[];
  replay: ReplayState;
}

interface CoordCache {
  canvas: HTMLCanvasElement;
  args: RendererLayerArgs;
}

const coordCaches = new WeakMap<HTMLCanvasElement, CoordCache>();
let lastActiveCanvas: HTMLCanvasElement | null = null;
let localesRegistered = false;
let currentOverlayPayload: JournalLayerPayload = {
  symbol: 'BTCUSDT',
  trades: [],
  notes: [],
  draft: null,
  selectedTradeId: null,
};
const layerRepainters = new Set<() => void>();
let onLayerBarsPainted: ((bars: readonly OHLCV[], canvas: HTMLCanvasElement) => void) | null = null;

function ensureViLocale() {
  if (localesRegistered) return;
  localesRegistered = true;
  registerLocale(viLocale);
}

function drawRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const rad = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, rad);
}

function drawPositionBox(
  ctx: CanvasRenderingContext2D,
  args: RendererLayerArgs,
  opts: {
    entryTime: number;
    endTime: number;
    entryPrice?: number;
    stopLoss?: number;
    takeProfit?: number;
    side: TradeSide;
    label: string;
    selected?: boolean;
    isDraft?: boolean;
  }
) {
  if (opts.entryPrice === undefined || !Number.isFinite(opts.entryPrice)) return;
  const { coords, scale, bounds } = args;
  const x1 = coords.timeToX(opts.entryTime);
  let x2 = coords.timeToX(opts.endTime);
  if (!Number.isFinite(x1)) return;
  if (!Number.isFinite(x2) || x2 <= x1 + 28) {
    x2 = x1 + 96;
  }

  const yEntry = coords.priceToY(opts.entryPrice, scale, bounds);
  if (!Number.isFinite(yEntry)) return;
  const ySl =
    opts.stopLoss !== undefined && Number.isFinite(opts.stopLoss)
      ? coords.priceToY(opts.stopLoss, scale, bounds)
      : NaN;
  const yTp =
    opts.takeProfit !== undefined && Number.isFinite(opts.takeProfit)
      ? coords.priceToY(opts.takeProfit, scale, bounds)
      : NaN;

  const boxW = Math.max(40, x2 - x1);

  const tpTop = Number.isFinite(yTp) ? Math.min(yEntry, yTp) : yEntry;
  const tpH = Number.isFinite(yTp) ? Math.abs(yTp - yEntry) : 0;
  if (tpH > 1) {
    ctx.fillStyle = opts.isDraft ? 'rgba(0, 245, 155, 0.24)' : 'rgba(0, 245, 155, 0.14)';
    ctx.fillRect(x1, tpTop, boxW, tpH);
    ctx.strokeStyle = 'rgba(0, 245, 155, 0.8)';
    ctx.lineWidth = opts.selected ? 2 : 1;
    ctx.strokeRect(x1, tpTop, boxW, tpH);
  }

  const slTop = Number.isFinite(ySl) ? Math.min(yEntry, ySl) : yEntry;
  const slH = Number.isFinite(ySl) ? Math.abs(ySl - yEntry) : 0;
  if (slH > 1) {
    ctx.fillStyle = opts.isDraft ? 'rgba(255, 59, 92, 0.24)' : 'rgba(255, 59, 92, 0.14)';
    ctx.fillRect(x1, slTop, boxW, slH);
    ctx.strokeStyle = 'rgba(255, 59, 92, 0.8)';
    ctx.lineWidth = opts.selected ? 2 : 1;
    ctx.strokeRect(x1, slTop, boxW, slH);
  }

  ctx.save();
  ctx.strokeStyle = opts.selected ? '#ffffff' : '#94a3b8';
  ctx.lineWidth = opts.selected ? 2 : 1.2;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(x1, yEntry);
  ctx.lineTo(x1 + boxW, yEntry);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  const isLong = opts.side === 'long';
  ctx.fillStyle = isLong ? '#00F59B' : '#FF3B5C';
  ctx.beginPath();
  if (isLong) {
    ctx.moveTo(x1, yEntry + 2);
    ctx.lineTo(x1 - 6, yEntry + 12);
    ctx.lineTo(x1 + 6, yEntry + 12);
  } else {
    ctx.moveTo(x1, yEntry - 2);
    ctx.lineTo(x1 - 6, yEntry - 12);
    ctx.lineTo(x1 + 6, yEntry - 12);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.font = '600 11px Inter, sans-serif';
  const tw = ctx.measureText(opts.label).width;
  const padX = 6;
  const badgeW = tw + padX * 2;
  const badgeH = 18;
  const bx = x1 + 4;
  const by = isLong ? tpTop + 4 : slTop + 4;
  ctx.fillStyle = 'rgba(11, 15, 23, 0.9)';
  drawRoundRect(ctx, bx, by, badgeW, badgeH, 4);
  ctx.fill();
  ctx.strokeStyle = isLong ? '#00F59B' : '#FF3B5C';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = '#f8fafc';
  ctx.textBaseline = 'middle';
  ctx.fillText(opts.label, bx + padX, by + badgeH / 2);
  ctx.restore();
}

let layerRegistered = false;
function ensureJournalLayer() {
  if (layerRegistered) return;
  layerRegistered = true;

  registerRendererLayer({
    id: 'journal.overlays',
    placement: 'above-data',
    repaintOnCursor: true,
    create: () => {
      let canvas: HTMLCanvasElement | null = null;
      let ctx: CanvasRenderingContext2D | null = null;
      let lastArgs: RendererLayerArgs | null = null;

      const paint = (args: RendererLayerArgs) => {
        if (!canvas || !ctx) return;
        lastArgs = args;
        lastActiveCanvas = canvas;
        coordCaches.set(canvas, { canvas, args });
        if (args.bars.length > 0) {
          onLayerBarsPainted?.(args.bars, canvas);
        }

        const dpr = args.coords.dpr || window.devicePixelRatio || 1;
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.scale(dpr, dpr);

        ctx.beginPath();
        ctx.rect(0, args.bounds.top, args.coords.width, args.bounds.height);
        ctx.clip();

        const payload = currentOverlayPayload;
        if (!payload) {
          ctx.restore();
          return;
        }

        const lastBarTime =
          args.bars.length > 0
            ? args.bars[args.bars.length - 1]!.time + args.coords.barInterval * 6
            : Date.now();

        for (const t of payload.trades) {
          if (t.symbol !== payload.symbol) continue;
          if (t.entryPrice === undefined || !Number.isFinite(t.entryPrice)) continue;
          const endTime =
            t.exitTime ?? Math.max(lastBarTime, t.entryTime + args.coords.barInterval * 8);
          const hasSl = t.stopLoss !== undefined && Number.isFinite(t.stopLoss);
          const hasTp = t.takeProfit !== undefined && Number.isFinite(t.takeProfit);
          const risk = hasSl ? Math.abs(t.entryPrice - t.stopLoss!) : 0;
          const reward = hasTp ? Math.abs(t.takeProfit! - t.entryPrice) : 0;
          const rr = hasSl && hasTp && risk > 0 ? (reward / risk).toFixed(2) : null;
          const prefix = t.side === 'long' ? 'LONG' : 'SHORT';
          const modeTag =
            t.mode === 'replay' ? ' [Replay]' : t.mode === 'backtest' ? ' [BT]' : '';
          const hasR = typeof t.rMultiple === 'number' && Number.isFinite(t.rMultiple);
          const label =
            t.status === 'closed'
              ? hasR
                ? `${prefix}${modeTag} ${t.rMultiple! >= 0 ? '+' : ''}${t.rMultiple}R`
                : `${prefix}${modeTag}`
              : rr !== null
                ? `${prefix}${modeTag} R:R 1:${rr}`
                : `${prefix}${modeTag}`;

          drawPositionBox(ctx, args, {
            entryTime: t.entryTime,
            endTime,
            entryPrice: t.entryPrice,
            stopLoss: t.stopLoss,
            takeProfit: t.takeProfit,
            side: t.side,
            label,
            selected: payload.selectedTradeId === t.id,
          });
        }

        if (payload.draft) {
          const d = payload.draft;
          const risk = Math.abs(d.entryPrice - d.stopLoss);
          const reward = Math.abs(d.takeProfit - d.entryPrice);
          const rr = risk > 0 ? (reward / risk).toFixed(2) : '—';
          drawPositionBox(ctx, args, {
            entryTime: d.entryTime,
            endTime: d.entryTime + args.coords.barInterval * 12,
            entryPrice: d.entryPrice,
            stopLoss: d.stopLoss,
            takeProfit: d.takeProfit,
            side: d.side,
            label: `${d.side.toUpperCase()} · R:R 1:${rr}`,
            selected: true,
            isDraft: true,
          });
        }

        let hoveredNote: { note: ChartNote; x: number; y: number } | null = null;
        for (const n of payload.notes) {
          if (n.symbol !== payload.symbol) continue;
          const nx = args.coords.timeToX(n.time);
          const ny = args.coords.priceToY(n.price, args.scale, args.bounds);
          if (!Number.isFinite(nx) || !Number.isFinite(ny)) continue;

          ctx.save();
          ctx.fillStyle = n.color || '#38bdf8';
          ctx.strokeStyle = '#0b0f17';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(nx, ny, 7, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = '#0b0f17';
          ctx.font = '700 9px Inter, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('N', nx, ny + 0.5);
          ctx.restore();

          if (args.cursor) {
            const dist = Math.hypot(args.cursor.x - nx, args.cursor.y - ny);
            if (dist <= 18) {
              hoveredNote = { note: n, x: nx, y: ny };
            }
          }
        }

        if (hoveredNote) {
          const { note, x, y } = hoveredNote;
          ctx.save();
          ctx.font = '500 12px Inter, sans-serif';
          const lines = note.text.slice(0, 140).split('\n').slice(0, 3);
          const maxW = Math.min(
            280,
            Math.max(...lines.map((l) => ctx!.measureText(l).width), 80) + 18
          );
          const boxH = lines.length * 16 + 14;
          const bx = Math.min(args.coords.width - maxW - 8, Math.max(8, x + 12));
          const by = Math.max(args.bounds.top + 8, y - boxH - 8);

          ctx.fillStyle = '#131f33';
          ctx.strokeStyle = note.color || '#38bdf8';
          ctx.lineWidth = 1.5;
          drawRoundRect(ctx, bx, by, maxW, boxH, 6);
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = '#f1f5f9';
          ctx.textBaseline = 'top';
          lines.forEach((line, idx) => {
            ctx!.fillText(line, bx + 9, by + 7 + idx * 16, maxW - 18);
          });
          ctx.restore();
        }

        ctx.restore();
      };

      const repainter = () => {
        if (lastArgs) paint(lastArgs);
      };

      return {
        mount(el: HTMLCanvasElement) {
          canvas = el;
          ctx = el.getContext('2d');
          lastActiveCanvas = el;
          layerRepainters.add(repainter);
        },
        render: paint,
      };
    },
  });
}

export class VelaJournalHost {
  public ws: VelaWorkspace;
  public dukascopyProvider: DukascopyPythProvider;
  private container: HTMLElement;
  private binanceProvider: BinanceVisionProvider;
  private latestBars: OHLCV[] = [];
  private onSnapshot?: (snap: ChartSnapshot) => void;
  private onLayoutChange?: (layout: WorkspaceLayout) => void;
  private savedState: PersistedWorkspaceState;
  private attachedCharts = new WeakSet<Vela>();
  private readyCharts = new WeakSet<Vela>();
  private restoringDrawings = new WeakSet<Vela>();
  private saveTimer: number | null = null;
  private destroyed = false;
  private toolHandler?: {
    getTool: () => ActiveTool;
    onClick: (time: number, price: number) => void;
    onMove: (time: number, price: number) => void;
  };

  private handleBeforeUnload = () => {
    this.saveNow();
  };

  constructor(
    container: HTMLElement,
    opts: {
      initialSymbol?: string;
      initialTimeframe?: string;
      onSnapshot?: (snap: ChartSnapshot) => void;
      onBarUpdate?: (bar: OHLCV, symbol: string, timeframe: string) => void;
      onLayoutChange?: (layout: WorkspaceLayout) => void;
    }
  ) {
    this.container = container;
    this.onSnapshot = opts.onSnapshot;
    this.onLayoutChange = opts.onLayoutChange;
    ensureViLocale();
    registerJournalIndicators();
    ensureJournalLayer();

    this.binanceProvider = new BinanceVisionProvider();
    this.dukascopyProvider = new DukascopyPythProvider();

    this.savedState = loadWorkspaceState();
    const activeIdx = Math.min(
      this.savedState.activePaneIndex,
      layoutPaneCount(this.savedState.layout) - 1
    );
    const activeSeed = this.savedState.panes[activeIdx] ?? {
      symbol: opts.initialSymbol ?? 'BTCUSDT',
      timeframe: opts.initialTimeframe ?? '60',
    };

    const cells: Record<string, { symbol: string; timeframe: string }> = {};
    for (let i = 0; i < PANE_IDS.length; i++) {
      const p = this.savedState.panes[i];
      cells[PANE_IDS[i]!] = {
        symbol: p?.symbol ?? opts.initialSymbol ?? 'BTCUSDT',
        timeframe: p?.timeframe ?? opts.initialTimeframe ?? '60',
      };
    }

    this.ws = new VelaWorkspace(container, {
      layout: this.savedState.layout,
      symbol: activeSeed.symbol,
      timeframe: activeSeed.timeframe,
      cells,
      theme: 'dark',
      live: true,
      volume: true,
      statusline: true,
      watermark: true,
      topbar: { left: ['symbol', 'timeframe', 'indicators'], right: ['fullscreen'] },
      providers: {
        binance: () => this.binanceProvider,
        fx: () => this.dukascopyProvider,
      },
      upColor: '#00F59B',
      downColor: '#FF3B5C',
    });

    const activeTargetId = PANE_IDS[activeIdx];
    if (activeIdx > 0 && activeTargetId && this.ws.cell(activeTargetId)) {
      this.ws.setActiveCell(activeTargetId);
    }

    this.ws.setLocale('vi');
    onLayerBarsPainted = (bars, canvas) => {
      if (bars.length === 0) return;
      if (!this.isCanvasInActiveCell(canvas)) return;
      const prevLast = this.latestBars[this.latestBars.length - 1];
      const nextLast = bars[bars.length - 1]!;
      if (
        this.latestBars.length !== bars.length ||
        prevLast?.time !== nextLast.time ||
        prevLast?.close !== nextLast.close
      ) {
        this.latestBars = [...bars];
        this.emitSnapshot(this.ws.chart);
      }
    };
    this.wireChartEvents(opts.onBarUpdate);
    this.wirePointerOverlay(container);
    window.addEventListener('beforeunload', this.handleBeforeUnload);
  }

  private isCanvasInActiveCell(canvas: HTMLCanvasElement | null): boolean {
    if (!canvas) return false;
    try {
      return Boolean(this.ws.active?.host?.contains(canvas));
    } catch {
      return false;
    }
  }

  private getActiveCanvas(): HTMLCanvasElement | null {
    try {
      const host = this.ws.active?.host;
      if (host) {
        const canvases = Array.from(host.querySelectorAll('canvas'));
        for (let i = canvases.length - 1; i >= 0; i--) {
          const c = canvases[i]!;
          if (coordCaches.has(c)) return c;
        }
      }
    } catch {
      // ignore
    }
    return lastActiveCanvas;
  }

  private getPaneIndex(cellId: string): number {
    const known = PANE_IDS.indexOf(cellId as (typeof PANE_IDS)[number]);
    if (known >= 0) return known;
    const liveIdx = this.ws.cells().findIndex((c) => c.id === cellId);
    return liveIdx >= 0 ? liveIdx : 0;
  }

  private scheduleSave() {
    if (this.destroyed) return;
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
    }
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      this.saveNow();
    }, 250);
  }

  public saveNow(): PersistedWorkspaceState {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const nextPanes: PersistedPaneState[] = [];
    for (let i = 0; i < 4; i++) {
      const prev = this.savedState.panes[i];
      nextPanes.push(
        prev
          ? {
              symbol: prev.symbol,
              timeframe: prev.timeframe,
              ...(prev.drawings !== undefined ? { drawings: prev.drawings } : {}),
              ...(prev.indicators !== undefined ? { indicators: prev.indicators } : {}),
            }
          : { symbol: 'BTCUSDT', timeframe: '60' }
      );
    }

    for (const cell of this.ws.cells()) {
      const idx = this.getPaneIndex(cell.id);
      if (idx < 0 || idx >= 4) continue;
      const prev = nextPanes[idx]!;
      const chart = cell.chart;
      const symbol = (chart.market.symbol ?? prev.symbol ?? 'BTCUSDT').toUpperCase();
      const timeframe = chart.market.timeframe ?? prev.timeframe ?? '60';

      let drawings = prev.drawings;
      let indicators = prev.indicators;

      if (this.readyCharts.has(chart)) {
        try {
          const doc = chart.drawings.toJSON();
          drawings = doc && Array.isArray(doc.drawings) && doc.drawings.length > 0 ? doc : undefined;
        } catch {
          // keep previous drawings
        }

        try {
          const inds: PersistedIndicator[] = [];
          for (const h of chart.indicators()) {
            if (!h.nativeType) continue;
            const inputs = h.inputValues();
            const entry: PersistedIndicator = { type: h.nativeType };
            if (inputs && Object.keys(inputs).length > 0) {
              entry.inputs = { ...inputs };
            }
            inds.push(entry);
          }
          indicators = inds;
        } catch {
          // keep previous indicators
        }
      }

      nextPanes[idx] = {
        symbol,
        timeframe,
        ...(drawings !== undefined ? { drawings } : {}),
        ...(indicators !== undefined ? { indicators } : {}),
      };
    }

    const layout = normalizeLayout(this.ws.layout.id);
    const activeIdxRaw = this.getPaneIndex(this.ws.active.id);
    const activePaneIndex = Math.max(0, Math.min(layoutPaneCount(layout) - 1, activeIdxRaw));

    const snapshot: PersistedWorkspaceState = {
      version: 1,
      layout,
      activePaneIndex,
      panes: nextPanes,
    };
    this.savedState = snapshot;
    saveWorkspaceState(snapshot);
    return snapshot;
  }

  private applyPaneContent(cellId: string, chart: Vela) {
    const idx = this.getPaneIndex(cellId);
    const savedPane = this.savedState.panes[idx];
    const present = new Set(chart.presentNativeIndicators());

    if (savedPane && Array.isArray(savedPane.indicators)) {
      for (const ind of savedPane.indicators) {
        if (!ind.type) continue;
        if (ind.type.toLowerCase().includes('volume') && present.has(ind.type)) continue;
        if (!present.has(ind.type)) {
          try {
            chart.addNativeIndicator(
              ind.type,
              ind.inputs ? { inputs: ind.inputs as Record<string, never> } : undefined
            );
            present.add(ind.type);
          } catch {
            // ignore unsupported indicator
          }
        }
      }
    } else {
      if (!present.has('journal.ema9')) {
        chart.addNativeIndicator('journal.ema9', { inputs: { length: 9 } });
      }
      if (!present.has('journal.wma45')) {
        chart.addNativeIndicator('journal.wma45', { inputs: { length: 45 } });
      }
      if (!present.has('journal.rsi_ema_wma')) {
        chart.addNativeIndicator('journal.rsi_ema_wma', {
          inputs: { rsiLength: 14, emaLength: 9, wmaLength: 45 },
        });
      }
    }

    if (savedPane?.drawings) {
      this.restoringDrawings.add(chart);
      try {
        chart.drawings.fromJSON(savedPane.drawings);
      } catch {
        // ignore malformed drawings
      } finally {
        this.restoringDrawings.delete(chart);
      }
    }
  }

  private wireChartEvents(
    onBarUpdate?: (bar: OHLCV, symbol: string, timeframe: string) => void
  ) {
    const attach = (cellId: string, chart: Vela) => {
      if (this.attachedCharts.has(chart)) return;
      this.attachedCharts.add(chart);

      const syncVolume = () => {
        const sym = (chart.market.symbol ?? 'BTCUSDT').toUpperCase();
        const isFx = SYMBOL_MAP.get(sym)?.group === 'forex';
        const vol = chart
          .indicators()
          .find(
            (ind) =>
              ind.id.toLowerCase().includes('volume') ||
              ind.title.toLowerCase().includes('volume') ||
              ind.title.toLowerCase().includes('khối lượng')
          );
        if (isFx && vol) {
          vol.remove();
        }
      };

      chart.ready().then(() => {
        if (this.destroyed) return;
        this.readyCharts.add(chart);
        this.applyPaneContent(cellId, chart);
        syncVolume();
        if (chart === this.ws.chart) {
          this.emitSnapshot(chart);
        }
        this.scheduleSave();
      });

      chart.on('load:start', () => {
        if (chart === this.ws.chart) {
          this.latestBars = [];
        }
      });
      chart.on('load:end', () => {
        syncVolume();
        if (chart === this.ws.chart) {
          this.emitSnapshot(chart);
        }
      });
      chart.on('market:changed', () => {
        syncVolume();
        this.scheduleSave();
        if (chart === this.ws.chart) {
          this.emitSnapshot(chart);
        }
      });
      chart.on('drawing:created', () => this.scheduleSave());
      chart.on('drawing:edited', () => this.scheduleSave());
      chart.on('drawing:removed', () => this.scheduleSave());
      chart.on('drawing:history', () => this.scheduleSave());
      chart.on('drawing:replaced', () => {
        if (!this.restoringDrawings.has(chart)) {
          this.scheduleSave();
        }
      });
      chart.on('indicator:added', () => {
        if (this.readyCharts.has(chart)) this.scheduleSave();
      });
      chart.on('indicator:removed', () => {
        if (this.readyCharts.has(chart)) this.scheduleSave();
      });
      chart.on('indicator:inputs', () => {
        if (this.readyCharts.has(chart)) this.scheduleSave();
      });
      chart.on('bar', (ev: unknown) => {
        const bar = (ev as { bar?: OHLCV })?.bar ?? (ev as OHLCV);
        if (bar && typeof bar.close === 'number' && chart === this.ws.chart) {
          onBarUpdate?.(bar, chart.market.symbol ?? 'BTCUSDT', chart.market.timeframe ?? '60');
          this.emitSnapshot(chart);
        }
      });
    };

    for (const cell of this.ws.cells()) {
      attach(cell.id, cell.chart);
    }
    this.ws.on('cell:created', (ev: unknown) => {
      const id = (ev as { id?: string; cell?: { id?: string } })?.id ?? (ev as { cell?: { id?: string } })?.cell?.id;
      const cell = id ? this.ws.cell(id) : undefined;
      if (cell) attach(cell.id, cell.chart);
    });
    this.ws.on('cell:active', () => {
      this.latestBars = [];
      this.scheduleSave();
      this.emitSnapshot(this.ws.chart);
    });
    this.ws.on('layout:changed', (ev: unknown) => {
      const next = normalizeLayout((ev as { layout?: string })?.layout ?? this.ws.layout.id);
      this.onLayoutChange?.(next);
      this.scheduleSave();
      this.emitSnapshot(this.ws.chart);
    });
  }

  private emitSnapshot(chart: Vela) {
    const activeCanvas = this.getActiveCanvas();
    const cache = activeCanvas ? coordCaches.get(activeCanvas) : undefined;
    const bars = cache?.args.bars ? [...cache.args.bars] : this.latestBars;
    if (bars.length > 0) this.latestBars = bars;
    const lastBar = bars.length > 0 ? bars[bars.length - 1]! : null;
    this.onSnapshot?.({
      symbol: chart.market.symbol ?? 'BTCUSDT',
      timeframe: chart.market.timeframe ?? '60',
      lastBar,
      bars,
      replay: chart.replay.state,
    });
  }

  private wirePointerOverlay(container: HTMLElement) {
    const resolvePoint = (ev: MouseEvent): { time: number; price: number } | null => {
      const activeCanvas = this.getActiveCanvas();
      if (!activeCanvas) return null;
      const cache = coordCaches.get(activeCanvas);
      if (!cache) return null;
      const rect = activeCanvas.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      if (x < 0 || y < 0 || x > rect.width || y > rect.height) return null;
      const { coords, scale, bounds } = cache.args;
      const logical = coords.xToLogical(x);
      const time = coords.logicalToTime(logical);
      const price = coords.yToPrice(y, scale, bounds);
      if (!Number.isFinite(time) || !Number.isFinite(price)) return null;
      return { time, price };
    };

    container.addEventListener(
      'mousedown',
      (ev) => {
        if (!this.toolHandler) return;
        const tool = this.toolHandler.getTool();
        if (tool === 'cursor') return;
        const pt = resolvePoint(ev);
        if (!pt) return;
        ev.stopPropagation();
        ev.preventDefault();
        this.toolHandler.onClick(pt.time, pt.price);
      },
      true
    );

    container.addEventListener('mousemove', (ev) => {
      if (!this.toolHandler) return;
      const tool = this.toolHandler.getTool();
      if (tool === 'cursor') return;
      const pt = resolvePoint(ev);
      if (!pt) return;
      this.toolHandler.onMove(pt.time, pt.price);
    });
  }

  setToolHandler(handler: typeof this.toolHandler) {
    this.toolHandler = handler;
  }

  pushOverlayData(payload: JournalLayerPayload) {
    currentOverlayPayload = payload;
    for (const repaint of layerRepainters) {
      repaint();
    }
  }

  async setMarket(symbol: string, timeframe: string) {
    await this.ws.chart.setMarket({ symbol, timeframe });
    this.saveNow();
    this.emitSnapshot(this.ws.chart);
  }

  async reloadMarket() {
    const sym = this.ws.chart.market.symbol ?? 'BTCUSDT';
    const tf = this.ws.chart.market.timeframe ?? '60';
    const altTf = tf === '60' ? '15' : '60';
    await this.ws.chart.setMarket({ symbol: sym, timeframe: altTf });
    await this.ws.chart.setMarket({ symbol: sym, timeframe: tf });
    this.emitSnapshot(this.ws.chart);
  }

  setLayout(layout: WorkspaceLayout) {
    this.saveNow();
    this.ws.setLayout(layout);
    this.saveNow();
  }

  async applyWorkspaceState(next: PersistedWorkspaceState) {
    this.savedState = next;
    saveWorkspaceState(next);
    this.ws.setLayout(next.layout);
    const cells = this.ws.cells();
    for (const cell of cells) {
      const idx = this.getPaneIndex(cell.id);
      const target = next.panes[idx];
      if (!target) continue;
      if (
        cell.chart.market.symbol !== target.symbol ||
        cell.chart.market.timeframe !== target.timeframe
      ) {
        await cell.chart.setMarket({ symbol: target.symbol, timeframe: target.timeframe });
      }
      this.applyPaneContent(cell.id, cell.chart);
    }
    const activeId = PANE_IDS[next.activePaneIndex];
    if (activeId && this.ws.cell(activeId)) {
      this.ws.setActiveCell(activeId);
    }
    this.saveNow();
    this.emitSnapshot(this.ws.chart);
  }

  async resetWorkspace(): Promise<PersistedWorkspaceState> {
    const fresh = resetWorkspaceState();
    await this.applyWorkspaceState(fresh);
    return fresh;
  }

  getActiveBars(): OHLCV[] {
    const activeCanvas = this.getActiveCanvas();
    const cache = activeCanvas ? coordCaches.get(activeCanvas) : undefined;
    return cache?.args.bars ? [...cache.args.bars] : this.latestBars;
  }

  getDrawingsSnapshot(): unknown {
    try {
      const doc = this.ws.chart.drawings.toJSON();
      if (!doc || !Array.isArray(doc.drawings) || doc.drawings.length === 0) {
        return null;
      }
      return doc;
    } catch {
      return null;
    }
  }

  restoreDrawingsSnapshot(doc: unknown): boolean {
    if (!doc) return false;
    try {
      this.ws.chart.drawings.fromJSON(doc);
      return true;
    } catch {
      return false;
    }
  }

  async captureChartSnapshot(): Promise<string> {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    let sourceCanvas: HTMLCanvasElement | null = null;
    try {
      sourceCanvas = this.ws.chart.renderer.screenshotCanvas();
    } catch {
      sourceCanvas = null;
    }

    if (!sourceCanvas || sourceCanvas.width === 0 || sourceCanvas.height === 0) {
      // Fallback: composite all visible canvases inside the chart container
      const rect = this.container.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const fallback = document.createElement('canvas');
      fallback.width = Math.max(1, Math.round(rect.width * dpr));
      fallback.height = Math.max(1, Math.round(rect.height * dpr));
      const fctx = fallback.getContext('2d');
      if (fctx) {
        fctx.fillStyle = '#0b0f17';
        fctx.fillRect(0, 0, fallback.width, fallback.height);
        const canvases = Array.from(this.container.querySelectorAll('canvas'));
        for (const c of canvases) {
          if (c.width === 0 || c.height === 0) continue;
          const cr = c.getBoundingClientRect();
          if (cr.width === 0 || cr.height === 0) continue;
          const dx = (cr.left - rect.left) * dpr;
          const dy = (cr.top - rect.top) * dpr;
          const dw = cr.width * dpr;
          const dh = cr.height * dpr;
          try {
            fctx.drawImage(c, dx, dy, dw, dh);
          } catch {
            // ignore tainted or unready canvas
          }
        }
      }
      sourceCanvas = fallback;
    }

    const maxWidth = 1440;
    const scale = sourceCanvas.width > maxWidth ? maxWidth / sourceCanvas.width : 1;
    const outW = Math.max(1, Math.round(sourceCanvas.width * scale));
    const outH = Math.max(1, Math.round(sourceCanvas.height * scale));

    const out = document.createElement('canvas');
    out.width = outW;
    out.height = outH;
    const ctx = out.getContext('2d');
    if (!ctx) {
      return sourceCanvas.toDataURL('image/jpeg', 0.85);
    }

    ctx.fillStyle = '#0b0f17';
    ctx.fillRect(0, 0, outW, outH);
    ctx.drawImage(sourceCanvas, 0, 0, outW, outH);

    // Draw compact symbol / timeframe / timestamp badge
    const sym = this.ws.chart.market.symbol ?? 'CHART';
    const tf = this.ws.chart.market.timeframe ?? '';
    const nowStr = new Date().toLocaleString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    const badgeText = `${sym}${tf ? ` · ${tf}` : ''} · ${nowStr}`;
    ctx.save();
    ctx.font = '600 11px Inter, system-ui, sans-serif';
    const tw = ctx.measureText(badgeText).width;
    const bw = tw + 14;
    const bh = 22;
    const bx = Math.max(12, outW - bw - 78);
    const by = 10;
    ctx.fillStyle = 'rgba(11, 15, 23, 0.82)';
    drawRoundRect(ctx, bx, by, bw, bh, 6);
    ctx.fill();
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#f8fafc';
    ctx.textBaseline = 'middle';
    ctx.fillText(badgeText, bx + 8, by + bh / 2);
    ctx.restore();

    const webp = out.toDataURL('image/webp', 0.85);
    if (webp.startsWith('data:image/webp')) {
      return webp;
    }
    return out.toDataURL('image/jpeg', 0.85);
  }

  destroy() {
    this.saveNow();
    this.destroyed = true;
    window.removeEventListener('beforeunload', this.handleBeforeUnload);
    this.ws.destroy();
  }
}
