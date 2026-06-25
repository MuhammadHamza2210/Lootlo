@echo off
title LootLo Server
cd /d "%~dp0"
echo ============================================================
echo   Starting LootLo...
echo ============================================================
pip install -r requirements.txt >nul 2>&1
start "" http://127.0.0.1:5000
python app.py
pause
