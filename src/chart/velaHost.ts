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
let onLayerBarsPainted: ((bars: readonly OHLCV[]) => void) | null = null;

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
    entryPrice: number;
    stopLoss: number;
    takeProfit: number;
    side: TradeSide;
    label: string;
    selected?: boolean;
    isDraft?: boolean;
  }
) {
  const { coords, scale, bounds } = args;
  const x1 = coords.timeToX(opts.entryTime);
  let x2 = coords.timeToX(opts.endTime);
  if (!Number.isFinite(x1)) return;
  if (!Number.isFinite(x2) || x2 <= x1 + 28) {
    x2 = x1 + 96;
  }

  const yEntry = coords.priceToY(opts.entryPrice, scale, bounds);
  const ySl = coords.priceToY(opts.stopLoss, scale, bounds);
  const yTp = coords.priceToY(opts.takeProfit, scale, bounds);
  if (!Number.isFinite(yEntry) || !Number.isFinite(ySl) || !Number.isFinite(yTp)) return;

  const boxW = Math.max(40, x2 - x1);

  const tpTop = Math.min(yEntry, yTp);
  const tpH = Math.abs(yTp - yEntry);
  if (tpH > 1) {
    ctx.fillStyle = opts.isDraft ? 'rgba(0, 245, 155, 0.24)' : 'rgba(0, 245, 155, 0.14)';
    ctx.fillRect(x1, tpTop, boxW, tpH);
    ctx.strokeStyle = 'rgba(0, 245, 155, 0.8)';
    ctx.lineWidth = opts.selected ? 2 : 1;
    ctx.strokeRect(x1, tpTop, boxW, tpH);
  }

  const slTop = Math.min(yEntry, ySl);
  const slH = Math.abs(ySl - yEntry);
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
          onLayerBarsPainted?.(args.bars);
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
          const endTime =
            t.exitTime ?? Math.max(lastBarTime, t.entryTime + args.coords.barInterval * 8);
          const risk = Math.abs(t.entryPrice - t.stopLoss);
          const reward = Math.abs(t.takeProfit - t.entryPrice);
          const rr = risk > 0 ? (reward / risk).toFixed(2) : '0.00';
          const prefix = t.side === 'long' ? 'LONG' : 'SHORT';
          const modeTag =
            t.mode === 'replay' ? ' [Replay]' : t.mode === 'backtest' ? ' [BT]' : '';
          const label =
            t.status === 'closed'
              ? `${prefix}${modeTag} ${t.rMultiple >= 0 ? '+' : ''}${t.rMultiple}R`
              : `${prefix}${modeTag} R:R 1:${rr}`;

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
  private binanceProvider: BinanceVisionProvider;
  private latestBars: OHLCV[] = [];
  private onSnapshot?: (snap: ChartSnapshot) => void;
  private toolHandler?: {
    getTool: () => ActiveTool;
    onClick: (time: number, price: number) => void;
    onMove: (time: number, price: number) => void;
  };

  constructor(
    container: HTMLElement,
    opts: {
      initialSymbol?: string;
      initialTimeframe?: string;
      onSnapshot?: (snap: ChartSnapshot) => void;
      onBarUpdate?: (bar: OHLCV, symbol: string, timeframe: string) => void;
    }
  ) {
    this.onSnapshot = opts.onSnapshot;
    ensureViLocale();
    registerJournalIndicators();
    ensureJournalLayer();

    this.binanceProvider = new BinanceVisionProvider();
    this.dukascopyProvider = new DukascopyPythProvider();

    this.ws = new VelaWorkspace(container, {
      layout: '1',
      symbol: opts.initialSymbol ?? 'BTCUSDT',
      timeframe: opts.initialTimeframe ?? '60',
      theme: 'dark',
      live: true,
      volume: true,
      statusline: true,
      watermark: true,
      topbar: { left: ['symbol', 'timeframe', 'indicators'], right: ['fullscreen'] },
      persist: 'trading-journal-ws-v1',
      providers: {
        binance: () => this.binanceProvider,
        fx: () => this.dukascopyProvider,
      },
      upColor: '#00F59B',
      downColor: '#FF3B5C',
    });

    this.ws.setLocale('vi');
    onLayerBarsPainted = (bars) => {
      if (bars.length === 0) return;
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
  }

  private wireChartEvents(
    onBarUpdate?: (bar: OHLCV, symbol: string, timeframe: string) => void
  ) {
    const attach = (chart: Vela) => {
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

      // Enable EMA 9 and WMA 45 by default if none present
      chart.ready().then(() => {
        const present = chart.presentNativeIndicators();
        if (!present.includes('journal.ema9')) {
          chart.addNativeIndicator('journal.ema9', { inputs: { length: 9 } });
        }
        if (!present.includes('journal.wma45')) {
          chart.addNativeIndicator('journal.wma45', { inputs: { length: 45 } });
        }
        syncVolume();
        this.emitSnapshot(chart);
      });

      chart.on('load:start', () => {
        this.latestBars = [];
      });
      chart.on('load:end', () => {
        syncVolume();
        this.emitSnapshot(chart);
      });
      chart.on('market:changed', () => {
        syncVolume();
        this.emitSnapshot(chart);
      });
      chart.on('bar', (ev: unknown) => {
        const bar = (ev as { bar?: OHLCV })?.bar ?? (ev as OHLCV);
        if (bar && typeof bar.close === 'number') {
          onBarUpdate?.(bar, chart.market.symbol ?? 'BTCUSDT', chart.market.timeframe ?? '60');
          this.emitSnapshot(chart);
        }
      });
    };

    for (const cell of this.ws.cells()) {
      attach(cell.chart);
    }
    this.ws.on('cell:created', (ev: unknown) => {
      const cell = (ev as { cell?: { chart: Vela } })?.cell;
      if (cell?.chart) attach(cell.chart);
    });
    this.ws.on('cell:active', () => {
      this.emitSnapshot(this.ws.chart);
    });
  }

  private emitSnapshot(chart: Vela) {
    const cache = lastActiveCanvas ? coordCaches.get(lastActiveCanvas) : undefined;
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
      if (!lastActiveCanvas) return null;
      const cache = coordCaches.get(lastActiveCanvas);
      if (!cache) return null;
      const rect = lastActiveCanvas.getBoundingClientRect();
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
    this.emitSnapshot(this.ws.chart);
  }

  setLayout(layout: '1' | '2h' | '4') {
    this.ws.setLayout(layout);
  }

  getActiveBars(): OHLCV[] {
    const cache = lastActiveCanvas ? coordCaches.get(lastActiveCanvas) : undefined;
    return cache?.args.bars ? [...cache.args.bars] : this.latestBars;
  }

  destroy() {
    this.ws.destroy();
  }
}
