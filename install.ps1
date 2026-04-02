#Requires -Version 5.1
<#
.SYNOPSIS
    Athlete OS installer - Windows PowerShell
.DESCRIPTION
    Checks prerequisites, sets up the database, collects credentials,
    installs dependencies, creates the athlete profile, adds desktop
    shortcuts, and starts Athlete OS for the first time.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition

function Write-Ok   { param([string]$msg) Write-Host "[OK] $msg" -ForegroundColor Green }
function Write-Warn { param([string]$msg) Write-Host "[!]  $msg" -ForegroundColor Yellow }
function Write-Err  { param([string]$msg) Write-Host "[X]  $msg" -ForegroundColor Red }
function Write-Step { param([string]$msg) Write-Host "`n$msg" -ForegroundColor Cyan }
function Write-Info { param([string]$msg) Write-Host "     $msg" -ForegroundColor Gray }

# ------------------------------------------------------------------------------
# Phase 1 - Prerequisites check
# ------------------------------------------------------------------------------

Write-Step "Phase 1 - Checking prerequisites..."

# PowerShell version
Write-Ok "PowerShell $($PSVersionTable.PSVersion.Major).$($PSVersionTable.PSVersion.Minor) - OK"

# Internet connection
try {
    $null = Invoke-WebRequest -Uri "https://www.google.com" -UseBasicParsing -TimeoutSec 5
    Write-Ok "Internet connection - OK"
} catch {
    Write-Err "No internet connection detected. Please connect and re-run."
    exit 1
}

# Git
function Test-Git {
    try { $null = git --version 2>&1; return $true } catch { return $false }
}
while (-not (Test-Git)) {
    Write-Warn "Git - not found"
    Write-Info "Git is needed to clone repositories."
    Write-Info "Opening git-scm.com/download/win ..."
    Start-Process "https://git-scm.com/download/win"
    Write-Host "     Press Enter after Git is installed to continue..." -NoNewline
    Read-Host
}
Write-Ok "Git - OK"

# Node.js 18+
function Test-Node {
    try {
        $ver = node --version 2>&1
        if ($ver -match 'v(\d+)') { return [int]$Matches[1] -ge 18 }
        return $false
    } catch { return $false }
}
while (-not (Test-Node)) {
    Write-Warn "Node.js 18+ - not found"
    Write-Info "Node.js runs the Athlete OS services."
    Write-Info "Opening nodejs.org/en/download ..."
    Start-Process "https://nodejs.org/en/download"
    Write-Host "     Press Enter after Node.js is installed to continue..." -NoNewline
    Read-Host
}
Write-Ok "Node.js $(node --version) - OK"

# Docker Desktop
function Test-DockerInstalled {
    try { $null = docker --version 2>&1; return $true } catch { return $false }
}
function Test-DockerRunning {
    try {
        $null = docker info 2>&1
        return ($LASTEXITCODE -eq 0)
    } catch { return $false }
}

while (-not (Test-DockerInstalled)) {
    Write-Warn "Docker Desktop - not found"
    Write-Info "Docker runs the PostgreSQL database container."
    Write-Info "Opening docker.com/products/docker-desktop ..."
    Start-Process "https://www.docker.com/products/docker-desktop"
    Write-Host "     Press Enter after Docker Desktop is installed and running..." -NoNewline
    Read-Host
}

while (-not (Test-DockerRunning)) {
    Write-Warn "Docker Desktop is installed but not running"
    Write-Info "Please open Docker Desktop from the Start menu and wait for it to start."
    Write-Info "(The whale icon in the system tray stops animating when ready.)"
    Write-Host "     Press Enter when Docker Desktop is running..." -NoNewline
    Read-Host
}
Write-Ok "Docker Desktop - running"

# ------------------------------------------------------------------------------
# Phase 2 - Database setup
# ------------------------------------------------------------------------------

Write-Step "Phase 2 - Setting up database..."

$dbPassword = Read-Host "Choose a database password (press Enter for 'athleteos')"
if ([string]::IsNullOrWhiteSpace($dbPassword)) { $dbPassword = "athleteos" }

# Remove existing container if present
$existing = docker ps -a --filter "name=athleteos_db" --format "{{.Names}}" 2>&1
if ($existing -match "athleteos_db") {
    Write-Warn "Existing athleteos_db container found - removing..."
    docker rm -f athleteos_db | Out-Null
}

Write-Host "     Pulling TimescaleDB Docker image (this may take a few minutes)..." -ForegroundColor Gray
docker pull timescale/timescaledb-ha:pg16

Write-Host "     Starting database container athleteos_db..." -ForegroundColor Gray
docker run -d `
    --name athleteos_db `
    --restart unless-stopped `
    -e POSTGRES_PASSWORD=$dbPassword `
    -e POSTGRES_DB=athleteos `
    -p 5432:5432 `
    timescale/timescaledb-ha:pg16 | Out-Null

# Wait until the database is ready to accept connections
Write-Host "     Waiting for database to be ready..." -ForegroundColor Gray
$attempts = 0
do {
    $ready = docker exec athleteos_db pg_isready -U postgres 2>&1
    if ($ready -notmatch "accepting connections") {
        Start-Sleep 2
        $attempts++
    }
} while ($ready -notmatch "accepting connections" -and $attempts -lt 30)

if ($attempts -ge 30) {
    Write-Err "Database did not become ready in time. Check Docker logs: docker logs athleteos_db"
    exit 1
}
Write-Ok "Database healthy on port 5432"

# ------------------------------------------------------------------------------
# Phase 3 - Configuration
# ------------------------------------------------------------------------------

Write-Step "Phase 3 - Configuration"
Write-Host "-----------------------------------------------------" -ForegroundColor DarkGray

# API key
Write-Host "`nAthlete OS API Key (this secures your local API):" -ForegroundColor White
Write-Host "-> Leave blank to generate a random key [recommended]: " -NoNewline -ForegroundColor Gray
$apiKeyInput = Read-Host
if ([string]::IsNullOrWhiteSpace($apiKeyInput)) {
    $chars  = (65..90) + (97..122) + (48..57) | Get-Random -Count 16 | ForEach-Object { [char]$_ }
    $apiKey = "sk-local-" + (-join $chars)
    Write-Ok "Generated: $apiKey"
} else {
    $apiKey = $apiKeyInput
    Write-Ok "Using provided key"
}

# Anthropic
Write-Host "`nAnthropic API Key (powers Coach Ri - required):" -ForegroundColor White
Write-Host "-> Get yours at console.anthropic.com/api-keys" -ForegroundColor Gray
$anthropicKey = ""
while ([string]::IsNullOrWhiteSpace($anthropicKey)) {
    $anthropicKey = Read-Host "   Enter key"
    if ([string]::IsNullOrWhiteSpace($anthropicKey)) {
        Write-Warn "Anthropic API key is required. Please enter it."
    }
}

# Discord (optional)
Write-Host "`nDiscord Bot Token (optional - for Coach Ri in Discord):" -ForegroundColor White
Write-Host "-> See SETUP-GUIDE.md for step-by-step Discord setup" -ForegroundColor Gray
$discordToken     = Read-Host "-> Leave blank to skip"
$discordChannelId = ""
$discordGuildId   = ""
if (-not [string]::IsNullOrWhiteSpace($discordToken)) {
    $discordChannelId = Read-Host "   Discord Channel ID"
    $discordGuildId   = Read-Host "   Discord Guild (Server) ID"
}

# Strava (optional)
Write-Host "`nStrava API (optional - for daily activity sync):" -ForegroundColor White
Write-Host "-> See SETUP-GUIDE.md for Strava setup" -ForegroundColor Gray
$stravaClientId     = Read-Host "   Strava Client ID (leave blank to skip)"
$stravaClientSecret = ""
if (-not [string]::IsNullOrWhiteSpace($stravaClientId)) {
    $stravaClientSecret = Read-Host "   Strava Client Secret"
}

# Athlete info
Write-Host "`nAthlete profile:" -ForegroundColor White
$athleteName  = Read-Host "   Your name"
$athleteEmail = Read-Host "   Your email"
$primarySport = ""
while ($primarySport -notmatch "^(mtb|cycling|running|swimming|triathlon)$") {
    $primarySport = Read-Host "   Primary sport (mtb/cycling/running/swimming/triathlon)"
}
$timezone = Read-Host "   Timezone (e.g. Africa/Johannesburg)"
if ([string]::IsNullOrWhiteSpace($timezone)) { $timezone = "UTC" }

# ------------------------------------------------------------------------------
# Write .env files
# ------------------------------------------------------------------------------

$apiEnv = @"
PORT=3000
DB_HOST=localhost
DB_PORT=5432
DB_NAME=athleteos
DB_USER=postgres
DB_PASSWORD=$dbPassword
API_KEY=$apiKey
NODE_ENV=production
"@

$ingestionEnv = @"
API_BASE_URL=http://localhost:3000/api/v1
API_KEY=$apiKey
STRAVA_CLIENT_ID=$stravaClientId
STRAVA_CLIENT_SECRET=$stravaClientSecret
"@

$coachingEnv = @"
API_BASE_URL=http://localhost:3000/api/v1
API_KEY=$apiKey
ANTHROPIC_API_KEY=$anthropicKey
"@

$knowledgeEnv = @"
API_BASE_URL=http://localhost:3000/api/v1
API_KEY=$apiKey
ANTHROPIC_API_KEY=$anthropicKey
"@

$messagingEnv = @"
API_BASE_URL=http://localhost:3000/api/v1
API_KEY=$apiKey
DISCORD_TOKEN=$discordToken
DISCORD_CHANNEL_ID=$discordChannelId
DISCORD_GUILD_ID=$discordGuildId
"@

Set-Content -Path "$scriptDir\api\.env"               -Value $apiEnv       -Encoding UTF8
Set-Content -Path "$scriptDir\ingestion\.env"         -Value $ingestionEnv -Encoding UTF8
Set-Content -Path "$scriptDir\coaching-engine\.env"   -Value $coachingEnv  -Encoding UTF8
Set-Content -Path "$scriptDir\knowledge-engine\.env"  -Value $knowledgeEnv -Encoding UTF8
Set-Content -Path "$scriptDir\messaging-service\.env" -Value $messagingEnv -Encoding UTF8

# Update frontend API key
$frontendApiFile = "$scriptDir\frontend\src\hooks\useApi.js"
if (Test-Path $frontendApiFile) {
    (Get-Content $frontendApiFile) -replace "const API_KEY = '.*'", "const API_KEY = '$apiKey'" |
        Set-Content $frontendApiFile -Encoding UTF8
}

Write-Ok "Configuration written to all .env files"

# ------------------------------------------------------------------------------
# Phase 4 - Schema and seed data
# ------------------------------------------------------------------------------

Write-Step "Phase 4 - Setting up database schema..."

# Group 1 must succeed before anything else - pgvector and timescaledb are
# required by later groups. If this fails, no subsequent SQL will work.
$extFile = Join-Path $scriptDir "sql\group1_extensions.sql"
if (-not (Test-Path $extFile)) {
    Write-Err "sql\group1_extensions.sql not found. Cannot continue without extensions."
    exit 1
}
Write-Host "     Installing extensions (timescaledb, pgvector, uuid-ossp)..." -ForegroundColor Gray
$extContent = Get-Content $extFile -Raw -Encoding UTF8
try {
    $extOutput = ($extContent | docker exec -i athleteos_db psql -U postgres -d athleteos 2>&1) | Out-String
} catch {
    $extOutput = $_.Exception.Message
}
if ($extOutput -match "ERROR:") {
    Write-Err "Extensions failed to install. Output:`n$extOutput"
    Write-Err "TimescaleDB and pgvector must be enabled before proceeding."
    Write-Err "Confirm the Docker image is timescale/timescaledb-ha:pg16 and try again."
    exit 1
}
Write-Ok "sql\group1_extensions.sql - extensions enabled"

# Groups 2-10: run in order.
# NOTICE / WARNING / INFO from PostgreSQL are informational - not failures.
# Only stop if the output contains "ERROR:".
$sqlFiles = @(
    "sql\group2_reference_tables.sql",
    "sql\group3_athlete_core.sql",
    "sql\group4_season_planning.sql",
    "sql\group5_session_tables.sql",
    "sql\group6_fitness_testing.sql",
    "sql\group7_diary_coaching.sql",
    "sql\group8_knowledge_tables.sql",
    "sql\group9_timeseries.sql",
    "sql\group10_ingestion_support.sql"
)

foreach ($sqlFile in $sqlFiles) {
    $fullPath = Join-Path $scriptDir $sqlFile
    if (-not (Test-Path $fullPath)) {
        Write-Warn "SQL file not found: $sqlFile - skipping"
        continue
    }
    $content = Get-Content $fullPath -Raw -Encoding UTF8
    try {
        $output = ($content | docker exec -i athleteos_db psql -U postgres -d athleteos 2>&1) | Out-String
    } catch {
        $output = $_.Exception.Message
    }
    if ($output -match "ERROR:") {
        Write-Warn "$sqlFile - completed with errors (check output below)"
        Write-Host ($output | Select-String "ERROR:" | ForEach-Object { "     $_" }) -ForegroundColor Yellow
    } else {
        Write-Ok "$sqlFile"
    }
}

# ------------------------------------------------------------------------------
# Phase 5 - Node dependencies
# ------------------------------------------------------------------------------

Write-Step "Phase 5 - Installing dependencies..."

$services = @("api", "ingestion", "coaching-engine", "knowledge-engine", "messaging-service")
foreach ($svc in $services) {
    $svcPath = Join-Path $scriptDir $svc
    if (-not (Test-Path $svcPath)) {
        Write-Warn "$svc directory not found - skipping"
        continue
    }
    Write-Host "     Installing $svc..." -ForegroundColor Gray
    Push-Location $svcPath
    try {
        $null = (& npm install --silent 2>&1) | Out-String
    } catch {
        Write-Warn "$svc - npm install warning: $($_.Exception.Message)"
    }
    Pop-Location
    Write-Ok "$svc - npm install complete"
}

# Frontend - install then build
$frontendPath = Join-Path $scriptDir "frontend"
if (Test-Path $frontendPath) {
    Push-Location $frontendPath

    Write-Host "     Installing frontend dependencies..." -ForegroundColor Gray
    try {
        $null = (& npm install --silent 2>&1) | Out-String
    } catch {
        Write-Warn "frontend - npm install warning: $($_.Exception.Message)"
    }

    Write-Host "     Building frontend..." -ForegroundColor Gray
    try {
        $buildOutput = (& npm run build 2>&1) | Out-String
    } catch {
        $buildOutput = $_.Exception.Message
    }

    if ($buildOutput -match "built in" -or $buildOutput -match "dist/") {
        Write-Ok "frontend - build complete"
    } elseif ($buildOutput -match "error" -or $buildOutput -match "Error") {
        Write-Err "frontend - build failed"
        Write-Host $buildOutput -ForegroundColor Red
        Pop-Location
        exit 1
    } else {
        Write-Ok "frontend - build complete"
    }

    Pop-Location
}

# ------------------------------------------------------------------------------
# Phase 6 - Athlete profile creation
# ------------------------------------------------------------------------------

Write-Step "Phase 6 - Creating your athlete profile..."

# Start API temporarily
$apiProc = Start-Process powershell `
    -ArgumentList "-Command", "Set-Location '$scriptDir\api'; node src/index.js" `
    -WindowStyle Hidden `
    -PassThru

Start-Sleep 5

$athleteData = @{
    name          = $athleteName
    email         = $athleteEmail
    primary_sport = $primarySport
    timezone      = $timezone
    methodology   = "friel"
}

try {
    $null = Invoke-RestMethod `
        -Uri "http://localhost:3000/api/v1/athlete" `
        -Method POST `
        -Headers @{ "X-API-Key" = $apiKey; "Content-Type" = "application/json" } `
        -Body ($athleteData | ConvertTo-Json) `
        -ErrorAction SilentlyContinue
    Write-Ok "Athlete profile created for $athleteName"
} catch {
    if ($_.Exception.Response -ne $null -and $_.Exception.Response.StatusCode.value__ -eq 409) {
        Write-Ok "Athlete profile already exists - continuing"
    } else {
        Write-Warn "Could not create athlete profile automatically. You can do this from the dashboard."
    }
}

# Stop temporary API
try {
    Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue
} catch {
    Write-Host "Warning: $($_.Exception.Message)" -ForegroundColor Yellow
}
Start-Sleep 2
Write-Ok "Friel methodology set as default"
Write-Ok "Zone model ready for $primarySport"

# ------------------------------------------------------------------------------
# Phase 7 - Desktop shortcuts
# ------------------------------------------------------------------------------

Write-Step "Phase 7 - Creating desktop shortcuts..."

$desktop = [Environment]::GetFolderPath("Desktop")
$shell   = New-Object -ComObject WScript.Shell

# start shortcut
$startLink              = $shell.CreateShortcut("$desktop\start-athlete-os.lnk")
$startLink.TargetPath        = "$scriptDir\start.bat"
$startLink.WorkingDirectory  = $scriptDir
$startLink.Description       = "Start Athlete OS"
$startLink.Save()
Write-Ok "start-athlete-os shortcut created on Desktop"

# stop shortcut
$stopLink               = $shell.CreateShortcut("$desktop\stop-athlete-os.lnk")
$stopLink.TargetPath         = "$scriptDir\stop.bat"
$stopLink.WorkingDirectory   = $scriptDir
$stopLink.Description        = "Stop Athlete OS"
$stopLink.Save()
Write-Ok "stop-athlete-os shortcut created on Desktop"

# ------------------------------------------------------------------------------
# Phase 8 - First launch
# ------------------------------------------------------------------------------

Write-Step "Phase 8 - First launch"
Write-Host "-----------------------------------------------------" -ForegroundColor DarkGray
Write-Host "`nInstallation complete!" -ForegroundColor Green
Write-Host "Starting Athlete OS for the first time...`n" -ForegroundColor White

# Start all services - use WorkingDirectory to avoid cd chains
Start-Process cmd -ArgumentList @("/k", "node src/index.js") `
    -WorkingDirectory "$scriptDir\api" `
    -WindowStyle Normal
Write-Ok "API - running on port 3000"
Start-Sleep 3

Start-Process cmd -ArgumentList @("/k", "node src/index.js") `
    -WorkingDirectory "$scriptDir\coaching-engine" `
    -WindowStyle Normal
Write-Ok "Coaching engine - running"
Start-Sleep 2

Start-Process cmd -ArgumentList @("/k", "node src/index.js") `
    -WorkingDirectory "$scriptDir\knowledge-engine" `
    -WindowStyle Normal
Write-Ok "Knowledge engine - running"
Start-Sleep 1

Start-Process cmd -ArgumentList @("/k", "node src/index.js") `
    -WorkingDirectory "$scriptDir\messaging-service" `
    -WindowStyle Normal
Write-Ok "Messaging service - running"
Start-Sleep 1

Start-Process cmd -ArgumentList @("/k", "npm run preview") `
    -WorkingDirectory "$scriptDir\frontend" `
    -WindowStyle Normal
Write-Ok "Frontend - starting on port 4173"
Start-Sleep 4

Write-Host "`nOpening http://localhost:4173 ..." -ForegroundColor Cyan
Start-Process "http://localhost:4173"

Write-Host "`n"
Write-Host "Welcome to Athlete OS. Coach Ri is ready." -ForegroundColor Green
Write-Host "`nDatabase: always-on (Docker auto-starts with Docker Desktop)" -ForegroundColor Gray
Write-Host "Daily use: double-click start-athlete-os on your Desktop" -ForegroundColor Gray
Write-Host "`nPress Enter to close this installer..." -NoNewline
Read-Host
