import {
  registerNativeIndicator,
  stableSeriesId,
  type InputValue,
  type NativeIndicator,
  type NativeIndicatorContext,
} from '@luxalgo/vela/plugin';

let registered = false;

function computeEma(closes: number[], length: number): Array<number | null> {
  const out: Array<number | null> = new Array(closes.length).fill(null);
  if (closes.length < length) return out;
  const k = 2 / (length + 1);
  let sum = 0;
  for (let i = 0; i < length; i++) sum += closes[i]!;
  let ema = sum / length;
  out[length - 1] = ema;
  for (let i = length; i < closes.length; i++) {
    ema = closes[i]! * k + ema * (1 - k);
    out[i] = ema;
  }
  return out;
}

function computeWma(closes: number[], length: number): Array<number | null> {
  const out: Array<number | null> = new Array(closes.length).fill(null);
  if (closes.length < length) return out;
  const weightSum = (length * (length + 1)) / 2;
  for (let i = length - 1; i < closes.length; i++) {
    let acc = 0;
    for (let j = 0; j < length; j++) {
      acc += closes[i - j]! * (length - j);
    }
    out[i] = acc / weightSum;
  }
  return out;
}

function computeRsi(closes: number[], length: number): Array<number | null> {
  const out: Array<number | null> = new Array(closes.length).fill(null);
  if (closes.length <= length) return out;

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= length; i++) {
    const diff = closes[i]! - closes[i - 1]!;
    if (diff >= 0) gainSum += diff;
    else lossSum -= diff;
  }

  let avgGain = gainSum / length;
  let avgLoss = lossSum / length;
  out[length] = avgLoss === 0 ? (avgGain === 0 ? 50 : 100) : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = length + 1; i < closes.length; i++) {
    const diff = closes[i]! - closes[i - 1]!;
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (length - 1) + gain) / length;
    avgLoss = (avgLoss * (length - 1) + loss) / length;
    out[i] = avgLoss === 0 ? (avgGain === 0 ? 50 : 100) : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

function computeMaOnNullableSeries(
  series: Array<number | null>,
  length: number,
  calc: (values: number[], len: number) => Array<number | null>
): Array<number | null> {
  const out: Array<number | null> = new Array(series.length).fill(null);
  const firstIdx = series.findIndex((v) => v !== null);
  if (firstIdx === -1) return out;

  const valid: number[] = [];
  for (let i = firstIdx; i < series.length; i++) {
    valid.push(series[i] ?? 0);
  }
  const maVals = calc(valid, length);
  for (let j = 0; j < maVals.length; j++) {
    out[firstIdx + j] = maVals[j] ?? null;
  }
  return out;
}

function makeMaIndicator(
  type: string,
  title: string,
  defaultLength: number,
  color: string,
  calc: (closes: number[], len: number) => Array<number | null>
) {
  registerNativeIndicator({
    type,
    title,
    paneHint: 'price',
    overlay: true,
    multiInstance: true,
    waitsForHistory: false,
    inputsSchema: () => [
      { key: 'length', title: 'Chu kỳ', type: 'int', defval: defaultLength, min: 2, max: 500 },
    ],
    defaultInputs: () => ({ length: defaultLength }),
    create: (): NativeIndicator => {
      let ctx: NativeIndicatorContext | null = null;
      let length = defaultLength;

      const read = (inputs: Record<string, InputValue>) => {
        length = Math.max(2, Number(inputs.length ?? defaultLength));
      };

      const compute = () => {
        if (!ctx) return;
        const bars = ctx.bars();
        const vals = calc(
          bars.map((b) => b.close),
          length
        );
        const points = bars.map((b, i) => ({
          time: b.time,
          value: vals[i] ?? null,
        }));
        ctx.emit({
          series: [
            {
              id: stableSeriesId({ instanceId: type, kind: 'line', title, ordinal: 0 }),
              title: `${title} (${length})`,
              paneId: '',
              kind: 'line',
              points,
              style: { color, width: 2, lineStyle: 'solid' },
            },
          ],
        });
      };

      return {
        start: (c, inputs) => {
          ctx = c;
          read(inputs);
          compute();
        },
        onBars: compute,
        onViewport: () => {},
        setInputs: (inputs) => {
          read(inputs);
          compute();
        },
        suspend: () => {},
        resume: compute,
        stop: () => {
          ctx = null;
        },
      };
    },
  });
}

function registerRsiEmaWmaIndicator(): void {
  const type = 'journal.rsi_ema_wma';
  const title = 'RSI + EMA9 / WMA45';

  registerNativeIndicator({
    type,
    title,
    shortTitle: 'RSI·EMA9·WMA45',
    paneHint: 'new',
    overlay: false,
    multiInstance: false,
    waitsForHistory: false,
    inputsSchema: () => [
      { key: 'rsiLength', title: 'Chu kỳ RSI', type: 'int', defval: 14, min: 2, max: 200 },
      { key: 'emaLength', title: 'EMA trên RSI', type: 'int', defval: 9, min: 2, max: 200 },
      { key: 'wmaLength', title: 'WMA trên RSI', type: 'int', defval: 45, min: 2, max: 200 },
    ],
    defaultInputs: () => ({ rsiLength: 14, emaLength: 9, wmaLength: 45 }),
    create: (): NativeIndicator => {
      let ctx: NativeIndicatorContext | null = null;
      let rsiLength = 14;
      let emaLength = 9;
      let wmaLength = 45;

      const read = (inputs: Record<string, InputValue>) => {
        rsiLength = Math.max(2, Number(inputs.rsiLength ?? 14));
        emaLength = Math.max(2, Number(inputs.emaLength ?? 9));
        wmaLength = Math.max(2, Number(inputs.wmaLength ?? 45));
      };

      const compute = () => {
        if (!ctx) return;
        const bars = ctx.bars();
        const closes = bars.map((b) => b.close);
        const rsiVals = computeRsi(closes, rsiLength);
        const emaOnRsi = computeMaOnNullableSeries(rsiVals, emaLength, computeEma);
        const wmaOnRsi = computeMaOnNullableSeries(rsiVals, wmaLength, computeWma);

        ctx.emit({
          paneHint: 'new',
          series: [
            {
              id: stableSeriesId({ instanceId: type, kind: 'line', title: 'RSI', ordinal: 0 }),
              title: `RSI (${rsiLength})`,
              paneId: '',
              kind: 'line',
              points: bars.map((b, i) => ({ time: b.time, value: rsiVals[i] ?? null })),
              style: { color: '#c084fc', width: 1.8, lineStyle: 'solid' },
            },
            {
              id: stableSeriesId({ instanceId: type, kind: 'line', title: 'EMA_RSI', ordinal: 1 }),
              title: `EMA ${emaLength} (RSI)`,
              paneId: '',
              kind: 'line',
              points: bars.map((b, i) => ({ time: b.time, value: emaOnRsi[i] ?? null })),
              style: { color: '#38bdf8', width: 1.8, lineStyle: 'solid' },
            },
            {
              id: stableSeriesId({ instanceId: type, kind: 'line', title: 'WMA_RSI', ordinal: 2 }),
              title: `WMA ${wmaLength} (RSI)`,
              paneId: '',
              kind: 'line',
              points: bars.map((b, i) => ({ time: b.time, value: wmaOnRsi[i] ?? null })),
              style: { color: '#f59e0b', width: 1.8, lineStyle: 'solid' },
            },
          ],
          priceLines: [
            {
              id: `${type}-lvl-70`,
              paneId: '',
              price: 70,
              color: 'rgba(255, 59, 92, 0.45)',
              lineStyle: 'dashed',
              width: 1,
              title: '70',
            },
            {
              id: `${type}-lvl-50`,
              paneId: '',
              price: 50,
              color: 'rgba(148, 163, 184, 0.35)',
              lineStyle: 'dashed',
              width: 1,
              title: '50',
            },
            {
              id: `${type}-lvl-30`,
              paneId: '',
              price: 30,
              color: 'rgba(0, 245, 155, 0.45)',
              lineStyle: 'dashed',
              width: 1,
              title: '30',
            },
          ],
        });
      };

      return {
        start: (c, inputs) => {
          ctx = c;
          read(inputs);
          compute();
        },
        onBars: compute,
        onViewport: () => {},
        setInputs: (inputs) => {
          read(inputs);
          compute();
        },
        suspend: () => {},
        resume: compute,
        stop: () => {
          ctx = null;
        },
      };
    },
  });
}

export function registerJournalIndicators(): void {
  if (registered) return;
  registered = true;
  makeMaIndicator('journal.ema9', 'EMA 9', 9, '#38bdf8', computeEma);
  makeMaIndicator('journal.wma45', 'WMA 45', 45, '#f59e0b', computeWma);
  registerRsiEmaWmaIndicator();
}
