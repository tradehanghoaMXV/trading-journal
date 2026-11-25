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

export function registerJournalIndicators(): void {
  if (registered) return;
  registered = true;
  makeMaIndicator('journal.ema9', 'EMA 9', 9, '#38bdf8', computeEma);
  makeMaIndicator('journal.wma45', 'WMA 45', 45, '#f59e0b', computeWma);
}
