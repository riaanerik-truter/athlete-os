@echo off
title Athlete OS — Starting

echo Starting Athlete OS...
echo.

REM -----------------------------------------------------------------------
REM Step 0 — Ensure Docker is running and database container is up
REM -----------------------------------------------------------------------
echo [0/6] Checking Docker...
docker info >nul 2>&1
if errorlevel 1 (
    echo ERROR: Docker is not running. Please start Docker Desktop and try again.
    pause
    exit /b 1
)

echo [1/6] Starting database container...
docker start athleteos_db >nul 2>&1
REM Wait up to 10s for Postgres to accept connections
set /a attempts=0
:wait_db
set /a attempts+=1
docker exec athleteos_db pg_isready -U postgres >nul 2>&1
if errorlevel 1 (
    if %attempts% lss 10 (
        timeout /t 1 /nobreak >nul
        goto wait_db
    )
    echo WARN: Database may not be ready yet — proceeding anyway.
) else (
    echo      Database ready.
)

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
