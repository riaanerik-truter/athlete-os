# Athlete OS

Athlete OS is a self-coaching platform for multisport athletes built on Joe Friel's periodisation methodology. It connects your training devices, analyses your fitness data, and gives you an AI coach — Coach Ri — available via browser, Discord, or WhatsApp.

## Prerequisites

- [Git](https://git-scm.com/download/win)
- [Node.js 18+](https://nodejs.org/en/download)
- [Docker Desktop](https://www.docker.com/products/docker-desktop)

## Quick start

```powershell
git clone https://github.com/your-username/AthleteOS.git
cd AthleteOS
.\install.ps1
```

The installer checks prerequisites, sets up the database, collects your API keys, and launches everything. It takes about 5 minutes on first run.

## Daily use

Double-click `start-athlete-os` on your Desktop to start all services and open the dashboard.

Double-click `stop-athlete-os` to shut down cleanly when you're done.

## Build status

| Layer | Status |
|---|---|
| 1. Storage schema (PostgreSQL + TimescaleDB + pgvector, 27 tables) | ✅ |
| 2. API layer (51 endpoints, Express, ESM) | ✅ |
| 3. Data ingestion service (Garmin, Strava, TrainingPeaks) | ✅ |
| 4. Coaching engine (Friel methodology, CTL/ATL/TSB, AI coach) | ✅ |
| 5. Knowledge engine (ingest, chunk, embed, semantic search) | ✅ |
| 6. Messaging service (Discord, WhatsApp, web chat) | ✅ |
| 7. Snapshot export service | Deferred to V2 |
| 8. Frontend (dashboard, knowledge browser, profile) | ✅ |

## Design documents

- `athlete_os_schema.md` — full database schema (27 tables)
- `athlete_os_api_spec.md` — API specification (51 endpoints)
- `coaching-engine-design.md` — coaching engine architecture
- `knowledge-engine-design.md` — knowledge engine architecture
- `messaging-service-design.md` — messaging service architecture
- `installer-design.md` — installer and first-run experience design
- `SETUP-GUIDE.md` — how to get API keys and set up integrations

## License

MIT
