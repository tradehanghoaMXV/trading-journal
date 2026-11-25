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
  - Lịch sử từ **Dukascopy** (`jetta.dukascopy.com`, giá bid) được tải tăng dần trong GitHub Actions (`scripts/fetch-dukascopy.mjs`), căn nến **H4/D1 theo chuẩn broker GMT+2 mùa đông / GMT+3 mùa hè (đóng ngày 17:00 New York)**.
  - Giá realtime không cần API key từ `api.gold-api.com` (XAU/XAG) và `api.fxratesapi.com` (FX).

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
