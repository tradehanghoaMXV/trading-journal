/**
 * OANDA v20 Free 24/7 Proxy for Trading Journal (Cloudflare Worker ES Module)
 *
 * Cách cài nhanh trên Cloudflare Dashboard:
 * 1. Workers & Pages -> Create -> Create Worker -> Paste toàn bộ file này -> Deploy.
 * 2. Settings -> Variables and Secrets -> Add Secret:
 *    - OANDA_TOKEN = <Personal Access Token từ OANDA fxTrade / Practice>
 *    - (Tuỳ chọn) OANDA_ENV = "practice" (mặc định) hoặc "live"
 *    - (Tuỳ chọn) OANDA_ACCOUNT_ID = <Account ID, nếu bỏ trống Worker tự lấy account đầu tiên>
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

const SYMBOL_MAP = {
  XAUUSD: 'XAU_USD',
  XAGUSD: 'XAG_USD',
  EURUSD: 'EUR_USD',
  GBPUSD: 'GBP_USD',
  USDJPY: 'USD_JPY',
};

const TF_MAP = {
  '1': 'M1',
  '5': 'M5',
  '15': 'M15',
  '60': 'H1',
  '240': 'H4',
  D: 'D',
  M1: 'M1',
  M5: 'M5',
  M15: 'M15',
  H1: 'H1',
  H4: 'H4',
};

// Cache accountId in Worker isolate memory keyed by env + token prefix
const accountCache = new Map();

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function getOandaHosts(env) {
  const envName = String(env?.OANDA_ENV || 'practice').trim().toLowerCase() === 'live' ? 'live' : 'practice';
  return envName === 'live'
    ? {
        envName: 'live',
        rest: 'https://api-fxtrade.oanda.com',
        stream: 'https://stream-fxtrade.oanda.com',
      }
    : {
        envName: 'practice',
        rest: 'https://api-fxpractice.oanda.com',
        stream: 'https://stream-fxpractice.oanda.com',
      };
}

function maskAccountId(id) {
  if (!id) return null;
  const s = String(id);
  if (s.length <= 6) return '***';
  return `${s.slice(0, 3)}***${s.slice(-4)}`;
}

async function resolveAccountId(env, restBase, envName) {
  const explicit = String(env?.OANDA_ACCOUNT_ID || '').trim();
  if (explicit) return explicit;

  const token = String(env?.OANDA_TOKEN || '').trim();
  const cacheKey = `${envName}:${token.slice(0, 12)}`;
  const cached = accountCache.get(cacheKey);
  if (cached) return cached;

  const res = await fetch(`${restBase}/v3/accounts`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OANDA /v3/accounts failed (${res.status}): ${text.slice(0, 160)}`);
  }

  const data = await res.json();
  const firstId = data?.accounts?.[0]?.id;
  if (!firstId) {
    throw new Error('Không tìm thấy tài khoản OANDA nào trong /v3/accounts');
  }

  accountCache.set(cacheKey, firstId);
  return firstId;
}

function parseOandaUnixMs(rawTime) {
  const num = Number(rawTime);
  if (Number.isFinite(num) && num > 0) {
    return Math.round(num * 1000);
  }
  const parsed = Date.parse(String(rawTime || ''));
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function mapInstrument(rawSymbol) {
  const upper = String(rawSymbol || 'XAUUSD').trim().toUpperCase();
  if (SYMBOL_MAP[upper]) return { symbol: upper, instrument: SYMBOL_MAP[upper] };
  if (/^[A-Z]{3}_[A-Z]{3}$/.test(upper)) {
    return { symbol: upper.replace('_', ''), instrument: upper };
  }
  return null;
}

function mapGranularity(rawTf) {
  const key = String(rawTf || '60').trim().toUpperCase();
  return TF_MAP[key] || null;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method !== 'GET') {
      return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const { envName, rest, stream } = getOandaHosts(env);
    const token = String(env?.OANDA_TOKEN || '').trim();

    if (path === '/' || path === '/health') {
      if (!token) {
        return jsonResponse({
          ok: true,
          connected: false,
          provider: 'oanda',
          env: envName,
          accountIdMasked: null,
          error: 'Chưa cấu hình biến môi trường bí mật OANDA_TOKEN trên Cloudflare Worker',
        });
      }
      try {
        const accountId = await resolveAccountId(env, rest, envName);
        return jsonResponse({
          ok: true,
          connected: true,
          provider: 'oanda',
          env: envName,
          accountIdMasked: maskAccountId(accountId),
        });
      } catch (err) {
        return jsonResponse({
          ok: true,
          connected: false,
          provider: 'oanda',
          env: envName,
          accountIdMasked: null,
          error: err instanceof Error ? err.message : 'OANDA health check failed',
        });
      }
    }

    if (!token) {
      return jsonResponse({ ok: false, error: 'Missing OANDA_TOKEN' }, 500);
    }

    const mapped = mapInstrument(url.searchParams.get('symbol'));
    if (!mapped) {
      return jsonResponse({ ok: false, error: 'Unsupported symbol' }, 400);
    }

    if (path === '/candles') {
      const granularity = mapGranularity(url.searchParams.get('tf'));
      if (!granularity) {
        return jsonResponse({ ok: false, error: 'Unsupported timeframe' }, 400);
      }
      const rawCount = Number(url.searchParams.get('count') || 1500);
      const count = Math.max(1, Math.min(5000, Number.isFinite(rawCount) ? Math.floor(rawCount) : 1500));

      const oandaUrl = `${rest}/v3/instruments/${mapped.instrument}/candles?granularity=${encodeURIComponent(
        granularity
      )}&count=${count}&price=M`;

      const res = await fetch(oandaUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Accept-Datetime-Format': 'UNIX',
        },
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return jsonResponse(
          { ok: false, error: `OANDA candles error (${res.status}): ${text.slice(0, 160)}` },
          res.status
        );
      }

      const data = await res.json();
      const candles = Array.isArray(data?.candles) ? data.candles : [];
      const rows = [];
      for (const c of candles) {
        if (!c?.mid) continue;
        const t = parseOandaUnixMs(c.time);
        const o = Number(c.mid.o);
        const h = Number(c.mid.h);
        const l = Number(c.mid.l);
        const close = Number(c.mid.c);
        const v = Number(c.volume ?? 0);
        if ([t, o, h, l, close].every(Number.isFinite)) {
          rows.push([t, o, h, l, close, Number.isFinite(v) ? v : 0]);
        }
      }
      return jsonResponse(rows);
    }

    if (path === '/tick') {
      let accountId;
      try {
        accountId = await resolveAccountId(env, rest, envName);
      } catch (err) {
        return jsonResponse({ ok: false, error: err instanceof Error ? err.message : 'Account error' }, 502);
      }

      const res = await fetch(
        `${rest}/v3/accounts/${encodeURIComponent(accountId)}/pricing?instruments=${mapped.instrument}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Accept-Datetime-Format': 'UNIX',
          },
        }
      );

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return jsonResponse(
          { ok: false, error: `OANDA pricing error (${res.status}): ${text.slice(0, 160)}` },
          res.status
        );
      }

      const data = await res.json();
      const p = data?.prices?.[0];
      if (!p) {
        return jsonResponse({ ok: false, error: 'No pricing data returned' }, 502);
      }
      const bid = Number(p.bids?.[0]?.price ?? p.closeoutBid);
      const ask = Number(p.asks?.[0]?.price ?? p.closeoutAsk);
      const mid = Number.isFinite(bid) && Number.isFinite(ask) ? (bid + ask) / 2 : bid || ask;
      const time_ms = parseOandaUnixMs(p.time);

      return jsonResponse({
        symbol: mapped.symbol,
        bid,
        ask,
        mid,
        time_ms,
      });
    }

    if (path === '/stream') {
      let accountId;
      try {
        accountId = await resolveAccountId(env, rest, envName);
      } catch (err) {
        return jsonResponse({ ok: false, error: err instanceof Error ? err.message : 'Account error' }, 502);
      }

      const upstream = await fetch(
        `${stream}/v3/accounts/${encodeURIComponent(accountId)}/pricing/stream?instruments=${mapped.instrument}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Accept-Datetime-Format': 'UNIX',
          },
        }
      );

      if (!upstream.ok || !upstream.body) {
        const text = await upstream.text().catch(() => '');
        return jsonResponse(
          { ok: false, error: `OANDA stream error (${upstream.status}): ${text.slice(0, 160)}` },
          upstream.status || 502
        );
      }

      const encoder = new TextEncoder();
      const decoder = new TextDecoder();
      const reader = upstream.body.getReader();
      let buffer = '';

      const sseStream = new ReadableStream({
        async pull(controller) {
          try {
            while (true) {
              const { value, done } = await reader.read();
              if (done) {
                controller.close();
                return;
              }
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() ?? '';

              let emitted = false;
              for (const rawLine of lines) {
                const line = rawLine.trim();
                if (!line) continue;
                try {
                  const obj = JSON.parse(line);
                  if (obj.type === 'PRICE') {
                    const bid = Number(obj.bids?.[0]?.price ?? obj.closeoutBid);
                    const ask = Number(obj.asks?.[0]?.price ?? obj.closeoutAsk);
                    const mid = Number.isFinite(bid) && Number.isFinite(ask) ? (bid + ask) / 2 : bid || ask;
                    const time_ms = parseOandaUnixMs(obj.time);
                    if (Number.isFinite(mid)) {
                      const payload = JSON.stringify({ bid, ask, mid, time_ms });
                      controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
                      emitted = true;
                    }
                  } else if (obj.type === 'HEARTBEAT') {
                    controller.enqueue(encoder.encode(': ping\n\n'));
                    emitted = true;
                  }
                } catch {
                  // ignore malformed JSON chunk
                }
              }
              if (emitted) return;
            }
          } catch (err) {
            controller.error(err);
          }
        },
        cancel() {
          reader.cancel().catch(() => {});
        },
      });

      return new Response(sseStream, {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
        },
      });
    }

    return jsonResponse({ ok: false, error: 'Not found' }, 404);
  },
};
