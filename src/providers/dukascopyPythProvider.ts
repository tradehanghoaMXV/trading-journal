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

const MT5_BRIDGE_URL = 'http://127.0.0.1:8765';
const MT5_PROBE_TTL_MS = 4000;

export type FxDataSourceStatus =
  | {
      mode: 'mt5';
      server: string | null;
      company: string | null;
      resolved: Record<string, string>;
    }
  | { mode: 'fallback' };

export class DukascopyPythProvider implements DataProvider {
  private approxRanges = new Map<string, { from: number; to: number }>();
  private lastBarCache = new Map<string, OHLCV>();
  private status: FxDataSourceStatus = { mode: 'fallback' };
  private statusListeners = new Set<(s: FxDataSourceStatus) => void>();
  private lastProbeAt = 0;
  private probePromise: Promise<boolean> | null = null;

  getApproxRange(symbol: string): { from: number; to: number } | undefined {
    return this.approxRanges.get(symbol);
  }

  getStatus(): FxDataSourceStatus {
    return this.status;
  }

  onStatusChange(cb: (s: FxDataSourceStatus) => void): () => void {
    this.statusListeners.add(cb);
    cb(this.status);
    return () => {
      this.statusListeners.delete(cb);
    };
  }

  private setStatus(next: FxDataSourceStatus) {
    const prev = this.status;
    const same =
      prev.mode === next.mode &&
      (prev.mode === 'fallback' ||
        (next.mode === 'mt5' && prev.server === next.server && prev.company === next.company));
    if (same) return;
    this.status = next;
    for (const cb of this.statusListeners) {
      cb(next);
    }
  }

  async probeMt5(force = false): Promise<boolean> {
    const now = Date.now();
    if (!force && now - this.lastProbeAt < MT5_PROBE_TTL_MS) {
      return this.status.mode === 'mt5';
    }
    if (this.probePromise && !force) {
      return this.probePromise;
    }

    this.probePromise = (async () => {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 1000);
      try {
        const res = await fetch(`${MT5_BRIDGE_URL}/health`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!res.ok) {
          this.setStatus({ mode: 'fallback' });
          return false;
        }
        const data = await res.json();
        if (data?.ok && data?.connected) {
          this.setStatus({
            mode: 'mt5',
            server: data.server ?? null,
            company: data.company ?? null,
            resolved: data.resolved ?? {},
          });
          return true;
        }
        this.setStatus({ mode: 'fallback' });
        return false;
      } catch {
        this.setStatus({ mode: 'fallback' });
        return false;
      } finally {
        clearTimeout(timer);
        this.lastProbeAt = Date.now();
        this.probePromise = null;
      }
    })();

    return this.probePromise;
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

    let bars: OHLCV[] = [];

    // 1. Prefer local MT5 Bridge when connected (100% broker match)
    const mt5Ok = await this.probeMt5();
    if (mt5Ok) {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 2500);
      try {
        const res = await fetch(
          `${MT5_BRIDGE_URL}/candles?symbol=${encodeURIComponent(sym)}&tf=${encodeURIComponent(timeframe)}&count=1500`,
          { signal: controller.signal, cache: 'no-store' }
        );
        if (res.ok) {
          const raw = await res.json();
          if (Array.isArray(raw) && raw.length > 0) {
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
        // fall through to Dukascopy fallback
      } finally {
        clearTimeout(timer);
      }
    }

    // 2. Fallback to Dukascopy static history
    if (bars.length === 0) {
      const base = import.meta.env.BASE_URL || '/';
      const url = `${base}data/${sym}/${timeframe}.json`;
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
    }

    if (bars.length > 0) {
      this.lastBarCache.set(`${sym}:${timeframe}`, bars[bars.length - 1]!);
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

    const cached = this.lastBarCache.get(`${sym}:${timeframe}`);
    let currentBar: OHLCV | null = cached ? { ...cached } : null;
    let closed = false;
    let timer: number | undefined;
    let es: EventSource | null = null;

    const applyPrice = (price: number, timeMs: number) => {
      if (closed || !Number.isFinite(price) || price <= 0) return;
      const openMs = getBrokerBarOpenMs(timeMs, timeframe);
      if (!currentBar || openMs > currentBar.time) {
        currentBar = {
          time: openMs,
          open: price,
          high: price,
          low: price,
          close: price,
          volume: 0,
        };
      } else {
        currentBar = {
          ...currentBar,
          high: Math.max(currentBar.high, price),
          low: Math.min(currentBar.low, price),
          close: price,
        };
      }
      onBar(currentBar);
    };

    const startFallbackPolling = () => {
      if (closed) return;
      const tick = async () => {
        if (closed) return;
        const pt = await fetchLiveSpotPrice(sym);
        if (closed || !pt || !isForexMarketOpen(pt.timeMs)) return;
        applyPrice(pt.price, pt.timeMs);
      };
      tick();
      const intervalMs = sym === 'XAUUSD' || sym === 'XAGUSD' ? 3000 : 5000;
      timer = window.setInterval(tick, intervalMs);
    };

    const startMt5PollingFallback = () => {
      if (closed) return;
      let failures = 0;
      const poll = async () => {
        if (closed) return;
        try {
          const res = await fetch(`${MT5_BRIDGE_URL}/tick?symbol=${encodeURIComponent(sym)}`, {
            cache: 'no-store',
          });
          if (!res.ok) throw new Error('tick failed');
          const t = await res.json();
          failures = 0;
          if (typeof t?.bid === 'number') {
            applyPrice(t.bid, Number(t.time_ms || Date.now()));
          }
        } catch {
          failures += 1;
          if (failures >= 4 && !closed) {
            if (timer !== undefined) clearInterval(timer);
            this.setStatus({ mode: 'fallback' });
            startFallbackPolling();
          }
        }
      };
      poll();
      timer = window.setInterval(poll, 500);
    };

    (async () => {
      const mt5Ok = await this.probeMt5();
      if (closed) return;
      if (mt5Ok) {
        try {
          es = new EventSource(`${MT5_BRIDGE_URL}/stream?symbol=${encodeURIComponent(sym)}`);
          es.onmessage = (ev) => {
            if (closed) return;
            try {
              const d = JSON.parse(ev.data);
              if (typeof d?.bid === 'number') {
                applyPrice(d.bid, Number(d.time_ms || Date.now()));
              }
            } catch {
              // ignore malformed event
            }
          };
          es.onerror = () => {
            if (closed) return;
            es?.close();
            es = null;
            startMt5PollingFallback();
          };
          return;
        } catch {
          startMt5PollingFallback();
          return;
        }
      }
      startFallbackPolling();
    })();

    return () => {
      closed = true;
      if (timer !== undefined) clearInterval(timer);
      if (es) {
        es.close();
        es = null;
      }
    };
  }
}
