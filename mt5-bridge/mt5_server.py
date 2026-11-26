"""
MT5 Local Bridge HTTP/SSE Server (http://127.0.0.1:8765)
Kết nối trực tiếp MetaTrader 5 terminal trên Windows với Trading Journal web app.
Không cần API key, tự động kết nối lại khi mở/khởi động lại MT5.
"""

from __future__ import annotations

import json
import sys
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import parse_qs, urlparse

try:
    import MetaTrader5 as mt5
except ImportError:
    mt5 = None  # type: ignore[assignment]

HOST = "127.0.0.1"
PORT = 8765

CANONICAL_ALIASES: dict[str, list[str]] = {
    "XAUUSD": ["XAUUSD", "GOLD"],
    "XAGUSD": ["XAGUSD", "SILVER"],
    "EURUSD": ["EURUSD"],
    "GBPUSD": ["GBPUSD"],
    "USDJPY": ["USDJPY"],
}

TIMEFRAME_MAP: dict[str, int] = (
    {
        "1": mt5.TIMEFRAME_M1,
        "5": mt5.TIMEFRAME_M5,
        "15": mt5.TIMEFRAME_M15,
        "60": mt5.TIMEFRAME_H1,
        "240": mt5.TIMEFRAME_H4,
        "D": mt5.TIMEFRAME_D1,
    }
    if mt5 is not None
    else {}
)

_mt5_lock = threading.Lock()
_resolved_cache: dict[str, str] = {}
_cached_offset_sec: int | None = None


def _ensure_connected() -> bool:
    """Ensure MT5 terminal IPC connection is active; auto-reconnect if dropped."""
    if mt5 is None:
        return False
    info = mt5.terminal_info()
    if info is not None and getattr(info, "connected", False):
        return True
    # Try (re)initializing MT5
    _resolved_cache.clear()
    if mt5.initialize():
        info = mt5.terminal_info()
        return info is not None
    return False


def _resolve_symbol_locked(canonical: str) -> str | None:
    """Resolve canonical symbol (e.g. XAUUSD) to broker-specific symbol (e.g. XAUUSDm)."""
    key = canonical.upper().strip()
    if key in _resolved_cache:
        sym = _resolved_cache[key]
        if mt5.symbol_select(sym, True):
            return sym
        _resolved_cache.pop(key, None)

    aliases = CANONICAL_ALIASES.get(key, [key])
    all_symbols = mt5.symbols_get()
    if not all_symbols:
        return None

    names = [s.name for s in all_symbols]
    name_upper_map = {n.upper(): n for n in names}

    # 1. Exact alias match
    for alias in aliases:
        if alias in name_upper_map:
            chosen = name_upper_map[alias]
            if mt5.symbol_select(chosen, True):
                _resolved_cache[key] = chosen
                return chosen

    # 2. Prefix/suffix match (e.g. XAUUSDm, XAUUSDc, XAUUSD.a, XAUUSD.pro, XAUUSD#, GOLDm)
    candidates: list[tuple[int, str]] = []
    for alias in aliases:
        for orig in names:
            up = orig.upper()
            if up.startswith(alias):
                suffix = up[len(alias) :]
                # Prefer clean short suffixes like m, c, .a, .pro, #, _i
                if suffix == "" or not suffix[0].isalpha() or len(suffix) <= 4:
                    candidates.append((len(suffix), orig))

    if candidates:
        candidates.sort(key=lambda x: (x[0], x[1]))
        for _, chosen in candidates:
            if mt5.symbol_select(chosen, True):
                _resolved_cache[key] = chosen
                return chosen

    return None


def _get_broker_utc_offset_sec_locked(broker_sym: str | None = None) -> int:
    """
    MT5 stores bar/tick timestamps as broker-server time encoded as UTC epoch seconds.
    When market is open (tick within 12h of real UTC), compute exact offset rounded to 30m.
    Fallback to cached offset or standard GMT+2/+3 (7200s) when market is closed on weekends.
    """
    global _cached_offset_sec
    now_utc = time.time()

    probe_syms = [broker_sym] if broker_sym else []
    for k in ("XAUUSD", "EURUSD", "BTCUSD"):
        s = _resolved_cache.get(k)
        if s and s not in probe_syms:
            probe_syms.append(s)

    for sym in probe_syms:
        if not sym:
            continue
        tick = mt5.symbol_info_tick(sym)
        if tick is not None and tick.time > 0:
            diff = tick.time - now_utc
            if abs(diff) < 43200:  # within 12 hours -> live/recent tick
                offset = int(round(diff / 1800.0) * 1800)
                _cached_offset_sec = offset
                return offset

    if _cached_offset_sec is not None:
        return _cached_offset_sec

    # Standard forex broker server is GMT+2 (winter) / GMT+3 (summer)
    month = datetime.now(timezone.utc).month
    return 10800 if 3 <= month <= 10 else 7200


def get_health_payload() -> dict[str, Any]:
    if mt5 is None:
        return {
            "ok": False,
            "connected": False,
            "error": "MetaTrader5 Python package not installed",
            "server": None,
            "company": None,
            "resolved": {},
        }
    with _mt5_lock:
        connected = _ensure_connected()
        if not connected:
            return {
                "ok": True,
                "connected": False,
                "server": None,
                "company": None,
                "resolved": {},
            }
        acc = mt5.account_info()
        term = mt5.terminal_info()
        resolved: dict[str, str] = {}
        for canon in CANONICAL_ALIASES:
            s = _resolve_symbol_locked(canon)
            if s:
                resolved[canon] = s
        return {
            "ok": True,
            "connected": True,
            "server": getattr(acc, "server", None) if acc else None,
            "company": getattr(term, "company", None) if term else None,
            "resolved": resolved,
        }


def get_candles_payload(symbol: str, tf: str, count: int) -> tuple[int, Any]:
    if mt5 is None:
        return 503, {"error": "MetaTrader5 package missing"}
    tf_const = TIMEFRAME_MAP.get(tf)
    if tf_const is None:
        return 400, {"error": f"Unsupported timeframe: {tf}"}

    count = max(1, min(count, 5000))
    with _mt5_lock:
        if not _ensure_connected():
            return 503, {"error": "MT5 not connected"}
        broker_sym = _resolve_symbol_locked(symbol)
        if not broker_sym:
            return 404, {"error": f"Symbol not found in MT5: {symbol}"}

        rates = mt5.copy_rates_from_pos(broker_sym, tf_const, 0, count)
        if rates is None:
            return 502, {"error": f"copy_rates_from_pos failed: {mt5.last_error()}"}

        offset_sec = _get_broker_utc_offset_sec_locked(broker_sym)
        candles = [
            [
                (int(r["time"]) - offset_sec) * 1000,
                float(r["open"]),
                float(r["high"]),
                float(r["low"]),
                float(r["close"]),
                int(r["tick_volume"]),
            ]
            for r in rates
        ]
        return 200, candles


def get_tick_payload(symbol: str) -> tuple[int, Any]:
    if mt5 is None:
        return 503, {"error": "MetaTrader5 package missing"}
    with _mt5_lock:
        if not _ensure_connected():
            return 503, {"error": "MT5 not connected"}
        broker_sym = _resolve_symbol_locked(symbol)
        if not broker_sym:
            return 404, {"error": f"Symbol not found in MT5: {symbol}"}
        tick = mt5.symbol_info_tick(broker_sym)
        if tick is None:
            return 502, {"error": f"symbol_info_tick failed: {mt5.last_error()}"}
        offset_sec = _get_broker_utc_offset_sec_locked(broker_sym)
        time_ms = (int(tick.time) - offset_sec) * 1000
        return 200, {
            "symbol": symbol.upper(),
            "brokerSymbol": broker_sym,
            "bid": float(tick.bid),
            "ask": float(tick.ask),
            "last": float(tick.last) if tick.last else float(tick.bid),
            "time_ms": time_ms,
        }


class MT5BridgeHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _send_cors_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Cache-Control", "no-store")

    def _send_json(self, status: int, payload: Any) -> None:
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self._send_cors_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self._send_cors_headers()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        qs = parse_qs(parsed.query)

        if parsed.path == "/health":
            self._send_json(200, get_health_payload())
            return

        if parsed.path == "/candles":
            symbol = (qs.get("symbol") or ["XAUUSD"])[0]
            tf = (qs.get("tf") or ["60"])[0]
            try:
                count = int((qs.get("count") or ["1500"])[0])
            except ValueError:
                count = 1500
            status, payload = get_candles_payload(symbol, tf, count)
            self._send_json(status, payload)
            return

        if parsed.path == "/tick":
            symbol = (qs.get("symbol") or ["XAUUSD"])[0]
            status, payload = get_tick_payload(symbol)
            self._send_json(status, payload)
            return

        if parsed.path == "/stream":
            symbol = (qs.get("symbol") or ["XAUUSD"])[0]
            self._handle_sse(symbol)
            return

        self._send_json(404, {"error": "Not found"})

    def _handle_sse(self, symbol: str) -> None:
        self.send_response(200)
        self._send_cors_headers()
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Connection", "keep-alive")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()

        last_bid: float | None = None
        last_ask: float | None = None
        last_heartbeat = time.monotonic()

        try:
            while True:
                status, payload = get_tick_payload(symbol)
                now = time.monotonic()
                if status == 200 and isinstance(payload, dict):
                    bid = payload["bid"]
                    ask = payload["ask"]
                    if bid != last_bid or ask != last_ask:
                        last_bid = bid
                        last_ask = ask
                        data = json.dumps(
                            {
                                "bid": bid,
                                "ask": ask,
                                "time_ms": payload["time_ms"],
                            },
                            separators=(",", ":"),
                        )
                        self.wfile.write(f"data: {data}\n\n".encode("utf-8"))
                        self.wfile.flush()
                        last_heartbeat = now

                if now - last_heartbeat >= 10.0:
                    self.wfile.write(b": heartbeat\n\n")
                    self.wfile.flush()
                    last_heartbeat = now

                time.sleep(0.4)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
            pass

    def log_message(self, format: str, *args: Any) -> None:
        # Suppress noisy per-request logs; keep startup & error logs clean
        pass


class ReuseThreadingHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True


def main() -> None:
    server = ReuseThreadingHTTPServer((HOST, PORT), MT5BridgeHandler)
    print(f"[MT5 Bridge] Dang chay tai http://{HOST}:{PORT}", flush=True)
    health = get_health_payload()
    if health.get("connected"):
        print(
            f"[MT5 Bridge] Da ket noi MT5: {health.get('company')} ({health.get('server')})",
            flush=True,
        )
        print(f"[MT5 Bridge] Ma da map: {health.get('resolved')}", flush=True)
    else:
        print(
            "[MT5 Bridge] MT5 chua mo/dang nhap. Hay mo MetaTrader 5 — bridge se tu ket noi lai.",
            flush=True,
        )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[MT5 Bridge] Dang dung server...", flush=True)
    finally:
        server.server_close()
        if mt5 is not None:
            with _mt5_lock:
                mt5.shutdown()


if __name__ == "__main__":
    main()
