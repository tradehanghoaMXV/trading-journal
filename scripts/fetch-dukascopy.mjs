import fs from 'node:fs/promises';
import path from 'node:path';

const SYMBOLS = [
  { symbol: 'XAUUSD', pair: 'XAU-USD' },
  { symbol: 'XAGUSD', pair: 'XAG-USD' },
  { symbol: 'EURUSD', pair: 'EUR-USD' },
  { symbol: 'GBPUSD', pair: 'GBP-USD' },
  { symbol: 'USDJPY', pair: 'USD-JPY' },
];

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  Referer: 'https://www.dukascopy.com/swiss/english/marketwatch/historical/',
  Origin: 'https://www.dukascopy.com',
};

const DAY_MS = 86_400_000;
const MIN_MS = 60_000;

const nyFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function getNyParts(utcMs) {
  const parts = nyFormatter.formatToParts(new Date(utcMs));
  const map = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = Number(p.value);
  }
  const hour = map.hour === 24 ? 0 : map.hour;
  return { year: map.year, month: map.month, day: map.day, hour, minute: map.minute };
}

/**
 * Broker GMT+2 (winter) / GMT+3 (summer) bucket open time in UTC ms (daily close 17:00 NY).
 */
function getBrokerBucketOpenUtc(utcMs, bucketHours) {
  const ny = getNyParts(utcMs);
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

function aggregateUtcBars(bars, bucketMs) {
  const buckets = new Map();
  for (const b of bars) {
    const [t, o, h, l, c, v = 0] = b;
    const key = Math.floor(t / bucketMs) * bucketMs;
    const cur = buckets.get(key);
    if (!cur) {
      buckets.set(key, [key, o, h, l, c, v]);
    } else {
      if (h > cur[2]) cur[2] = h;
      if (l < cur[3]) cur[3] = l;
      cur[4] = c;
      cur[5] = Number((cur[5] + v).toFixed(4));
    }
  }
  return [...buckets.values()].sort((a, b) => a[0] - b[0]);
}

function aggregateBrokerBars(h1Bars, bucketHours) {
  const buckets = new Map();
  for (const b of h1Bars) {
    const [t, o, h, l, c, v = 0] = b;
    const key = getBrokerBucketOpenUtc(t, bucketHours);
    const cur = buckets.get(key);
    if (!cur) {
      buckets.set(key, [key, o, h, l, c, v]);
    } else {
      if (h > cur[2]) cur[2] = h;
      if (l < cur[3]) cur[3] = l;
      cur[4] = c;
      cur[5] = Number((cur[5] + v).toFixed(4));
    }
  }
  return [...buckets.values()].sort((a, b) => a[0] - b[0]);
}

function mergeBars(existing, incoming) {
  const map = new Map();
  for (const b of existing) {
    if (Array.isArray(b) && b.length >= 5) map.set(b[0], b);
  }
  for (const b of incoming) {
    if (Array.isArray(b) && b.length >= 5) map.set(b[0], b);
  }
  return [...map.values()].sort((a, b) => a[0] - b[0]);
}

function decodeJetta(j) {
  if (!j || !Array.isArray(j.times) || j.times.length === 0) return [];
  let t = j.timestamp;
  let o = j.open;
  let h = j.high;
  let l = j.low;
  let c = j.close;
  const out = [];
  for (let i = 0; i < j.times.length; i++) {
    t += j.times[i] * j.shift;
    o = Number((o + j.opens[i] * j.multiplier).toFixed(5));
    h = Number((h + j.highs[i] * j.multiplier).toFixed(5));
    l = Number((l + j.lows[i] * j.multiplier).toFixed(5));
    c = Number((c + j.closes[i] * j.multiplier).toFixed(5));
    const v = Number((j.volumes?.[i] ?? 0).toFixed(4));
    if (o > 0 && h > 0 && l > 0 && c > 0) {
      out.push([t, o, h, l, c, v]);
    }
  }
  return out;
}

async function fetchJettaJson(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (res.status === 400 || res.status === 404) return [];
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      return decodeJetta(json);
    } catch (err) {
      if (attempt === 2) return [];
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    }
  }
  return [];
}

async function mapBatched(items, batchSize, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const chunk = items.slice(i, i + batchSize);
    const res = await Promise.all(chunk.map(fn));
    results.push(...res);
  }
  return results.flat();
}

async function getServerNowMs() {
  return Date.now();
}

async function readExisting(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

async function processSymbol({ symbol, pair }, nowMs, quickMode) {
  const outDir = path.resolve('public', 'data', symbol);
  await fs.mkdir(outDir, { recursive: true });

  const m15Days = quickMode ? 10 : 90;
  const h1Years = quickMode ? 0.3 : 2;
  const h4Years = quickMode ? 0.3 : 5;
  const d1Years = quickMode ? 1 : 15;

  // 1. Fetch minute bars for last m15Days (incrementally from existing m15 or m1)
  const f1 = path.join(outDir, '1.json');
  const f5 = path.join(outDir, '5.json');
  const f15 = path.join(outDir, '15.json');
  const f60 = path.join(outDir, '60.json');
  const f240 = path.join(outDir, '240.json');
  const fD = path.join(outDir, 'D.json');

  const [ex1, ex5, ex15, ex60, ex240, exD] = await Promise.all([
    readExisting(f1),
    readExisting(f5),
    readExisting(f15),
    readExisting(f60),
    readExisting(f240),
    readExisting(fD),
  ]);

  const lastM15Ts = ex15.length ? ex15[ex15.length - 1][0] : 0;
  const nowDate = new Date(nowMs);
  const monthStartMs = Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), 1);
  const m15StartMs = Math.min(
    monthStartMs,
    Math.max(nowMs - m15Days * DAY_MS, lastM15Ts ? lastM15Ts - 2 * DAY_MS : 0)
  );

  const dayUrls = [];
  for (let t = Math.floor(m15StartMs / DAY_MS) * DAY_MS; t <= nowMs; t += DAY_MS) {
    const d = new Date(t);
    if (d.getUTCDay() === 6) continue; // Saturday market closed
    dayUrls.push(
      `https://jetta.dukascopy.com/v1/candles/minute/${pair}/BID/${d.getUTCFullYear()}/${pad2(
        d.getUTCMonth() + 1
      )}/${pad2(d.getUTCDate())}`
    );
  }

  const freshM1 = await mapBatched(dayUrls, 8, fetchJettaJson);
  const m1Cut = nowMs - (quickMode ? 2 : 7) * DAY_MS;
  const m5Cut = nowMs - (quickMode ? 7 : 30) * DAY_MS;
  const m15Cut = nowMs - m15Days * DAY_MS;

  const mergedM1 = mergeBars(
    ex1.filter((b) => b[0] >= m1Cut),
    freshM1.filter((b) => b[0] >= m1Cut)
  );
  const mergedM5 = mergeBars(
    ex5.filter((b) => b[0] >= m5Cut),
    aggregateUtcBars(freshM1, 5 * MIN_MS).filter((b) => b[0] >= m5Cut)
  );
  const mergedM15 = mergeBars(
    ex15.filter((b) => b[0] >= m15Cut),
    aggregateUtcBars(freshM1, 15 * MIN_MS).filter((b) => b[0] >= m15Cut)
  );

  // 2. Fetch H1 monthly endpoints for completed months + aggregate freshM1 for current month
  const h1Cut = nowMs - Math.round(h4Years * 365 * DAY_MS);
  const lastH1Ts = ex60.length ? ex60[ex60.length - 1][0] : 0;
  const h1FetchStart = Math.max(
    nowMs - Math.round(h1Years * 365 * DAY_MS),
    lastH1Ts ? lastH1Ts - 35 * DAY_MS : 0
  );

  const monthUrls = [];
  const startDate = new Date(h1FetchStart);
  const endDate = new Date(nowMs);
  let y = startDate.getUTCFullYear();
  let m = startDate.getUTCMonth() + 1;
  while (y < endDate.getUTCFullYear() || (y === endDate.getUTCFullYear() && m <= endDate.getUTCMonth() + 1)) {
    monthUrls.push(`https://jetta.dukascopy.com/v1/candles/hour/${pair}/BID/${y}/${pad2(m)}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  // Also fetch older H1 for 5y H4 on initial cold start
  if (!quickMode && ex240.length === 0) {
    const coldStart = new Date(h1Cut);
    let cy = coldStart.getUTCFullYear();
    let cm = coldStart.getUTCMonth() + 1;
    while (cy < startDate.getUTCFullYear() || (cy === startDate.getUTCFullYear() && cm < startDate.getUTCMonth() + 1)) {
      monthUrls.unshift(`https://jetta.dukascopy.com/v1/candles/hour/${pair}/BID/${cy}/${pad2(cm)}`);
      cm += 1;
      if (cm > 12) {
        cm = 1;
        cy += 1;
      }
    }
  }

  const freshH1Months = await mapBatched(monthUrls, 6, fetchJettaJson);
  const h1FromM1 = aggregateUtcBars(freshM1, 60 * MIN_MS);
  const allH1 = mergeBars(mergeBars(ex60, freshH1Months), h1FromM1);

  const h1SaveCut = nowMs - Math.round(h1Years * 365 * DAY_MS);
  const mergedH1 = allH1.filter((b) => b[0] >= h1SaveCut);
  const mergedH4 = mergeBars(
    ex240.filter((b) => b[0] >= h1Cut),
    aggregateBrokerBars(allH1.filter((b) => b[0] >= h1Cut), 4)
  );

  // 3. Fetch D1 yearly endpoints + broker-aligned D1 from H1
  const d1Cut = nowMs - Math.round(d1Years * 365 * DAY_MS);
  const lastDTs = exD.length ? exD[exD.length - 1][0] : 0;
  const dStartYear = lastDTs ? new Date(lastDTs).getUTCFullYear() - 1 : new Date(d1Cut).getUTCFullYear();
  const dEndYear = new Date(nowMs).getUTCFullYear();
  const yearUrls = [];
  for (let yr = dStartYear; yr <= dEndYear; yr++) {
    yearUrls.push(`https://jetta.dukascopy.com/v1/candles/day/${pair}/BID/${yr}`);
  }
  const freshD1Years = await mapBatched(yearUrls, 5, fetchJettaJson);
  const d1FromH1 = aggregateBrokerBars(allH1, 24);
  const mergedD1 = mergeBars(
    mergeBars(exD.filter((b) => b[0] >= d1Cut), freshD1Years.filter((b) => b[0] >= d1Cut)),
    d1FromH1
  );

  await Promise.all([
    fs.writeFile(f1, JSON.stringify(mergedM1)),
    fs.writeFile(f5, JSON.stringify(mergedM5)),
    fs.writeFile(f15, JSON.stringify(mergedM15)),
    fs.writeFile(f60, JSON.stringify(mergedH1)),
    fs.writeFile(f240, JSON.stringify(mergedH4)),
    fs.writeFile(fD, JSON.stringify(mergedD1)),
  ]);

  console.log(
    `[${symbol}] 1m:${mergedM1.length} 5m:${mergedM5.length} 15m:${mergedM15.length} 1h:${mergedH1.length} 4h:${mergedH4.length} 1D:${mergedD1.length}`
  );
}

async function main() {
  const quickMode = process.argv.includes('--quick');
  const only = process.argv.find((a) => a.startsWith('--symbol='))?.split('=')[1];
  const targets = only ? SYMBOLS.filter((s) => s.symbol === only.toUpperCase()) : SYMBOLS;
  const nowMs = await getServerNowMs();
  console.log(`Server UTC now: ${new Date(nowMs).toISOString()} (quick=${quickMode})`);

  for (const item of targets) {
    await processSymbol(item, nowMs, quickMode);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
