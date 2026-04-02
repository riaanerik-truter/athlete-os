@echo off
title Athlete OS — Starting

echo Starting Athlete OS...
echo.

REM Start Docker and database
echo [1/5] Starting database...
docker start athleteos_db >nul 2>&1
timeout /t 3 /nobreak >nul

REM Start API
echo [2/6] Starting API...
start "Athlete OS — API" cmd /k "cd /d %~dp0api && node src/index.js"
timeout /t 2 /nobreak >nul

REM Start ingestion service
echo [3/6] Starting ingestion service...
start "Athlete OS - Ingestion" cmd /k "cd /d %~dp0ingestion && node src/index.js"
timeout /t 2 /nobreak >nul

REM Start coaching engine
echo [4/6] Starting coaching engine...
start "Athlete OS — Coaching Engine" cmd /k "cd /d %~dp0coaching-engine && node src/index.js"
timeout /t 2 /nobreak >nul

REM Start knowledge + messaging together
echo [5/6] Starting knowledge engine and messaging service...
start "Athlete OS — Knowledge Engine" cmd /k "cd /d %~dp0knowledge-engine && node src/index.js"
start "Athlete OS — Messaging Service" cmd /k "cd /d %~dp0messaging-service && node src/index.js"
timeout /t 2 /nobreak >nul

REM Start frontend
echo [6/6] Starting frontend...
start "Athlete OS — Frontend" cmd /k "cd /d %~dp0frontend && npm run preview"
timeout /t 3 /nobreak >nul

REM Open browser
echo.
echo All services started. Opening dashboard...
start http://localhost:4173

echo.
echo Athlete OS is running. Close terminal windows to stop individual services.
echo Or double-click stop-athlete-os to shut everything down.
pause
