import type { Strategy, Trade } from '../db/journalDb';

export interface QuadrantCell {
  count: number;
  totalR: number;
}

export interface RuleMatrix {
  compliantWin: QuadrantCell;
  compliantLoss: QuadrantCell;
  ruleBreakWin: QuadrantCell;
  ruleBreakLoss: QuadrantCell;
}

export interface JournalStats {
  totalTrades: number;
  winRate: number;
  avgR: number;
  expectancyR: number;
  profitFactor: number;
  maxDrawdownR: number;
  stdDevR: number;
  checklistCompliancePct: number;
  matrix: RuleMatrix;
  equityCurveR: Array<{ index: number; time: number; cumR: number }>;
  rollingExpectancy20: Array<{ index: number; value: number }>;
  liveAvgR: number | null;
  testAvgR: number | null;
  liveCount: number;
  testCount: number;
}

export interface ConsistencyBreakdown {
  enoughData: boolean;
  closedCount: number;
  score: number | null;
  aChecklist: number;
  bStability: number;
  cLiveTestMatch: number | null;
  weightA: number;
  weightB: number;
  weightC: number;
  explanation: string;
}

function mean(vals: number[]): number {
  if (vals.length === 0) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function stdDev(vals: number[]): number {
  if (vals.length < 2) return 0;
  const m = mean(vals);
  const variance = vals.reduce((acc, v) => acc + (v - m) ** 2, 0) / vals.length;
  return Math.sqrt(variance);
}

export function tradeChecklistPct(trade: Trade): number {
  if (!trade.checklist || trade.checklist.length === 0) return 100;
  const checked = trade.checklist.filter(Boolean).length;
  return (checked / trade.checklist.length) * 100;
}

function safeR(t: Trade): number {
  return typeof t.rMultiple === 'number' && Number.isFinite(t.rMultiple) ? t.rMultiple : 0;
}

export function computeJournalStats(trades: Trade[]): JournalStats {
  const closed = [...trades]
    .filter((t) => t.status === 'closed')
    .sort((a, b) => (a.exitTime ?? a.entryTime) - (b.exitTime ?? b.entryTime));

  const rs = closed.map(safeR);
  const wins = rs.filter((r) => r > 0);
  const losses = rs.filter((r) => r <= 0);
  const grossWin = wins.reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));

  const winRate = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;
  const avgR = mean(rs);
  const expectancyR = avgR;
  const profitFactor =
    grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0;
  const stdDevR = stdDev(rs);
  const checklistCompliancePct = mean(closed.map(tradeChecklistPct));

  // Equity curve + Max Drawdown in R
  let cumR = 0;
  let peakR = 0;
  let maxDrawdownR = 0;
  const equityCurveR: JournalStats['equityCurveR'] = [];
  closed.forEach((t, idx) => {
    const r = safeR(t);
    cumR = Number((cumR + r).toFixed(2));
    if (cumR > peakR) peakR = cumR;
    const dd = peakR - cumR;
    if (dd > maxDrawdownR) maxDrawdownR = dd;
    equityCurveR.push({
      index: idx + 1,
      time: t.exitTime ?? t.entryTime,
      cumR,
    });
  });

  // Rolling expectancy 20
  const rollingExpectancy20: JournalStats['rollingExpectancy20'] = [];
  for (let i = 0; i < rs.length; i++) {
    const start = Math.max(0, i - 19);
    const slice = rs.slice(start, i + 1);
    rollingExpectancy20.push({ index: i + 1, value: Number(mean(slice).toFixed(3)) });
  }

  // 4-cell matrix
  const matrix: RuleMatrix = {
    compliantWin: { count: 0, totalR: 0 },
    compliantLoss: { count: 0, totalR: 0 },
    ruleBreakWin: { count: 0, totalR: 0 },
    ruleBreakLoss: { count: 0, totalR: 0 },
  };
  for (const t of closed) {
    const r = safeR(t);
    const isCompliant = tradeChecklistPct(t) >= 80 && t.mistakes.length === 0;
    const isWin = r > 0;
    const cell =
      isCompliant && isWin
        ? matrix.compliantWin
        : isCompliant && !isWin
          ? matrix.compliantLoss
          : !isCompliant && isWin
            ? matrix.ruleBreakWin
            : matrix.ruleBreakLoss;
    cell.count += 1;
    cell.totalR = Number((cell.totalR + r).toFixed(2));
  }

  const liveTrades = closed.filter((t) => t.mode === 'live');
  const testTrades = closed.filter((t) => t.mode === 'replay' || t.mode === 'backtest');

  return {
    totalTrades: closed.length,
    winRate: Number(winRate.toFixed(1)),
    avgR: Number(avgR.toFixed(2)),
    expectancyR: Number(expectancyR.toFixed(2)),
    profitFactor: Number.isFinite(profitFactor) ? Number(profitFactor.toFixed(2)) : 99.9,
    maxDrawdownR: Number(maxDrawdownR.toFixed(2)),
    stdDevR: Number(stdDevR.toFixed(2)),
    checklistCompliancePct: Number(checklistCompliancePct.toFixed(1)),
    matrix,
    equityCurveR,
    rollingExpectancy20,
    liveAvgR: liveTrades.length > 0 ? Number(mean(liveTrades.map(safeR)).toFixed(2)) : null,
    testAvgR: testTrades.length > 0 ? Number(mean(testTrades.map(safeR)).toFixed(2)) : null,
    liveCount: liveTrades.length,
    testCount: testTrades.length,
  };
}

/**
 * Consistency Score (0-100) per SPEC section 4:
 * - Need >= 10 closed trades; else enoughData=false.
 * - A = avg checklist compliance (0-100), weight 40%
 * - B = stability = 100 * max(0, 1 - sigma(rolling expectancy 10) / (|mean R| + 1)), weight 30%
 * - C = live vs test match = 100 * max(0, 1 - |E_live - E_test| / max(|E_test|, 0.25)), weight 30%
 *   If one side is missing, redistribute C's 30% proportionally to A (40/70) and B (30/70).
 */
export function computeConsistencyScore(
  trades: Trade[],
  strategy?: Strategy
): ConsistencyBreakdown {
  const closed = [...trades]
    .filter((t) => t.status === 'closed' && (!strategy || t.strategyId === strategy.id))
    .sort((a, b) => (a.exitTime ?? a.entryTime) - (b.exitTime ?? b.entryTime));

  if (closed.length < 10) {
    return {
      enoughData: false,
      closedCount: closed.length,
      score: null,
      aChecklist: 0,
      bStability: 0,
      cLiveTestMatch: null,
      weightA: 0.4,
      weightB: 0.3,
      weightC: 0.3,
      explanation: `Cần tối thiểu 10 lệnh đã đóng để tính điểm (hiện có ${closed.length}/10 lệnh).`,
    };
  }

  const aChecklist = mean(closed.map(tradeChecklistPct));
  const rs = closed.map(safeR);
  const meanR = mean(rs);

  const rolling10: number[] = [];
  for (let i = 9; i < rs.length; i++) {
    rolling10.push(mean(rs.slice(i - 9, i + 1)));
  }
  const sigma10 = stdDev(rolling10);
  const bStability = 100 * Math.max(0, 1 - sigma10 / (Math.abs(meanR) + 1));

  const live = closed.filter((t) => t.mode === 'live');
  const test = closed.filter((t) => t.mode === 'replay' || t.mode === 'backtest');

  let cLiveTestMatch: number | null = null;
  let weightA = 0.4;
  let weightB = 0.3;
  let weightC = 0.3;

  if (live.length > 0 && test.length > 0) {
    const eLive = mean(live.map(safeR));
    const eTest = mean(test.map(safeR));
    cLiveTestMatch =
      100 * Math.max(0, 1 - Math.abs(eLive - eTest) / Math.max(Math.abs(eTest), 0.25));
  } else {
    // Redistribute 30% proportionally to A (4/7) and B (3/7)
    weightA = 4 / 7;
    weightB = 3 / 7;
    weightC = 0;
  }

  const score =
    aChecklist * weightA + bStability * weightB + (cLiveTestMatch ?? 0) * weightC;

  const explanation =
    cLiveTestMatch !== null
      ? `A (Tuân thủ ${Math.round(weightA * 100)}%): ${aChecklist.toFixed(1)} · B (Ổn định ${Math.round(weightB * 100)}%): ${bStability.toFixed(1)} · C (Khớp Live/Test ${Math.round(weightC * 100)}%): ${cLiveTestMatch.toFixed(1)}`
      : `Thiếu dữ liệu ${live.length === 0 ? 'Live' : 'Backtest/Replay'} nên dồn trọng số sang A (${Math.round(weightA * 100)}%) và B (${Math.round(weightB * 100)}%).`;

  return {
    enoughData: true,
    closedCount: closed.length,
    score: Number(score.toFixed(1)),
    aChecklist: Number(aChecklist.toFixed(1)),
    bStability: Number(bStability.toFixed(1)),
    cLiveTestMatch: cLiveTestMatch !== null ? Number(cLiveTestMatch.toFixed(1)) : null,
    weightA,
    weightB,
    weightC,
    explanation,
  };
}
