import type {
  BarRange,
  DataProvider,
  OHLCV,
  ProviderInfo,
  SymbolDescriptor,
  SymbolInfo,
} from '@luxalgo/vela';
import { CRYPTO_SYMBOLS, SYMBOL_MAP } from '../config/symbols';

const REST_BASE = 'https://data-api.binance.vision/api/v3';
const WS_BASE = 'wss://data-stream.binance.vision/ws';

const TF_TO_BINANCE: Record<string, string> = {
  '1': '1m',
  '5': '5m',
  '15': '15m',
  '60': '1h',
  '240': '4h',
  D: '1d',
};

function klinesToBars(raw: unknown[]): OHLCV[] {
  const out: OHLCV[] = [];
  for (const row of raw) {
    if (!Array.isArray(row) || row.length < 6) continue;
    out.push({
      time: Number(row[0]),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]),
    });
  }
  return out;
}

export class BinanceVisionProvider implements DataProvider {
  async listSymbols(): Promise<SymbolDescriptor[]> {
    return CRYPTO_SYMBOLS.map((s) => ({
      ticker: s.symbol,
      name: s.name,
      exchange: 'BINANCE',
      type: 'crypto',
      prefix: 'BINANCE',
    }));
  }

  async getSymbolInfo(ticker: string): Promise<SymbolInfo | undefined> {
    const meta = SYMBOL_MAP.get(ticker.toUpperCase());
    if (!meta) return undefined;
    const minmove = 1;
    const pricescale = 10 ** meta.decimals;
    return {
      ticker: meta.symbol,
      name: meta.name,
      exchange: 'BINANCE',
      type: 'crypto',
      timezone: 'Etc/UTC',
      pricescale,
      minmov: minmove,
      hasVolume: true,
      timeframes: {
        finest: '1',
        default: '60',
        list: Object.keys(TF_TO_BINANCE),
      },
    };
  }

  async getBars(ticker: string, timeframe: string, range: BarRange): Promise<OHLCV[]> {
    const sym = ticker.toUpperCase();
    const interval = TF_TO_BINANCE[timeframe] ?? '1h';
    const limit = Math.min(1000, Math.max(200, range.limit ?? 500));
    const params = new URLSearchParams({
      symbol: sym,
      interval,
      limit: String(limit),
    });
    if (range.to) {
      params.set('endTime', String(Math.floor(range.to)));
    }
    if (range.from) {
      params.set('startTime', String(Math.floor(range.from)));
    }

    const res = await fetch(`${REST_BASE}/klines?${params.toString()}`);
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];

    const byTime = new Map<number, OHLCV>();
    for (const bar of klinesToBars(data)) {
      byTime.set(bar.time, bar);
    }
    return [...byTime.values()].sort((a, b) => a.time - b.time);
  }

  subscribe(ticker: string, timeframe: string, onBar: (bar: OHLCV) => void): () => void {
    const sym = ticker.toLowerCase();
    const interval = TF_TO_BINANCE[timeframe] ?? '1h';
    let ws: WebSocket | null = null;
    let closed = false;
    let reconnectTimer: number | null = null;

    const connect = () => {
      if (closed) return;
      try {
        ws = new WebSocket(`${WS_BASE}/${sym}@kline_${interval}`);
        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(String(ev.data));
            const k = msg?.k;
            if (!k) return;
            onBar({
              time: Number(k.t),
              open: Number(k.o),
              high: Number(k.h),
              low: Number(k.l),
              close: Number(k.c),
              volume: Number(k.v),
            });
          } catch {
            // ignore malformed frame
          }
        };
        ws.onclose = () => {
          if (!closed) {
            reconnectTimer = window.setTimeout(connect, 2500);
          }
        };
        ws.onerror = () => {
          ws?.close();
        };
      } catch {
        reconnectTimer = window.setTimeout(connect, 3000);
      }
    };

    connect();

    return () => {
      closed = true;
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      try {
        ws?.close();
      } catch {
        // ignore
      }
    };
  }
}
