import type { OHLCV } from '@luxalgo/vela';
import { runBacktest, type BacktestParams } from './backtestEngine';

self.onmessage = (ev: MessageEvent<{ bars: OHLCV[]; params: BacktestParams }>) => {
  const { bars, params } = ev.data;
  const result = runBacktest(bars, params);
  self.postMessage(result);
};
