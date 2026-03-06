@echo off
echo [1/4] Killing any process on port 8001 (backend)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8001 ^| findstr LISTENING') do taskkill /PID %%a /F 2>nul

echo [2/4] Killing any process on port 5175 (frontend)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :5175 ^| findstr LISTENING') do taskkill /PID %%a /F 2>nul

echo [3/4] Starting backend...
start "Cogito Backend" cmd /k "cd /d C:\Documents\Cogito\saas\backend && py -m uvicorn main:app --host 0.0.0.0 --port 8001 --reload"

timeout /t 2 /nobreak >nul

echo [4/4] Starting frontend...
start "Cogito Frontend" cmd /k "cd /d C:\Documents\Cogito\saas\frontend && npm run dev"

echo Done. Check the opened terminal windows.