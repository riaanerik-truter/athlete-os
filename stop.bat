@echo off
title Athlete OS — Stopping

echo Stopping Athlete OS...
echo.

REM Kill node processes (all services)
taskkill /F /IM node.exe >nul 2>&1
echo [✓] Services stopped

REM Stop database container (optional — comment out to keep DB running)
REM docker stop athleteos_db

echo.
echo Athlete OS stopped. Database container kept running.
echo Run start-athlete-os to restart.
pause
