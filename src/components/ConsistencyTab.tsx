import { useMemo, useState } from 'preact/hooks';
import { ALL_SYMBOLS } from '../config/symbols';
import type { Strategy, Trade, TradeMode } from '../db/journalDb';
import { computeConsistencyScore, computeJournalStats } from '../utils/stats';

interface ConsistencyTabProps {
  strategies: Strategy[];
  trades: Trade[];
}

function MiniLineChart({
  values,
  color,
  height = 80,
}: {
  values: number[];
  color: string;
  height?: number;
}) {
  if (values.length < 2) {
    return (
      <div style={{ height: `${height}px`, display: 'flex', alignItems: 'center', color: '#64748b', fontSize: '11px' }}>
        Cần ≥ 2 lệnh đóng để vẽ đường cong
      </div>
    );
  }
  const w = 320;
  const min = Math.min(0, ...values);
  const max = Math.max(0.5, ...values);
  const span = max - min || 1;
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * (w - 8) + 4;
      const y = height - 6 - ((v - min) / span) * (height - 12);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const zeroY = height - 6 - ((0 - min) / span) * (height - 12);

  return (
    <svg viewBox={`0 0 ${w} ${height}`} style={{ width: '100%', height: `${height}px` }}>
      <line
        x1="0"
        y1={zeroY}
        x2={w}
        y2={zeroY}
        stroke="#334155"
        stroke-dasharray="3,3"
        stroke-width="1"
      />
      <polyline fill="none" stroke={color} stroke-width="2" points={pts} />
    </svg>
  );
}

export function ConsistencyTab(props: ConsistencyTabProps) {
  const [strategyFilter, setStrategyFilter] = useState<string>('all');
  const [modeFilter, setModeFilter] = useState<'all' | TradeMode>('all');
  const [symbolFilter, setSymbolFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');

  const filteredTrades = useMemo(() => {
    const fromMs = dateFrom ? Date.parse(dateFrom) : null;
    const toMs = dateTo ? Date.parse(dateTo) + 86_399_999 : null;
    return props.trades.filter((t) => {
      if (strategyFilter !== 'all' && t.strategyId !== strategyFilter) return false;
      if (modeFilter !== 'all' && t.mode !== modeFilter) return false;
      if (symbolFilter !== 'all' && t.symbol !== symbolFilter) return false;
      if (fromMs && t.entryTime < fromMs) return false;
      if (toMs && t.entryTime > toMs) return false;
      return true;
    });
  }, [props.trades, strategyFilter, modeFilter, symbolFilter, dateFrom, dateTo]);

  const stats = useMemo(() => computeJournalStats(filteredTrades), [filteredTrades]);

  const scoresByStrategy = useMemo(
    () =>
      props.strategies.map((s) => ({
        strategy: s,
        consistency: computeConsistencyScore(props.trades, s),
      })),
    [props.strategies, props.trades]
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }} data-testid="consistency-tab">
      {/* Filters */}
      <div class="card">
        <div class="card-title">Bộ lọc thống kê</div>
        <div class="grid-2" style={{ marginBottom: '6px' }}>
          <select
            class="select"
            value={strategyFilter}
            onChange={(e) => setStrategyFilter((e.target as HTMLSelectElement).value)}
          >
            <option value="all">Tất cả trường phái</option>
            {props.strategies.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>

          <select
            class="select"
            value={modeFilter}
            onChange={(e) =>
              setModeFilter((e.target as HTMLSelectElement).value as 'all' | TradeMode)
            }
          >
            <option value="all">Tất cả chế độ</option>
            <option value="live">Live</option>
            <option value="replay">Replay</option>
            <option value="backtest">Backtest</option>
          </select>
        </div>

        <div class="grid-3">
          <select
            class="select"
            value={symbolFilter}
            onChange={(e) => setSymbolFilter((e.target as HTMLSelectElement).value)}
          >
            <option value="all">Tất cả mã</option>
            {ALL_SYMBOLS.map((s) => (
              <option key={s.symbol} value={s.symbol}>
                {s.symbol}
              </option>
            ))}
          </select>
          <input
            class="input"
            type="date"
            value={dateFrom}
            onInput={(e) => setDateFrom((e.target as HTMLInputElement).value)}
          />
          <input
            class="input"
            type="date"
            value={dateTo}
            onInput={(e) => setDateTo((e.target as HTMLInputElement).value)}
          />
        </div>
      </div>

      {/* Consistency Score per strategy */}
      <div class="card">
        <div class="card-title">Consistency Score theo trường phái</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {scoresByStrategy.map(({ strategy, consistency }) => (
            <div
              key={strategy.id}
              data-testid={`consistency-card-${strategy.id}`}
              style={{
                padding: '8px',
                borderRadius: '6px',
                background: '#0b0f17',
                border: '1px solid #1e293b',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 600, color: strategy.color }}>{strategy.name}</span>
                {consistency.enoughData && consistency.score !== null ? (
                  <span
                    class={`pill ${
                      consistency.score >= 70
                        ? 'pill-bull'
                        : consistency.score >= 45
                          ? 'pill-accent'
                          : 'pill-bear'
                    }`}
                    style={{ fontSize: '12px' }}
                  >
                    {consistency.score}/100
                  </span>
                ) : (
                  <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                    Chưa đủ dữ liệu ({consistency.closedCount}/10)
                  </span>
                )}
              </div>
              <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>
                {consistency.explanation}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Key metrics */}
      <div class="card">
        <div class="card-title">Chỉ số hiệu suất ({stats.totalTrades} lệnh đóng)</div>
        <div class="grid-2" style={{ gap: '6px' }}>
          <div style={{ background: '#0b0f17', padding: '7px', borderRadius: '6px' }}>
            <div class="field-label">Win rate</div>
            <strong style={{ fontSize: '14px' }}>{stats.winRate}%</strong>
          </div>
          <div style={{ background: '#0b0f17', padding: '7px', borderRadius: '6px' }}>
            <div class="field-label">Expectancy / Avg R</div>
            <strong
              style={{
                fontSize: '14px',
                color: stats.expectancyR >= 0 ? '#00F59B' : '#FF3B5C',
              }}
            >
              {stats.expectancyR >= 0 ? '+' : ''}
              {stats.expectancyR}R
            </strong>
          </div>
          <div style={{ background: '#0b0f17', padding: '7px', borderRadius: '6px' }}>
            <div class="field-label">Profit Factor</div>
            <strong style={{ fontSize: '14px' }}>{stats.profitFactor}</strong>
          </div>
          <div style={{ background: '#0b0f17', padding: '7px', borderRadius: '6px' }}>
            <div class="field-label">Max Drawdown</div>
            <strong style={{ fontSize: '14px', color: '#FF3B5C' }}>-{stats.maxDrawdownR}R</strong>
          </div>
          <div style={{ background: '#0b0f17', padding: '7px', borderRadius: '6px' }}>
            <div class="field-label">Độ lệch chuẩn R</div>
            <strong style={{ fontSize: '14px' }}>{stats.stdDevR}R</strong>
          </div>
          <div style={{ background: '#0b0f17', padding: '7px', borderRadius: '6px' }}>
            <div class="field-label">% Tuân thủ checklist</div>
            <strong style={{ fontSize: '14px', color: '#38bdf8' }}>
              {stats.checklistCompliancePct}%
            </strong>
          </div>
        </div>
      </div>

      {/* 4-cell Matrix */}
      <div class="card">
        <div class="card-title">Ma trận kỷ luật (4 ô)</div>
        <div class="grid-2" style={{ gap: '6px' }}>
          <div style={{ background: 'rgba(0,245,155,0.1)', border: '1px solid rgba(0,245,155,0.3)', padding: '7px', borderRadius: '6px' }}>
            <div style={{ fontSize: '11px', color: '#00F59B' }}>Đúng luật / Thắng</div>
            <strong>
              {stats.matrix.compliantWin.count} lệnh ({stats.matrix.compliantWin.totalR >= 0 ? '+' : ''}
              {stats.matrix.compliantWin.totalR}R)
            </strong>
          </div>
          <div style={{ background: 'rgba(56,189,248,0.1)', border: '1px solid rgba(56,189,248,0.3)', padding: '7px', borderRadius: '6px' }}>
            <div style={{ fontSize: '11px', color: '#38bdf8' }}>Đúng luật / Thua</div>
            <strong>
              {stats.matrix.compliantLoss.count} lệnh ({stats.matrix.compliantLoss.totalR}R)
            </strong>
          </div>
          <div style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', padding: '7px', borderRadius: '6px' }}>
            <div style={{ fontSize: '11px', color: '#f59e0b' }}>Phá luật / Thắng</div>
            <strong>
              {stats.matrix.ruleBreakWin.count} lệnh (+{stats.matrix.ruleBreakWin.totalR}R)
            </strong>
          </div>
          <div style={{ background: 'rgba(255,59,92,0.1)', border: '1px solid rgba(255,59,92,0.3)', padding: '7px', borderRadius: '6px' }}>
            <div style={{ fontSize: '11px', color: '#FF3B5C' }}>Phá luật / Thua</div>
            <strong>
              {stats.matrix.ruleBreakLoss.count} lệnh ({stats.matrix.ruleBreakLoss.totalR}R)
            </strong>
          </div>
        </div>
      </div>

      {/* Equity Curve R + Rolling Expectancy 20 */}
      <div class="card">
        <div class="card-title">Đường cong vốn (R tích lũy)</div>
        <MiniLineChart
          values={stats.equityCurveR.map((p) => p.cumR)}
          color="#00F59B"
          height={85}
        />
        <div class="card-title" style={{ marginTop: '10px' }}>
          Rolling Expectancy (20 lệnh)
        </div>
        <MiniLineChart
          values={stats.rollingExpectancy20.map((p) => p.value)}
          color="#38bdf8"
          height={70}
        />
      </div>

      {/* Live vs Backtest/Replay */}
      <div class="card">
        <div class="card-title">So sánh Live vs Replay / Backtest</div>
        <div class="grid-2">
          <div style={{ background: '#0b0f17', padding: '8px', borderRadius: '6px' }}>
            <div class="field-label">Live ({stats.liveCount} lệnh)</div>
            <strong>{stats.liveAvgR !== null ? `${stats.liveAvgR}R` : 'Chưa có'}</strong>
          </div>
          <div style={{ background: '#0b0f17', padding: '8px', borderRadius: '6px' }}>
            <div class="field-label">Replay / BT ({stats.testCount} lệnh)</div>
            <strong>{stats.testAvgR !== null ? `${stats.testAvgR}R` : 'Chưa có'}</strong>
          </div>
        </div>
      </div>
    </div>
  );
}
