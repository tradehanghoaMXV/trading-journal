import type {
  BarRange,
  DataProvider,
  OHLCV,
  SymbolDescriptor,
  SymbolInfo,
} from '@luxalgo/vela';
import { FOREX_SYMBOLS, SYMBOL_MAP, tfToMs } from '../config/symbols';

const nyFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour12: false,
});

function getNyInfo(utcMs: number) {
  const parts = nyFormatter.formatToParts(new Date(utcMs));
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  const hour = Number(map.hour) === 24 ? 0 : Number(map.hour);
  return {
    weekday: map.weekday,
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour,
    minute: Number(map.minute),
  };
}

/**
 * Forex market is open Sun 17:00 NY -> Fri 17:00 NY.
 */
export function isForexMarketOpen(utcMs: number): boolean {
  const ny = getNyInfo(utcMs);
  if (ny.weekday === 'Sat') return false;
  if (ny.weekday === 'Fri' && ny.hour >= 17) return false;
  if (ny.weekday === 'Sun' && ny.hour < 17) return false;
  return true;
}

/**
 * Broker GMT+2/+3 candle open time in UTC ms (daily close at 17:00 NY).
 */
export function getBrokerBarOpenMs(utcMs: number, timeframe: string): number {
  if (timeframe !== '240' && timeframe !== 'D') {
    const ms = tfToMs(timeframe);
    return Math.floor(utcMs / ms) * ms;
  }
  const bucketHours = timeframe === 'D' ? 24 : 4;
  const ny = getNyInfo(utcMs);
  const shifted = Date.UTC(ny.year, ny.month - 1, ny.day, ny.hour + 7, ny.minute, 0, 0);
  const d = new Date(shifted);
  const brokerHour = Math.floor(d.getUTCHours() / bucketHours) * bucketHours;
  const targetBrokerMs = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    brokerHour,
    0,
    0,
    0
  );
  return utcMs + (targetBrokerMs - shifted);
}

async function fetchLiveSpotPrice(symbol: string): Promise<{ price: number; timeMs: number } | null> {
  try {
    if (symbol === 'XAUUSD' || symbol === 'XAGUSD') {
      const metal = symbol === 'XAUUSD' ? 'XAU' : 'XAG';
      const r = await fetch(`https://api.gold-api.com/price/${metal}`);
      if (!r.ok) return null;
      const j = await r.json();
      const price = Number(j?.price);
      if (!Number.isFinite(price) || price <= 0) return null;
      return { price, timeMs: Date.now() };
    }
    const r = await fetch('https://api.fxratesapi.com/latest');
    if (!r.ok) return null;
    const j = await r.json();
    const rates = j?.rates as Record<string, number> | undefined;
    if (!rates) return null;
    let price = 0;
    if (symbol === 'EURUSD' && rates.EUR) price = 1 / Number(rates.EUR);
    else if (symbol === 'GBPUSD' && rates.GBP) price = 1 / Number(rates.GBP);
    else if (symbol === 'USDJPY' && rates.JPY) price = Number(rates.JPY);
    if (!Number.isFinite(price) || price <= 0) return null;
    return { price, timeMs: Date.now() };
  } catch {
    return null;
  }
}

export class DukascopyPythProvider implements DataProvider {
  private approxRanges = new Map<string, { from: number; to: number }>();

  getApproxRange(symbol: string): { from: number; to: number } | undefined {
    return this.approxRanges.get(symbol);
  }

  async listSymbols(): Promise<SymbolDescriptor[]> {
    return FOREX_SYMBOLS.map((s) => ({
      ticker: s.symbol,
      name: s.name,
      exchange: 'FX',
      type: 'forex',
      prefix: 'FX',
    }));
  }

  async getSymbolInfo(ticker: string): Promise<SymbolInfo | undefined> {
    const meta = SYMBOL_MAP.get(ticker.toUpperCase());
    if (!meta || meta.group !== 'forex') return undefined;
    return {
      ticker: meta.symbol,
      name: meta.name,
      exchange: 'FX',
      type: 'forex',
      timezone: 'America/New_York',
      pricescale: 10 ** meta.decimals,
      minmov: 1,
      hasVolume: false,
      timeframes: {
        finest: '1',
        default: '60',
        list: ['1', '5', '15', '60', '240', 'D'],
      },
    };
  }

  async getBars(ticker: string, timeframe: string, range: BarRange): Promise<OHLCV[]> {
    const sym = ticker.toUpperCase();
    const meta = SYMBOL_MAP.get(sym);
    if (!meta) return [];

    const base = import.meta.env.BASE_URL || '/';
    const url = `${base}data/${sym}/${timeframe}.json`;

    let bars: OHLCV[] = [];
    try {
      const res = await fetch(url);
      if (res.ok) {
        const raw = await res.json();
        if (Array.isArray(raw)) {
          bars = raw
            .filter((r) => Array.isArray(r) && r.length >= 5)
            .map((r) => ({
              time: Number(r[0]),
              open: Number(r[1]),
              high: Number(r[2]),
              low: Number(r[3]),
              close: Number(r[4]),
              volume: Number(r[5] ?? 0),
            }));
        }
      }
    } catch {
      // ignore if offline/missing
    }

    if (range.to) {
      bars = bars.filter((b) => b.time <= range.to!);
    }
    if (range.from) {
      bars = bars.filter((b) => b.time >= range.from!);
    }
    if (range.limit && bars.length > range.limit) {
      bars = bars.slice(bars.length - range.limit);
    }
    return bars;
  }

  subscribe(ticker: string, timeframe: string, onBar: (bar: OHLCV) => void): () => void {
    const sym = ticker.toUpperCase();
    const meta = SYMBOL_MAP.get(sym);
    if (!meta || meta.group !== 'forex') return () => {};

    let currentBar: OHLCV | null = null;
    let closed = false;

    const tick = async () => {
      if (closed) return;
      const pt = await fetchLiveSpotPrice(sym);
      if (closed || !pt || !isForexMarketOpen(pt.timeMs)) return;

      const openMs = getBrokerBarOpenMs(pt.timeMs, timeframe);
      if (!currentBar || openMs > currentBar.time) {
        currentBar = {
          time: openMs,
          open: pt.price,
          high: pt.price,
          low: pt.price,
          close: pt.price,
          volume: 0,
        };
      } else {
        currentBar = {
          ...currentBar,
          high: Math.max(currentBar.high, pt.price),
          low: Math.min(currentBar.low, pt.price),
          close: pt.price,
        };
      }
      onBar(currentBar);
    };

    tick();
    const intervalMs = sym === 'XAUUSD' || sym === 'XAGUSD' ? 3000 : 5000;
    const timer = window.setInterval(tick, intervalMs);

    return () => {
      closed = true;
      clearInterval(timer);
    };
  }
}
