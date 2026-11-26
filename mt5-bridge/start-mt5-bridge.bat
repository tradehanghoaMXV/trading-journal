@echo off
chcp 65001 >nul
title MT5 Bridge - Nhat Ky Giao Dich (127.0.0.1:8765)
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo [Loi] Chua tim thay moi truong .venv trong thu muc mt5-bridge.
    echo Vui long tao .venv va cai dat MetaTrader5:
    echo   python -m venv .venv
    echo   .venv\Scripts\pip install MetaTrader5
    pause
    exit /b 1
)

echo ============================================================
echo   MT5 LOCAL BRIDGE - KHOP GIA 100%% METATRADER 5
echo   Dia chi: http://127.0.0.1:8765
echo   Giu cua so nay mo khi su dung Nhat Ky Giao Dich.
echo   Nhan Ctrl+C de dung.
echo ============================================================
echo.

".venv\Scripts\python.exe" "mt5_server.py"
pause
