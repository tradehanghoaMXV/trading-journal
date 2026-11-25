import { registerRendererLayer, type RendererLayerArgs } from '@luxalgo/vela/plugin';
import type { ChartNote, Trade, TradeSide } from '../db/journalDb';

export interface DraftPosition {
  side: TradeSide;
  step: 'entry' | 'sl' | 'tp';
  entryTime: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
}

export interface JournalLayerPayload {
  symbol: string;
  trades: Trade[];
  notes: ChartNote[];
  draft: DraftPosition | null;
  selectedTradeId: string | null;
}

let registered = false;

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
    rMultiple?: number;
    status?: 'open' | 'closed';
  }
) {
  if (opts.entryPrice === undefined || !Number.isFinite(opts.entryPrice)) return;
  const { coords, scale, bounds } = args;
  const x1 = coords.timeToX(opts.entryTime);
  let x2 = coords.timeToX(opts.endTime);
  if (!Number.isFinite(x1)) return;
  if (!Number.isFinite(x2) || x2 <= x1 + 28) {
    x2 = x1 + 90;
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

  const boxW = Math.max(36, x2 - x1);

  // TP Zone (green #00F59B)
  const tpTop = Number.isFinite(yTp) ? Math.min(yEntry, yTp) : yEntry;
  const tpH = Number.isFinite(yTp) ? Math.abs(yTp - yEntry) : 0;
  if (tpH > 1) {
    ctx.fillStyle = opts.isDraft ? 'rgba(0, 245, 155, 0.22)' : 'rgba(0, 245, 155, 0.14)';
    ctx.fillRect(x1, tpTop, boxW, tpH);
    ctx.strokeStyle = 'rgba(0, 245, 155, 0.75)';
    ctx.lineWidth = opts.selected ? 2 : 1;
    ctx.strokeRect(x1, tpTop, boxW, tpH);
  }

  // SL Zone (red #FF3B5C)
  const slTop = Number.isFinite(ySl) ? Math.min(yEntry, ySl) : yEntry;
  const slH = Number.isFinite(ySl) ? Math.abs(ySl - yEntry) : 0;
  if (slH > 1) {
    ctx.fillStyle = opts.isDraft ? 'rgba(255, 59, 92, 0.22)' : 'rgba(255, 59, 92, 0.14)';
    ctx.fillRect(x1, slTop, boxW, slH);
    ctx.strokeStyle = 'rgba(255, 59, 92, 0.75)';
    ctx.lineWidth = opts.selected ? 2 : 1;
    ctx.strokeRect(x1, slTop, boxW, slH);
  }

  // Entry dashed line
  ctx.save();
  ctx.strokeStyle = opts.selected ? '#ffffff' : '#94a3b8';
  ctx.lineWidth = opts.selected ? 2 : 1.2;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(x1, yEntry);
  ctx.lineTo(x1 + boxW, yEntry);
  ctx.stroke();
  ctx.restore();

  // Entry arrow marker
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

  // Badge label
  ctx.save();
  ctx.font = '600 11px Inter, sans-serif';
  const text = opts.label;
  const tw = ctx.measureText(text).width;
  const padX = 6;
  const badgeW = tw + padX * 2;
  const badgeH = 18;
  const bx = x1 + 4;
  const by = isLong ? tpTop + 4 : slTop + 4;
  ctx.fillStyle = 'rgba(11, 15, 23, 0.88)';
  drawRoundRect(ctx, bx, by, badgeW, badgeH, 4);
  ctx.fill();
  ctx.strokeStyle = isLong ? '#00F59B' : '#FF3B5C';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = '#f8fafc';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, bx + padX, by + badgeH / 2);
  ctx.restore();
}

export function registerJournalOverlayLayer(): void {
  if (registered) return;
  registered = true;

  registerRendererLayer({
    id: 'journal.overlays',
    placement: 'above-data',
    repaintOnCursor: true,
    create: () => {
      let canvas: HTMLCanvasElement | null = null;
      let ctx: CanvasRenderingContext2D | null = null;

      return {
        mount(el: HTMLCanvasElement) {
          canvas = el;
          ctx = el.getContext('2d');
        },
        render(args: RendererLayerArgs) {
          if (!canvas || !ctx) return;
          const dpr = args.coords.dpr || window.devicePixelRatio || 1;
          ctx.save();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.scale(dpr, dpr);

          // Clip to price pane bounds
          ctx.beginPath();
          ctx.rect(0, args.bounds.top, args.coords.width, args.bounds.height);
          ctx.clip();

          const payload = args.data as JournalLayerPayload | undefined;
          if (!payload) {
            ctx.restore();
            return;
          }

          const lastBarTime =
            args.bars.length > 0
              ? args.bars[args.bars.length - 1]!.time + args.coords.barInterval * 6
              : Date.now();

          // 1. Saved trades for current symbol
          for (const t of payload.trades) {
            if (t.symbol !== payload.symbol) continue;
            if (t.entryPrice === undefined || !Number.isFinite(t.entryPrice)) continue;
            const endTime = t.exitTime ?? Math.max(lastBarTime, t.entryTime + args.coords.barInterval * 8);
            const hasSl = t.stopLoss !== undefined && Number.isFinite(t.stopLoss);
            const hasTp = t.takeProfit !== undefined && Number.isFinite(t.takeProfit);
            const risk = hasSl ? Math.abs(t.entryPrice - t.stopLoss!) : 0;
            const reward = hasTp ? Math.abs(t.takeProfit! - t.entryPrice) : 0;
            const rr = hasSl && hasTp && risk > 0 ? (reward / risk).toFixed(2) : null;
            const prefix = t.side === 'long' ? 'LONG' : 'SHORT';
            const modeTag = t.mode === 'replay' ? ' [Replay]' : t.mode === 'backtest' ? ' [BT]' : '';
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
              rMultiple: t.rMultiple,
              status: t.status,
            });
          }

          // 2. Active draft Long/Short tool
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

          // 3. Chart-pinned notes
          let hoveredNote: { note: ChartNote; x: number; y: number } | null = null;
          for (const n of payload.notes) {
            if (n.symbol !== payload.symbol) continue;
            const nx = args.coords.timeToX(n.time);
            const ny = args.coords.priceToY(n.price, args.scale, args.bounds);
            if (!Number.isFinite(nx) || !Number.isFinite(ny)) continue;

            // Pin circle
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

          // Hover tooltip for note
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
        },
      };
    },
  });
}
