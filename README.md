# Nhật Ký Giao Dịch (Trading Journal)

Ứng dụng web tĩnh (Vite + TypeScript + Preact) giúp theo dõi biểu đồ đa mã, ghi nhật ký giao dịch trực tiếp trên biểu đồ, đo lường độ nhất quán theo từng trường phái và kiểm thử chiến lược (Replay & Backtest tự động). Không cần backend, không cần API key.

## Tính năng chính
1. **Biểu đồ đa mã & đa khung thời gian (`@luxalgo/vela`)**:
   - Hỗ trợ bố cục `1`, `2`, `4` biểu đồ; công cụ vẽ TradingView-like; chỉ báo `EMA 9` và `WMA 45` mặc định.
   - Chuyển nhanh giữa Crypto (`BTCUSDT`, `ETHUSDT`, `SOLUSDT`, `BNBUSDT`, `XRPUSDT`) và Kim loại/Forex (`XAUUSD`, `XAGUSD`, `EURUSD`, `GBPUSD`, `USDJPY`).
2. **Nhật ký giao dịch trực tiếp trên chart (IndexedDB / Dexie)**:
   - Công cụ **Ghi lệnh Long / Short**: click điểm vào (Entry) → kéo/chọn Stop Loss → kéo/chọn Take Profit → điền trường phái, checklist quy tắc, cảm xúc, lỗi mắc phải và ghi chú Markdown.
   - Công cụ **Ghim ghi chú**: đặt ghim tại `(time, price)` trên chart, rê chuột để xem nội dung.
   - Xuất / Nhập toàn bộ dữ liệu dạng JSON.
3. **Đo lường độ nhất quán (Tab "Độ nhất quán")**:
   - Bộ lọc theo trường phái, chế độ (`Live`, `Replay`, `Backtest`), mã và khoảng thời gian.
   - Thống kê: Win rate, Avg R, Expectancy (R), Profit Factor, Max Drawdown (R), Độ lệch chuẩn R, % Tuân thủ checklist, Ma trận kỷ luật 4 ô, Equity Curve (R), Rolling Expectancy 20 lệnh, so sánh Live vs Replay/Backtest.
4. **Backtest & Replay**:
   - **Replay**: tua lại nến từ ngày bất kỳ, Play/Pause/Step tốc độ 1x–10x, vào lệnh Replay và tự động đóng lệnh khi chạm SL/TP.
   - **Backtest tự động (Web Worker)**: 3 chiến lược mẫu (`EMA9 cắt WMA45`, `Turtle / Donchian 20/10`, `RSI(14) 30/70`) với tham số & phí/spread tùy chỉnh, có thể lưu kết quả vào Nhật ký.

## Nguồn dữ liệu
- **Crypto**: Lịch sử từ Binance REST (`data-api.binance.vision/api/v3/klines`) và realtime qua Binance WebSocket (`wss://data-stream.binance.vision/ws`).
- **Forex & Kim loại (XAUUSD, XAGUSD, EURUSD, GBPUSD, USDJPY)**:
  - **Ưu tiên 1 (Chạy 24/7 khớp TradingView `OANDA:XAUUSD`):** Proxy **OANDA v20** miễn phí trên **Cloudflare Workers** (`cloudflare-worker/worker.js`), không cần mở Windows hay MT5.
  - **Ưu tiên 2 (Khớp giá 100% broker MT5):** Kết nối trực tiếp **MetaTrader 5** trên máy qua `mt5-bridge` (miễn phí, không API key).
  - **Ưu tiên 3 (Dự phòng):** Lịch sử từ **Dukascopy** (`jetta.dukascopy.com`, giá bid) được tải tăng dần trong GitHub Actions (`scripts/fetch-dukascopy.mjs`), căn nến **H4/D1 theo chuẩn broker GMT+2 mùa đông / GMT+3 mùa hè (đóng ngày 17:00 New York)**, kết hợp giá realtime từ `api.gold-api.com` (XAU/XAG) và `api.fxratesapi.com` (FX).

## Cài nguồn OANDA 24/7 miễn phí (3 bước)
Để XAUUSD & Forex chạy realtime 24/7 trên cả điện thoại lẫn máy tính khớp biểu đồ `OANDA:XAUUSD`:
1. **Lấy OANDA Demo Token miễn phí:** Tạo tài khoản **OANDA Practice (Demo)** tại `oanda.com` → vào **Manage API Access** → tạo **Personal Access Token**.
2. **Deploy Cloudflare Worker (miễn phí 100k req/ngày):**
   - Vào [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages** → **Create** → **Create Worker** → dán toàn bộ nội dung file [`cloudflare-worker/worker.js`](cloudflare-worker/worker.js) và bấm **Deploy**.
   - Vào **Settings → Variables and Secrets** → thêm Secret tên `OANDA_TOKEN` (dán token ở bước 1). *(Tùy chọn: `OANDA_ENV = "practice"` mặc định, hoặc `"live"` nếu dùng tài khoản thật; `OANDA_ACCOUNT_ID` có thể bỏ trống vì Worker tự động lấy tài khoản đầu tiên).*
3. **Kết nối vào Trading Journal:**
   - Mở web → bấm nút **Cài nguồn OANDA** ở thanh trạng thái dưới cùng (hoặc vào tab **Dữ liệu**).
   - Dán URL Worker (ví dụ `https://oanda-xau.xxx.workers.dev`) → bấm **Lưu & Kết nối** → góc dưới bên trái sẽ chuyển sang `🟢 OANDA Live (24/7)` và tự động tải lại biểu đồ.

## Kết nối MT5 miễn phí (khớp giá 100%)
Để biểu đồ XAUUSD và Forex trên web khớp 100% giá và nến của sàn MetaTrader 5 bạn đang giao dịch:
1. Mở phần mềm **MetaTrader 5** trên Windows và đăng nhập tài khoản sàn (Demo hoặc Live).
2. Chạy file `mt5-bridge\start-mt5-bridge.bat` (nếu chưa tạo `.venv`, chạy `python -m venv mt5-bridge\.venv` và `mt5-bridge\.venv\Scripts\pip install MetaTrader5`).
3. Mở lại trang web (hoặc bấm `[Kết nối MT5]` ở thanh trạng thái dưới cùng) → góc dưới bên trái sẽ chuyển sang `🟢 MT5 Live (<tên server>)`.
4. Bridge tự động nhận diện hậu tố mã sàn (`XAUUSDm`, `XAUUSD.a`, `GOLD`, v.v.) và tự kết nối lại nếu bạn khởi động lại MT5.

## Công thức Consistency Score (0–100)
Áp dụng cho từng trường phái khi có **≥ 10 lệnh đã đóng**:
- **A (40%)** = `% Tuân thủ checklist trung bình` (0–100)
- **B (30%)** = `100 × max(0, 1 − σ(rolling expectancy 10 lệnh) / (|mean R| + 1))`
- **C (30%)** = `100 × max(0, 1 − |E_live − E_test| / max(|E_test|, 0.25))`
  *(Nếu thiếu dữ liệu Live hoặc Backtest/Replay, trọng số của C được phân bổ tỷ lệ sang A (57.1%) và B (42.9%)).*

$$\text{Consistency Score} = w_A \cdot A + w_B \cdot B + w_C \cdot C$$

## Phát triển cục bộ
```bash
pnpm install
pnpm dev
pnpm build
```
