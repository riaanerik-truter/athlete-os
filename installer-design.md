# Athlete OS — Installer Script Design
**Version:** 1.0  
**Status:** Design complete — ready for Claude Code implementation  
**Platform:** Windows (PowerShell)  
**Last updated:** 2026-04-01

---

## Overview

The installer is a PowerShell script that takes a user from zero to a running Athlete OS system. It checks and installs prerequisites, configures all services, creates the database, seeds reference data, and starts the system for the first time.

A separate one-click start script handles ongoing daily startup after initial installation.

---

## Files delivered

```
AthleteOS/
  install.ps1              ← main installer script
  start.bat                ← one-click daily startup
  stop.bat                 ← graceful shutdown of all services
  SETUP-GUIDE.md           ← how to get API keys and tokens
  README.md                ← project overview and quick start
```

---

## Installer flow

### Phase 1 — Prerequisites check

Check each prerequisite in order. If missing, guide installation.

```
Checking prerequisites...

[✓] PowerShell 5.1+ — OK
[✓] Internet connection — OK
[?] Git — not found
    → Opening git-scm.com/download/win
    → Press Enter after Git is installed to continue...
[?] Node.js 18+ — not found  
    → Opening nodejs.org/en/download
    → Press Enter after Node.js is installed to continue...
[?] Docker Desktop — not found
    → Opening docker.com/products/docker-desktop
    → Press Enter after Docker Desktop is installed and running...
[✓] Docker running — OK
```

Each missing prerequisite:
1. Prints a clear explanation of what it is and why it is needed
2. Opens the download page in the default browser
3. Waits for the user to press Enter before continuing
4. Re-checks after Enter — if still missing, shows the message again

### Phase 2 — Database setup

```
Setting up database...

[✓] Pulling TimescaleDB Docker image (this may take a few minutes)...
[✓] Starting database container athleteos_db...
[✓] Database healthy on port 5432
```

Runs:
```powershell
docker pull timescale/timescaledb-ha:pg16
docker run -d `
  --name athleteos_db `
  --restart unless-stopped `
  -e POSTGRES_PASSWORD=$dbPassword `
  -e POSTGRES_DB=athleteos `
  -p 5432:5432 `
  timescale/timescaledb-ha:pg16
```

The `--restart unless-stopped` flag means the database starts automatically when Docker Desktop starts — the user never needs to manually start the DB again.

### Phase 3 — Configuration

Collects credentials interactively. Each prompt explains what the value is for and where to get it.

```
Configuration
─────────────

Athlete OS API Key (this secures your local API):
→ Leave blank to generate a random key [recommended]: 
  Generated: sk-local-a7f3c9d2e1b8

Anthropic API Key (powers Coach Ri — required):
→ Get yours at console.anthropic.com/api-keys
  Enter key: sk-ant-...

Discord Bot Token (optional — for Coach Ri in Discord):
→ See SETUP-GUIDE.md for step-by-step Discord setup
→ Leave blank to skip: 

Discord Channel ID (required if bot token provided):
→ Leave blank to skip: 

Strava API (optional — for daily activity sync):
→ See SETUP-GUIDE.md for Strava setup
→ Leave blank to skip: 

Your name: 
Your email: 
Primary sport (mtb/cycling/running/swimming/triathlon): 
Timezone (e.g. Africa/Johannesburg): 
```

Writes collected values to `.env` files across all services. Generates a random API key if left blank using:

```powershell
$apiKey = "sk-local-" + (-join ((65..90) + (97..122) + (48..57) | Get-Random -Count 16 | % {[char]$_}))
```

### Phase 4 — Schema and seed data

```
Setting up database schema...

[✓] Running schema migrations (27 tables)...
[✓] Enabling extensions: timescaledb, pgvector, uuid-ossp
[✓] Seeding methodologies (Friel, Daniels VDOT, Seiler Polarised)
[✓] Seeding session types (73 sessions across all sports)
```

Runs each SQL group file from `sql/` in order using:

```powershell
docker exec -i athleteos_db psql -U postgres -d athleteos < "sql\group01_extensions.sql"
# ... repeat for all 10 groups
```

### Phase 5 — Node dependencies

```
Installing dependencies...

[✓] api — npm install
[✓] ingestion — npm install  
[✓] coaching-engine — npm install
[✓] knowledge-engine — npm install
[✓] messaging-service — npm install
[✓] frontend — npm install && npm run build
```

### Phase 6 — Athlete profile creation

```
Creating your athlete profile...

[✓] Athlete profile created for Riaan-Erik Truter
[✓] Friel methodology set as default
[✓] Zone model initialised for cycling
```

Calls `POST /athlete` via the API (which must be started temporarily for this step):

```powershell
# Start API temporarily
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd api; node src/index.js" -WindowStyle Hidden
Start-Sleep 3

# Create athlete
Invoke-RestMethod -Uri "http://localhost:3000/api/v1/athlete" `
  -Method POST `
  -Headers @{"X-API-Key"=$apiKey; "Content-Type"="application/json"} `
  -Body ($athleteData | ConvertTo-Json)

# Stop temporary API
Stop-Process -Name node
```

### Phase 7 — Desktop shortcut

```
Creating desktop shortcuts...

[✓] start-athlete-os shortcut created on Desktop
[✓] stop-athlete-os shortcut created on Desktop
```

Creates `.lnk` shortcuts on the Windows Desktop pointing to `start.bat` and `stop.bat`.

### Phase 8 — First launch

```
Installation complete!
─────────────────────

Starting Athlete OS for the first time...

[✓] Database — running
[✓] API — running on port 3000
[✓] Coaching engine — running on port 3002
[✓] Knowledge engine — running
[✓] Messaging service — running
[✓] Frontend — opening in browser

Opening http://localhost:5173 ...

Welcome to Athlete OS. Coach Ri is ready.
```

Opens the browser to `http://localhost:5173`. The first-run experience begins automatically.

---

## One-click startup script — `start.bat`

Double-click from the Desktop shortcut to start all services.

```batch
@echo off
title Athlete OS — Starting

echo Starting Athlete OS...
echo.

REM Start Docker and database
echo [1/5] Starting database...
docker start athleteos_db >nul 2>&1
timeout /t 3 /nobreak >nul

REM Start API
echo [2/5] Starting API...
start "Athlete OS — API" cmd /k "cd /d %~dp0api && node src/index.js"
timeout /t 2 /nobreak >nul

REM Start coaching engine
echo [3/5] Starting coaching engine...
start "Athlete OS — Coaching Engine" cmd /k "cd /d %~dp0coaching-engine && node src/index.js"
timeout /t 2 /nobreak >nul

REM Start knowledge + messaging together
echo [4/5] Starting knowledge engine and messaging service...
start "Athlete OS — Knowledge Engine" cmd /k "cd /d %~dp0knowledge-engine && node src/index.js"
start "Athlete OS — Messaging Service" cmd /k "cd /d %~dp0messaging-service && node src/index.js"
timeout /t 2 /nobreak >nul

REM Start frontend
echo [5/5] Starting frontend...
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
```

Each service opens in its own labelled terminal window. The user can see each service's logs independently.

---

## Graceful shutdown script — `stop.bat`

```batch
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
```

Database container is kept running by default — it uses minimal resources when idle and restarting it takes a few seconds. Comment out the docker stop line if the user wants to stop it too.

---

## First-run experience

Implemented in the frontend as a `WelcomeTour.jsx` component.

### Trigger

On first load, the frontend checks localStorage for `athleteos_tour_completed`. If not set, the tour starts automatically.

### Tour flow

```
Step 1 — Welcome overlay (full screen)
"Welcome to Athlete OS, [name].
 I'm Coach Ri — your AI training coach built on Joe Friel's methodology.
 Let me show you around."
[Start tour →]

Step 2 — Dashboard highlight
Spotlight on KPI cards
"This is your fitness dashboard. CTL shows your fitness,
 ATL your fatigue, TSB your form. Updated after every sync."
[Next →]

Step 3 — This week panel
"Your training week. Sessions update as you complete them.
 Drop activity files into the watched-activities folder to sync."
[Next →]

Step 4 — Race prediction
"Your race prediction updates as your fitness builds.
 Hover the ℹ icon to see the assumptions behind it."
[Next →]

Step 5 — Chat widget
Spotlight on floating chat button
"This is how you talk to me. Ask questions, log your diary,
 request knowledge summaries — I'm always here."
[Next →]

Step 6 — Knowledge browser
"The knowledge browser is your personal sports science library.
 Add books, papers, and articles and I can summarise them for you."
[Next →]

Step 7 — Settings
"Settings let you control how proactive I am, how much context
 I use, and which channels are active."
[Start onboarding →]
```

### Post-tour onboarding prompt

After the tour completes, Coach Ri sends a message in the web chat widget:

```
Welcome to Athlete OS, [name]. I use Joe Friel's training 
methodology as my foundation — I recommend picking up 
The Triathlon Training Bible and High Performance Cyclist 
when you get a chance. They'll help you understand the 
reasoning behind my recommendations.

Before we set up your training profile, one question:
Would you prefer to do your onboarding here in the browser, 
or in Discord? Either works — just pick whichever feels 
more natural to you.
```

If the athlete chooses Discord, the coach sends the same message to the Discord #coach channel and continues from there. If browser, onboarding continues in the web chat widget.

The onboarding stage system in `coaching-engine/src/coach/onboarding.js` handles the rest — already designed and built.

---

## SETUP-GUIDE.md content

```markdown
# Athlete OS — Setup Guide

## Getting your API keys and tokens

### Anthropic API Key (required)
Coach Ri runs on Anthropic's Claude. You need an API key to use it.

1. Go to console.anthropic.com
2. Create an account or sign in
3. Click "API Keys" in the left sidebar
4. Click "Create Key"
5. Copy the key — it starts with sk-ant-
6. Paste it when the installer asks for it

Cost: You pay per message. Typical monthly cost is $1-5 depending 
on how much you chat with Coach Ri. See the cost tracker in the 
dashboard for your usage.

### Discord Bot Token (optional)
Allows Coach Ri to message you in Discord.

1. Go to discord.com/developers/applications
2. Click "New Application" — name it "Athlete OS Coach"
3. Click "Bot" in the left sidebar
4. Under "Privileged Gateway Intents" enable "Message Content Intent"
5. Click "Reset Token" and copy it
6. Go to "OAuth2" → "URL Generator"
7. Select scope: bot
8. Select permissions: Send Messages, Read Message History, Attach Files
9. Open the generated URL and add the bot to your Discord server
10. In your server, enable Developer Mode (User Settings → Advanced)
11. Create a channel called #coach
12. Right-click the channel → Copy Channel ID
13. Right-click your server → Copy Server ID (Guild ID)

### Strava API (optional)
Allows automatic daily sync of your activities from Strava.

1. Go to strava.com/settings/api
2. Create an application — name it "Athlete OS"
3. Copy the Client ID and Client Secret
4. The installer will open a browser for OAuth authorisation

---

## Keeping your keys safe

- Never share your API keys with anyone
- Never commit .env files to GitHub (the .gitignore handles this)
- If a key is accidentally exposed, regenerate it immediately:
  - Anthropic: console.anthropic.com → API Keys → Delete + Create new
  - Discord: discord.com/developers → Your app → Bot → Reset Token
- Store a backup of your keys in a password manager (1Password, 
  Bitwarden, etc.) — not in a text file on your desktop

---

## Troubleshooting

### "Docker is not running"
Open Docker Desktop from the Start menu and wait for it to fully load 
(the whale icon in the system tray stops animating).

### "Port 3000 is already in use"
Another process is using port 3000. Run: netstat -ano | findstr :3000
Then: taskkill /PID [pid] /F

### "Coach Ri is not responding"
Make sure all services are running. Open start-athlete-os and check 
that all five terminal windows are open and show no errors.

### "Database connection failed"
Run: docker ps
If athleteos_db is not listed, run: docker start athleteos_db
```

---

## New frontend component required

### `WelcomeTour.jsx`

```
frontend/src/components/shared/WelcomeTour.jsx
```

State: `tourStep` (0-7), `tourActive` (bool)
Storage: `localStorage.setItem('athleteos_tour_completed', 'true')` on completion
Spotlight: CSS overlay with a cut-out highlight on the targeted element
Navigation: Next / Skip / Start onboarding buttons
Post-tour: calls `POST /conversations` to log the welcome message from Coach Ri

---

## Build order for Claude Code

1. **`WelcomeTour.jsx`** — tour overlay component, localStorage flag, spotlight highlighting, post-tour coach message trigger
2. **`install.ps1`** — full installer script with all 8 phases
3. **`start.bat`** — one-click startup
4. **`stop.bat`** — graceful shutdown
5. **`SETUP-GUIDE.md`** — key acquisition guide and safety practices
6. **`README.md`** — project overview, quick start, build status

---

## Opening prompt for Claude Code

```
Read CLAUDE.md then read installer-design.md.

Build in this order:

1. WelcomeTour.jsx
   Add to frontend/src/components/shared/WelcomeTour.jsx
   - 7-step tour with spotlight overlay highlighting each 
     dashboard section
   - localStorage flag athleteos_tour_completed prevents 
     repeat on reload
   - Step 7 ends with a post-tour coach message posted to 
     POST /conversations with role: "coach" and the welcome 
     message text from the design doc
   - Add WelcomeTour to Dashboard.jsx — renders on first load 
     if flag not set

2. install.ps1
   Full Windows PowerShell installer covering all 8 phases 
   from the design doc. Use Write-Host with colour for status 
   output (Green for ✓, Yellow for warnings, Red for errors).
   Test each phase works independently before combining.

3. start.bat and stop.bat
   Exactly as defined in the design doc.
   start.bat opens 5 labelled terminal windows.
   stop.bat kills node processes, keeps DB running.

4. SETUP-GUIDE.md
   Exactly as defined in the design doc.

5. README.md
   Project overview including:
   - What Athlete OS is (2 sentences)
   - Prerequisites (Git, Node 18+, Docker Desktop)
   - Quick start: clone → run install.ps1 → done
   - Daily use: double-click start-athlete-os on desktop
   - Build status: all 8 layers listed with ✅
   - Links to design documents in the repo
   - License: MIT

After all 5 items are built, do a final git commit:
git add .
git commit -m "installer, welcome tour, README, setup guide - V1 complete"
git push

Then update CLAUDE.md to mark the project as V1 complete.
```

---

*End of installer design. Athlete OS V1 is feature-complete after this is built.*
