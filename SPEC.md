# SPEC — Web Nhật Ký Giao Dịch (Trading Journal)

Mọi quyết định công nghệ dưới đây ĐÃ CHỐT. Không hỏi lại người dùng; nếu một quyết định bất khả thi về kỹ thuật, chọn phương án gần nhất và ghi rõ lý do trong báo cáo.

## 0. Mục tiêu
Web tĩnh trên GitHub Pages, giao diện tiếng Việt, theme tối giống TradingView:
1. Xem nhiều mã như TradingView (crypto + XAUUSD/forex), đổi mã, đổi khung thời gian, nhiều chart.
2. Giá realtime.
3. Nhật ký giao dịch: ghi lệnh + ghi chú trực tiếp trên chart, lưu lại, đo độ nhất quán theo từng trường phái.
4. Backtest: Replay (tua lại nến để luyện vào lệnh) + backtest tự động chiến lược có sẵn.

## 1. Stack (đã chốt)
- Vite + TypeScript + Preact (panel nhật ký/thống kê). Package manager: pnpm.
- Chart: `@luxalgo/vela` (Apache-2.0, đã kiểm tra npm v0.10.19, có exports `./workspace`, `./plugin`, `./widget`, `./ui`, `./providers/binance`). Dùng `VelaWorkspace` cho multi-chart + drawing tools; viết custom data provider + plugin để vẽ lệnh/ghi chú. Khóa cố định phiên bản trong package.json.
  - Nếu sau khi thử nghiêm túc Vela không cho vẽ overlay tùy biến (markers/position box) hoặc không chạy được, fallback sang `lightweight-charts` v5 (Apache-2.0) và ghi lý do.
- Lưu trữ: IndexedDB qua `dexie`. Có Export/Import JSON.
- Không backend, không API key nào.

## 2. Nguồn dữ liệu (đã kiểm tra thực tế ngày 25/11/2026)
| Nhóm mã | Lịch sử | Realtime |
|---|---|---|
| Crypto: BTCUSDT, ETHUSDT, SOLUSDT, BNBUSDT, XRPUSDT | Binance REST `https://data-api.binance.vision/api/v3/klines` (CORS `*`, đã test OK) — có thể dùng provider binance có sẵn của Vela nếu nó trỏ endpoint truy cập được | Binance WebSocket `wss://data-stream.binance.vision/ws/<sym>@kline_<tf>` (hoặc `wss://stream.binance.com:9443`) |
| Forex/Kim loại: XAUUSD, XAGUSD, EURUSD, GBPUSD, USDJPY | **Dukascopy** (giá giao ngay chuẩn forex) tải bằng `dukascopy-node` (npm v1.51.1) TRONG GITHUB ACTIONS, ghi ra `public/data/<SYMBOL>/<tf>.json` | **Pyth Hermes** SSE `https://hermes.pyth.network/v2/updates/price/stream?ids[]=<id>&parsed=true` (không key, CORS OK đã test). Lấy feed id qua `https://hermes.pyth.network/v2/price_feeds?query=XAU&asset_type=metal` (XAU/USD id = `765d2ba906dbc32ca17cc11f5310a89e9ee1f6420508c63861f2f8ba4ee34bb2`), forex dùng `asset_type=fx`. Hardcode id vào config. |

KHÔNG dùng Binance XAUUSDT cho vàng (lệch giá forex). KHÔNG scrape TradingView.

Chi tiết forex:
- Độ sâu: M1 7 ngày, M5 30 ngày, M15 90 ngày, H1 2 năm, H4 5 năm, D1 15 năm (có thể gom từ khung nhỏ hơn). Giá bid.
- **Căn nến theo chuẩn broker MT4/MT5: GMT+2 mùa đông / GMT+3 mùa hè (nến ngày đóng lúc 17:00 New York)** cho H4/D1 để khớp chart MT5/TradingView OANDA.
- Realtime: gom tick Pyth (price * 10^expo) thành nến đang chạy. Khoảng trống giữa nến Dukascopy cuối và hiện tại: lấp bằng `https://hermes.pyth.network/v2/updates/price/{publish_time}?ids[]=...&parsed=true` lấy mẫu theo bước nến (giới hạn ~60 request, gộp bước nếu gap dài), đánh dấu là dữ liệu xấp xỉ. Ngoài giờ thị trường (cuối tuần) không sinh nến.
- Footer ghi nguồn: "Lịch sử: Dukascopy · Realtime: Pyth Network / Binance".

## 3. Nhật ký giao dịch
Bảng Dexie:
- `strategies` (trường phái): id, name, description, sourceBook (tên sách/tác giả), rules: string[] (checklist), color, createdAt. Seed sẵn 4 trường phái mẫu kèm checklist: Turtle Breakout (Curtis Faith – Way of the Turtle), EMA9/WMA45 Trend, SMC Order Block, Price Action (Al Brooks).
- `trades`: id, mode: 'live'|'replay'|'backtest', symbol, timeframe, side, entryTime, entryPrice, stopLoss, takeProfit, exitTime?, exitPrice?, size?, strategyId, checklist: boolean[], emotion tag, mistakes: string[], notes (markdown), rMultiple (tính tự động = (exit-entry)/|entry-SL| theo chiều), status open/closed, createdAt.
- `notes`: id, symbol, time, price, text, color, tradeId?.
- `drawings`: lưu trạng thái công cụ vẽ của Vela theo symbol (nếu API cho phép serialize).

Thao tác trên chart:
- Công cụ "Ghi lệnh Long/Short": click điểm vào → kéo SL → kéo TP (giống Long/Short Position của TradingView) → mở form bên phải (điền sẵn giá/thời gian; chọn trường phái, tick checklist, cảm xúc, lỗi, ghi chú) → Lưu.
- Lệnh hiển thị trên chart: marker vào/ra + hộp vùng SL/TP (xanh `#00F59B` / đỏ `#FF3B5C`), click để mở/sửa/đóng lệnh.
- Công cụ "Ghi chú": click lên chart đặt ghim tại (time, price), hover hiện nội dung.
- Lệnh/ghi chú lưu vĩnh viễn và hiện lại khi mở lại mã đó.

## 4. Đo lường độ nhất quán (tab "Độ nhất quán")
Lọc theo trường phái, mode, mã, khoảng thời gian. Chỉ số: số lệnh, win rate, avg R, expectancy (R), profit factor, max drawdown (R), độ lệch chuẩn R, % tuân thủ checklist, ma trận 4 ô (Đúng luật/Thắng, Đúng luật/Thua, Phá luật/Thắng, Phá luật/Thua) với tổng R mỗi ô, equity curve theo R, rolling expectancy 20 lệnh, so sánh Live vs Replay/Backtest cùng trường phái.

**Consistency Score (0–100)** cho mỗi trường phái (cần ≥ 10 lệnh đóng, nếu ít hơn hiển thị "chưa đủ dữ liệu"):
- A = % tuân thủ checklist trung bình (0–100) — trọng số 40%
- B = độ ổn định = 100 × max(0, 1 − σ(rolling expectancy 10 lệnh) / (|mean R| + 1)) — trọng số 30%
- C = độ khớp Live vs Backtest/Replay = 100 × max(0, 1 − |E_live − E_test| / max(|E_test|, 0.25)) — trọng số 30% (nếu thiếu một bên, dồn trọng số sang A và B theo tỷ lệ)
- Score = tổng có trọng số; hiển thị kèm phần giải thích từng thành phần.

## 5. Backtest
- **Replay**: chọn mã + ngày bắt đầu → ẩn nến tương lai; nút Play/Pause/Step, tốc độ 1x–10x; dùng công cụ "Ghi lệnh" như thật, lệnh lưu mode='replay'; tự động đóng lệnh khi chạm SL/TP trong các nến kế tiếp.
- **Backtest tự động** (TypeScript thuần, chạy trong Web Worker): chiến lược có sẵn với tham số chỉnh được:
  1. EMA9 cắt WMA45 (theo xu hướng), SL = ATR(14)×k, TP = R:R.
  2. Turtle/Donchian breakout 20/10.
  3. RSI(14) mean reversion 30/70.
  Kết quả: danh sách lệnh (mode='backtest', có thể lưu vào nhật ký dưới trường phái tương ứng), equity curve R, thống kê như mục 4, marker trên chart. Có phí/spread giả định chỉnh được.
- PineTS (AGPL) KHÔNG tích hợp ở bản này — để giai đoạn 2.

## 6. Giao diện
Bố cục: thanh trên (ô tìm mã, khung thời gian 1m 5m 15m 1h 4h 1D, nút layout 1/2/4 chart, nút Replay, Backtest) · chart chính · thanh công cụ vẽ trái · panel phải dạng tab: "Lệnh", "Ghi chú", "Độ nhất quán", "Trường phái", "Backtest", "Dữ liệu" (export/import). Font Inter/Montserrat, nền `#0b0f17`, card `#131f33`, viền rõ. Chỉ báo EMA9 + WMA45 bật sẵn được.

## 7. Repo & Deploy
- Thư mục: `C:\Users\DELL\.gemini\antigravity\scratch\trading-journal`
- Repo GitHub công khai mới: `tradehanghoaMXV/trading-journal` (gh CLI đã đăng nhập tài khoản tradehanghoaMXV). URL: `https://tradehanghoamxv.github.io/trading-journal/` → Vite `base: '/trading-journal/'`.
- KHÔNG đụng tới repo `tradehanghoamxv.github.io` (web bio đang tạm dừng).
- Workflow `.github/workflows/deploy.yml`: on push main + schedule `*/30 * * * 0-5` (UTC) + workflow_dispatch: cài deps → chạy `scripts/fetch-dukascopy.mjs` (dùng `actions/cache` cho `public/data` để tải tăng dần) → `pnpm build` → deploy Pages (`actions/deploy-pages`). Không commit dữ liệu vào repo.
- Máy chưa có `git`: tải MinGit portable (bản chính thức từ github.com/git-for-windows) vào `C:\Users\DELL\.gemini\antigravity\scratch\tools\mingit`, rồi `gh auth setup-git`.

## 8. Công cụ trên máy
- node: `C:\Users\DELL\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe` (v24)
- pnpm: `node C:\Users\DELL\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\pnpm\bin\pnpm.cjs`
- playwright có sẵn trong `...\dependencies\node\node_modules\playwright` để chụp ảnh kiểm thử.

## 9. Định nghĩa "Xong"
1. `pnpm build` không lỗi, không lỗi TypeScript.
2. Chạy local, Playwright chụp ảnh chứng minh: (a) BTCUSDT chạy realtime (giá đổi sau vài giây), (b) XAUUSD có lịch sử Dukascopy + nến realtime Pyth, (c) một lệnh Long có SL/TP vẽ trên chart + ghi chú, lưu lại sau reload, (d) tab Độ nhất quán có số liệu (dùng dữ liệu backtest), (e) Replay hoạt động.
3. Repo đã push, GitHub Actions chạy xanh, URL Pages mở được.
4. README tiếng Việt: tính năng, nguồn dữ liệu, cách dùng, công thức Consistency Score.
5. Báo cáo: URL, ảnh chụp (đường dẫn), những gì fallback/khác spec và lý do.
