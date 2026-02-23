@echo off
cd /d "%~dp0backend"
py -3.12 -m uvicorn app.main:app --reload --port 8000
pause
