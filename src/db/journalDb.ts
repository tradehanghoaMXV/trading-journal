import Dexie, { type Table } from 'dexie';
import {
  loadWorkspaceState,
  sanitizeWorkspaceState,
  saveWorkspaceState,
  type PersistedWorkspaceState,
} from '../chart/workspacePersistence';

export type TradeMode = 'live' | 'replay' | 'backtest';
export type TradeSide = 'long' | 'short';
export type TradeStatus = 'open' | 'closed';

export interface Strategy {
  id: string;
  name: string;
  description: string;
  sourceBook: string;
  rules: string[];
  color: string;
  createdAt: number;
}

export interface Trade {
  id: string;
  mode: TradeMode;
  symbol: string;
  timeframe: string;
  side: TradeSide;
  entryTime: number;
  entryPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  exitTime?: number;
  exitPrice?: number;
  size?: number;
  strategyId: string;
  checklist: boolean[];
  emotion: string;
  mistakes: string[];
  notes?: string;
  beforeNotes?: string;
  afterNotes?: string;
  rMultiple?: number;
  status: TradeStatus;
  createdAt: number;
  beforeImage?: string;
  afterImage?: string;
  beforeCapturedAt?: number;
  afterCapturedAt?: number;
  drawingsSnapshot?: unknown;
}

export function getTradeBeforeNotes(t: Pick<Trade, 'beforeNotes' | 'notes'>): string {
  return t.beforeNotes ?? t.notes ?? '';
}

export function getTradeAfterNotes(t: Pick<Trade, 'afterNotes'>): string {
  return t.afterNotes ?? '';
}

export interface ChartNote {
  id: string;
  symbol: string;
  time: number;
  price: number;
  text: string;
  color: string;
  tradeId?: string;
  createdAt: number;
}

export interface DrawingRecord {
  symbol: string;
  stateJson: string;
  updatedAt: number;
}

export const DEFAULT_STRATEGIES: Strategy[] = [
  {
    id: 'turtle-breakout',
    name: 'Turtle Breakout',
    description: 'Bắt sóng đột phá đỉnh/đáy 20 phiên theo xu hướng lớn, cắt lỗ theo ATR.',
    sourceBook: 'Curtis Faith – Way of the Turtle',
    rules: [
      'Giá phá vỡ đỉnh/đáy 20 nến (Donchian 20)',
      'Điểm dừng lỗ đặt tối đa 2 × ATR(14)',
      'Không vào lệnh ngược xu hướng khung lớn',
      'Khối lượng rủi ro ≤ 1–2% tài khoản',
    ],
    color: '#00F59B',
    createdAt: 1700000000001,
  },
  {
    id: 'ema9-wma45-trend',
    name: 'EMA9 / WMA45 Trend',
    description: 'Giao dịch theo giao cắt và hồi về vùng cân bằng EMA9 / WMA45.',
    sourceBook: 'Hệ thống bám xu hướng ngắn–trung hạn',
    rules: [
      'EMA9 cắt và nằm rõ trên/dưới WMA45',
      'Giá hồi về chạm hoặc tiệm cận EMA9/WMA45 có nến xác nhận',
      'Stop Loss đặt sau swing gần nhất hoặc sau WMA45',
      'Tỷ lệ R:R kỳ vọng ≥ 1.5',
    ],
    color: '#38bdf8',
    createdAt: 1700000000002,
  },
  {
    id: 'smc-order-block',
    name: 'SMC Order Block',
    description: 'Tìm vùng cung/cầu tổ chức (OB) kèm quét thanh khoản (Sweep) và BOS.',
    sourceBook: 'Smart Money Concepts',
    rules: [
      'Đã có Break of Structure (BOS) hoặc CHoCH rõ ràng',
      'Xuất hiện FVG / Imbalance xác nhận lực đẩy',
      'Giá quay lại retest Order Block hợp lệ',
      'Có tín hiệu từ chối giá (sweep/wick) tại OB',
    ],
    color: '#a855f7',
    createdAt: 1700000000003,
  },
  {
    id: 'price-action-al-brooks',
    name: 'Price Action (Al Brooks)',
    description: 'Đọc hành động giá từng nến: nến tín hiệu mạnh tại hỗ trợ/kháng cự.',
    sourceBook: 'Al Brooks – Trading Price Action Trends',
    rules: [
      'Xác định rõ bối cảnh: Always-In Long / Short hay Trading Range',
      'Nến tín hiệu đóng cửa mạnh về hướng vào lệnh (ít râu ngược)',
      'Có khoảng trống (room to target) tới kháng cự/hỗ trợ kế tiếp',
      'Tuân thủ kịch bản thoát lệnh nếu xuất hiện nến đảo chiều mạnh',
    ],
    color: '#f59e0b',
    createdAt: 1700000000004,
  },
];

export function computeRMultiple(
  side: TradeSide,
  entryPrice?: number,
  stopLoss?: number,
  exitPrice?: number,
  takeProfit?: number
): number | undefined {
  if (
    entryPrice === undefined ||
    stopLoss === undefined ||
    !Number.isFinite(entryPrice) ||
    !Number.isFinite(stopLoss)
  ) {
    return undefined;
  }
  const target = exitPrice ?? takeProfit;
  if (target === undefined || !Number.isFinite(target)) {
    return undefined;
  }
  const risk = Math.abs(entryPrice - stopLoss);
  if (risk <= 1e-9) return 0;
  const diff = side === 'long' ? target - entryPrice : entryPrice - target;
  return Number((diff / risk).toFixed(2));
}

class TradingJournalDB extends Dexie {
  strategies!: Table<Strategy, string>;
  trades!: Table<Trade, string>;
  notes!: Table<ChartNote, string>;
  drawings!: Table<DrawingRecord, string>;

  constructor() {
    super('TradingJournalDB');
    this.version(1).stores({
      strategies: 'id, name, createdAt',
      trades: 'id, mode, symbol, strategyId, status, entryTime, createdAt',
      notes: 'id, symbol, time, tradeId, createdAt',
      drawings: 'symbol, updatedAt',
    });

    this.version(2).stores({
      strategies: 'id, name, createdAt',
      trades: 'id, mode, symbol, strategyId, status, entryTime, createdAt',
      notes: 'id, symbol, time, tradeId, createdAt',
      drawings: 'symbol, updatedAt',
    });

    this.on('populate', async () => {
      await this.strategies.bulkAdd(DEFAULT_STRATEGIES);
    });
  }
}

export const db = new TradingJournalDB();

export async function ensureDefaultStrategies(): Promise<void> {
  const count = await db.strategies.count();
  if (count === 0) {
    await db.strategies.bulkPut(DEFAULT_STRATEGIES);
  }
}

export interface JournalExportPayload {
  version: 1;
  exportedAt: number;
  strategies: Strategy[];
  trades: Trade[];
  notes: ChartNote[];
  drawings: DrawingRecord[];
  workspaceState?: PersistedWorkspaceState;
}

export async function exportJournalJson(): Promise<JournalExportPayload> {
  const [strategies, trades, notes, drawings] = await Promise.all([
    db.strategies.toArray(),
    db.trades.toArray(),
    db.notes.toArray(),
    db.drawings.toArray(),
  ]);
  return {
    version: 1,
    exportedAt: Date.now(),
    strategies,
    trades,
    notes,
    drawings,
    workspaceState: loadWorkspaceState(),
  };
}

export async function importJournalJson(payload: JournalExportPayload): Promise<void> {
  if (!payload || payload.version !== 1) {
    throw new Error('Định dạng JSON không hợp lệ.');
  }
  await db.transaction('rw', db.strategies, db.trades, db.notes, db.drawings, async () => {
    if (Array.isArray(payload.strategies)) {
      await db.strategies.bulkPut(payload.strategies);
    }
    if (Array.isArray(payload.trades)) {
      await db.trades.bulkPut(payload.trades);
    }
    if (Array.isArray(payload.notes)) {
      await db.notes.bulkPut(payload.notes);
    }
    if (Array.isArray(payload.drawings)) {
      await db.drawings.bulkPut(payload.drawings);
    }
  });
  if (payload.workspaceState) {
    const clean = sanitizeWorkspaceState(payload.workspaceState);
    if (clean) {
      saveWorkspaceState(clean);
    }
  }
}
