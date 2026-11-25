import type { OHLCV } from '@luxalgo/vela';
import type { Trade } from '../db/journalDb';
import { computeJournalStats, type JournalStats } from '../utils/stats';

export type BacktestStrategyKind = 'ema_wma' | 'donchian' | 'rsi';

export interface BacktestParams {
  kind: BacktestStrategyKind;
  symbol: string;
  timeframe: string;
  strategyId: string;
  spreadBps: number; // simulated fee + spread in basis points (e.g. 4 = 0.04%)
  atrPeriod: number;
  atrMult: number;
  rrRatio: number;
  // EMA/WMA
  emaLen: number;
  wmaLen: number;
  // Donchian
  entryLen: number;
  exitLen: number;
  // RSI
  rsiLen: number;
  rsiOversold: number;
  rsiOverbought: number;
}

export interface BacktestResult {
  trades: Trade[];
  stats: JournalStats;
}

function calcAtr(bars: OHLCV[], period: number): Array<number | null> {
  const out: Array<number | null> = new Array(bars.length).fill(null);
  if (bars.length < period + 1) return out;
  const trs: number[] = [bars[0]!.high - bars[0]!.low];
  for (let i = 1; i < bars.length; i++) {
    const cur = bars[i]!;
    const prevClose = bars[i - 1]!.close;
    trs.push(
      Math.max(
        cur.high - cur.low,
        Math.abs(cur.high - prevClose),
        Math.abs(cur.low - prevClose)
      )
    );
  }
  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = atr;
  for (let i = period; i < bars.length; i++) {
    atr = (atr * (period - 1) + trs[i]!) / period;
    out[i] = atr;
  }
  return out;
}

function calcEma(closes: number[], len: number): Array<number | null> {
  const out: Array<number | null> = new Array(closes.length).fill(null);
  if (closes.length < len) return out;
  const k = 2 / (len + 1);
  let ema = closes.slice(0, len).reduce((a, b) => a + b, 0) / len;
  out[len - 1] = ema;
  for (let i = len; i < closes.length; i++) {
    ema = closes[i]! * k + ema * (1 - k);
    out[i] = ema;
  }
  return out;
}

function calcWma(closes: number[], len: number): Array<number | null> {
  const out: Array<number | null> = new Array(closes.length).fill(null);
  const denom = (len * (len + 1)) / 2;
  for (let i = len - 1; i < closes.length; i++) {
    let acc = 0;
    for (let j = 0; j < len; j++) acc += closes[i - j]! * (len - j);
    out[i] = acc / denom;
  }
  return out;
}

function calcRsi(closes: number[], len: number): Array<number | null> {
  const out: Array<number | null> = new Array(closes.length).fill(null);
  if (closes.length <= len) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= len; i++) {
    const diff = closes[i]! - closes[i - 1]!;
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  let avgGain = gain / len;
  let avgLoss = loss / len;
  out[len] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = len + 1; i < closes.length; i++) {
    const diff = closes[i]! - closes[i - 1]!;
    avgGain = (avgGain * (len - 1) + (diff > 0 ? diff : 0)) / len;
    avgLoss = (avgLoss * (len - 1) + (diff < 0 ? -diff : 0)) / len;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export function runBacktest(bars: OHLCV[], params: BacktestParams): BacktestResult {
  if (bars.length < 60) {
    const emptyStats = computeJournalStats([]);
    return { trades: [], stats: emptyStats };
  }

  const closes = bars.map((b) => b.close);
  const atr = calcAtr(bars, params.atrPeriod);
  const ema = params.kind === 'ema_wma' ? calcEma(closes, params.emaLen) : [];
  const wma = params.kind === 'ema_wma' ? calcWma(closes, params.wmaLen) : [];
  const rsi = params.kind === 'rsi' ? calcRsi(closes, params.rsiLen) : [];

  const trades: Trade[] = [];
  let openTrade: Trade | null = null;
  const costFrac = params.spreadBps / 10_000;

  const closeTrade = (t: Trade, exitTime: number, exitPrice: number) => {
    const risk = Math.abs(t.entryPrice - t.stopLoss);
    const rawDiff = t.side === 'long' ? exitPrice - t.entryPrice : t.entryPrice - exitPrice;
    const feeCost = t.entryPrice * costFrac;
    const r = risk > 0 ? Number(((rawDiff - feeCost) / risk).toFixed(2)) : 0;
    t.exitTime = exitTime;
    t.exitPrice = exitPrice;
    t.rMultiple = r;
    t.status = 'closed';
    trades.push(t);
    openTrade = null;
  };

  for (let i = 50; i < bars.length; i++) {
    const bar = bars[i]!;
    const curAtr = atr[i];

    // Check SL / TP / Exit on open trade
    if (openTrade) {
      if (openTrade.side === 'long') {
        if (bar.low <= openTrade.stopLoss) {
          closeTrade(openTrade, bar.time, openTrade.stopLoss);
          continue;
        }
        if (bar.high >= openTrade.takeProfit) {
          closeTrade(openTrade, bar.time, openTrade.takeProfit);
          continue;
        }
        if (params.kind === 'donchian' && i >= params.exitLen) {
          let lowExit = Infinity;
          for (let j = i - params.exitLen; j < i; j++) {
            lowExit = Math.min(lowExit, bars[j]!.low);
          }
          if (bar.close < lowExit) {
            closeTrade(openTrade, bar.time, bar.close);
            continue;
          }
        }
      } else {
        if (bar.high >= openTrade.stopLoss) {
          closeTrade(openTrade, bar.time, openTrade.stopLoss);
          continue;
        }
        if (bar.low <= openTrade.takeProfit) {
          closeTrade(openTrade, bar.time, openTrade.takeProfit);
          continue;
        }
        if (params.kind === 'donchian' && i >= params.exitLen) {
          let highExit = -Infinity;
          for (let j = i - params.exitLen; j < i; j++) {
            highExit = Math.max(highExit, bars[j]!.high);
          }
          if (bar.close > highExit) {
            closeTrade(openTrade, bar.time, bar.close);
            continue;
          }
        }
      }
      continue;
    }

    if (!curAtr || curAtr <= 0) continue;

    let signal: 'long' | 'short' | null = null;
    if (params.kind === 'ema_wma') {
      const e0 = ema[i - 1];
      const w0 = wma[i - 1];
      const e1 = ema[i];
      const w1 = wma[i];
      if (e0 != null && w0 != null && e1 != null && w1 != null) {
        if (e0 <= w0 && e1 > w1) signal = 'long';
        else if (e0 >= w0 && e1 < w1) signal = 'short';
      }
    } else if (params.kind === 'donchian' && i >= params.entryLen) {
      let hi = -Infinity;
      let lo = Infinity;
      for (let j = i - params.entryLen; j < i; j++) {
        hi = Math.max(hi, bars[j]!.high);
        lo = Math.min(lo, bars[j]!.low);
      }
      if (bar.close > hi) signal = 'long';
      else if (bar.close < lo) signal = 'short';
    } else if (params.kind === 'rsi') {
      const r0 = rsi[i - 1];
      const r1 = rsi[i];
      if (r0 != null && r1 != null) {
        if (r0 <= params.rsiOversold && r1 > params.rsiOversold) signal = 'long';
        else if (r0 >= params.rsiOverbought && r1 < params.rsiOverbought) signal = 'short';
      }
    }

    if (signal) {
      const entryPrice = bar.close;
      const slDist = curAtr * params.atrMult;
      const tpDist = slDist * params.rrRatio;
      const stopLoss = signal === 'long' ? entryPrice - slDist : entryPrice + slDist;
      const takeProfit = signal === 'long' ? entryPrice + tpDist : entryPrice - tpDist;
      openTrade = {
        id: `bt-${params.kind}-${bar.time}`,
        mode: 'backtest',
        symbol: params.symbol,
        timeframe: params.timeframe,
        side: signal,
        entryTime: bar.time,
        entryPrice,
        stopLoss: Number(stopLoss.toFixed(5)),
        takeProfit: Number(takeProfit.toFixed(5)),
        strategyId: params.strategyId,
        checklist: [true, true, true, true],
        emotion: 'Kỷ luật',
        mistakes: [],
        notes: `Tự động (${params.kind})`,
        rMultiple: 0,
        status: 'open',
        createdAt: bar.time,
      };
    }
  }

  return {
    trades,
    stats: computeJournalStats(trades),
  };
}
