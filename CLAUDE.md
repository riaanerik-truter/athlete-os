## Session management

The MEM and SESSION status bars are shown live in the Claude Code terminal status line — no need to print them in responses.

When MEM reaches 80%, add a warning at the top of your response:
⚠ Memory approaching limit. Update CLAUDE.md current status section now and prepare to summarise completed work before context is lost.

When MEM reaches 90%, stop all implementation work and:
1. Update CLAUDE.md with full current status
2. List every file modified in this session
3. List the next step in precise detail
4. Instruct the user to start a new Claude Code session

This ensures no work is lost when the context window fills.


# Athlete OS — Claude Code Project Instructions

## Role and working style

You are the developer building Athlete OS, a self-coaching platform for multisport athletes. Be direct. No filler. Use code and structured output where appropriate. Before writing any code, confirm you understand the task. After completing each step, summarise what was done and what comes next. Flag design problems immediately — do not work around them silently.

---

## What we are building

A self-coaching platform called Athlete OS. It is structured as:

**Frontend (3 surfaces)**
- Athlete dashboard — KPIs, training load, form, fitness, goal and block progress visualised
- Knowledge browser — search, read, annotate sports science content, linked to coach references
- Coach interface (WhatsApp) — conversation, training diary, session planning, goal setting and revision

**Backend (4 services)**
- Data ingestion service — scheduled sync from Garmin Connect API, TrainingPeaks API, Strava API, Assioma (via Garmin)
- Coaching engine — AI logic, periodisation rules, session goal alignment, dynamic plan revision
- Knowledge engine — ingest, chunk, embed and index books/papers/articles/talks; semantic search
- Messaging service — WhatsApp Business API, webhooks, alerts

**Shared API layer** — single interface all frontends and services communicate through

**Storage (3 engines, one PostgreSQL deployment)**
- Relational DB (PostgreSQL) — goals, plans, sessions, athletes, methodology
- Time-series DB (TimescaleDB extension) — workout streams, daily health metrics
- Vector store (pgvector extension) — knowledge base chunks, semantic search index

**External systems (integrated, not owned)**
TrainingPeaks, Garmin Connect, Strava, WhatsApp Business API

---

## Architecture decisions (do not revisit without flagging)

- Single PostgreSQL deployment with TimescaleDB and pgvector extensions. Not three separate systems.
- Garmin is the primary data source for all raw activity data. Strava and TrainingPeaks are additive — they contribute unique fields to the same `completed_session` record. No duplicate rows.
- TrainingPeaks stays as the athlete's planning and structured workout tool. The system augments it, does not replace it.
- All tables have `athlete_id` as a foreign key. No athlete-agnostic data except reference tables (`methodology`, `session_type`).
- UUIDs for all primary keys.
- JSONB for variable-structure data (lab results, zone distributions, structured metadata).
- Soft deletes (`deleted_at`) on athlete-facing records.
- All timestamps in UTC.
- The methodology layer is pluggable — the coaching engine applies whichever methodology the athlete selected at intake. Friel is the default starting point.

---

## Sports science model

The coaching engine runs on this rule set.

**Supported methodologies (pluggable)**
- Friel (cycling, triathlon, MTB) — base/build/peak/race periodisation, 7-zone HR model, pure middle → polarised intensity distribution
- Daniels VDOT (running only) — 5 pace zones (E/M/T/I/R), VDOT score as fitness anchor, points-per-minute session scoring
- Seiler polarised (cycling, running) — 80/20 intensity split, 3-zone model

**Friel zone model (7 zones, FTHR-based)**
- Z1: <78% FTHR — recovery
- Z2: 78–86% FTHR — aerobic endurance (primary base zone)
- Z3: 87–93% FTHR — tempo
- Z4: 94–99% FTHR — sub-threshold
- Z5a: 100–102% FTHR — threshold
- Z5b: 103–106% FTHR — aerobic capacity
- Z5c: >106% FTHR — anaerobic/sprint

**Power zones anchored to FTP (Coggan)**
- Z1: <56% FTP
- Z2: 56–75% FTP
- Z3: 76–90% FTP
- Z4: 91–105% FTP
- Z5a: 106–120% FTP
- Z5b/5c: >120% FTP

**Swim zones anchored to CSS (critical swim speed)**
Derived from 1000m time trial. Zones expressed as pace per 100m.

**Daniels pace zones (running)**
- E (easy): 59–74% VDOT — 0.2 pts/min
- M (marathon): 75–84% VDOT — 0.4 pts/min
- T (threshold): mid-80s% VDOT — 0.6 pts/min
- I (interval): ~100% VO2max — 1.0 pts/min
- R (repetition): ~105–110% VDOT — 1.5 pts/min

**Intensity distribution rules**
- Base period: pure middle (70% Z1-Z2, 30% Z3-Z4, 0% Z5)
- Build and peak: polarised (80% Z1-Z2, 0% Z3-Z4, 20% Z5)

**Friel period structure**
- Preparation: 3–6 weeks, frequency emphasis, cross-training
- Base 1/2/3: 12 weeks total, frequency/duration, pure middle
- Build 1/2: 8–9 weeks max, intensity, polarised
- Peak: 10–14 days, taper volume, hold intensity
- Race: 5–7 days, sharpen, 0.5 × Base3 volume
- Transition: 1–4 weeks, rest and recovery

**Load progression**
- 3 weeks build + 1 week recovery, repeating
- Peak vol = 0.7 × Base3; Race vol = 0.5 × Base3
- Easy:hard ratio — Base: 4:3; Build: 5:2

**Key KPIs**
- CTL (chronic training load) — fitness
- ATL (acute training load) — fatigue
- TSB (training stress balance) — form = CTL - ATL
- FTP (functional threshold power) — cycling anchor
- VDOT — running fitness anchor
- CSS (critical swim speed) — swim anchor
- EF (efficiency factor) = NP / avg HR — aerobic fitness proxy
- Aerobic decoupling % — EF drift first vs second half of long ride. Target <5% before progressing base to build
- Readiness score — engine-calculated composite from HRV, body battery, sleep score, resting HR trend

**Session scoring (two systems)**
- Friel/Triathlon Bible: zone value × minutes in zone (Z1=1, Z2=2, Z3=3, Z4=4, Z5=5)
- Daniels: points per minute by pace zone (see above)
- TSS: universal currency, always calculated regardless of methodology

**Period progression gates (coaching engine decision rules)**
- Base → Build: decoupling <5% on long Z2 ride, EF trending upward
- Build → Peak: FTP re-tested, limiter sessions complete, TSB recovering positive
- Peak → Race: volume at target reduction, TSB positive, no fatigue flags

**Strength phases (Friel)**
- AA (Anatomical Adaptation): Prep — 40–60% 1RM, 15–20 reps, 2–3×/week
- MT (Max Transition): Prep→Base1 — 70–80% 1RM, 8–12 reps, 2–3×/week
- MS (Max Strength): Base1 — 85–95% 1RM, 3–6 reps, 2–3×/week
- SM (Strength Maintenance): Base2→Peak — 60/85% 1RM alternating, 12/6 reps, 1×/week

---

## Session taxonomy

Full session type taxonomy across all sports. Stored in the `session_type` reference table.

**Cycling (Friel / High Performance Cyclist)**
AE1 Recovery, AE2 Aerobic threshold, Te1 Tempo endurance, MF1 Flat force reps, MF2 Hill force reps, MF3 Hill repeats, SS1 Spin-ups, SS2 Isolated leg, ME1 Cruise intervals, ME2 Hill cruise intervals, ME3 Crisscross intervals, ME4 Threshold ride, AC1 VO2max intervals, AC2 Pyramid intervals, AC3 Hill intervals, SP1 Form sprints, SP2 Competitive sprints, T1 FTP/FTHR test, T2 Aerobic capacity test, T3 Stamina test, T4 Sprint power test, T5 Time trial

**Running (Friel Triathlon Bible + Daniels)**
AE1 Recovery, AE2 Aerobic endurance, Te1 Tempo endurance, MF1 Force reps, MF2 Hill fartlek, MF3 Hill repeats, SS1 Strides, SS2 Pickups, ME1 Cruise intervals, ME2 Hill cruise intervals, ME3 Crisscross intervals, ME4 Threshold run, AC1 Group run, AC2 VO2max intervals, AC3 Hill intervals, E-session Easy/Long, M-session Marathon pace, T-session Threshold, I-session Interval/Hard pace, R-session Repetition, G-session Treadmill hills, T1 FTP pace/FTHR test, T2 VO2max estimation, T3 VO2max time trial

**Swimming (Friel Triathlon Bible)**
AE1 Recovery, AE2 Aerobic endurance intervals, Te1 Tempo intervals, MF1 Muscular force reps, MF2 Open-water current intervals, MF3 Paddles, SS1 Fast-form 25s, SS2 Toy sets, ME1 Long cruise intervals, ME2 Short cruise intervals, ME3 Threshold, AC1 VO2max intervals, AC2 Aerobic capacity intervals, T1 Broken kilometer, T2 Functional threshold pace test (CSS)

**Brick sessions (Friel Triathlon Bible)**
AE1 Aerobic endurance brick, TB1 Tempo brick, SS1 Transition 1 practice, SS2 Transition 2 practice, ME1 Muscular endurance brick, ME2 Hilly brick, AC1 Bike-intervals brick, AC2 Run-intervals brick

**Strength**
Gym sessions linked to strength_phase table. Not in annual training plan volume calculations.

---

## Data sources and deduplication

**Garmin Connect API**
- Primary source for all raw activity data
- Two separate sync jobs: activities sync and health data sync
- Health data: HRV, resting HR, body battery, sleep stages, SpO2, stress score, skin temperature

**TrainingPeaks API**
- Additive fields only: TSS, CTL, ATL, TSB, IF, EF, VI, compliance score
- Planned workout import: `tp_workout_id` links to `planned_session`

**Strava API**
- Additive fields only: suffer score, relative effort, segment PRs, social data

**Deduplication rule**
One `completed_session` row per workout, keyed on `garmin_activity_id`. Strava and TrainingPeaks fields written into the same row. EF stored as both `ef_garmin_calculated` and `ef_trainingpeaks` — `ef_source_used` records which the engine applied and why.

---

## Storage schema

Full schema is in `athlete_os_schema.md` in this folder. 27 tables total.

**Table groups in implementation order:**
1. Extensions: timescaledb, pgvector, uuid-ossp
2. Reference tables: methodology, session_type
3. Athlete core: athlete, zone_model, permission
4. Season and planning: season, goal, period, week, strength_phase
5. Session tables: planned_session, completed_session, session_score
6. Fitness and testing: field_test, lab_result, fitness_snapshot
7. Diary and coaching: diary_entry, conversation, notification_log, coach_reference, annotation
8. Knowledge tables: knowledge_chunk, methodology_document
9. Time-series tables: workout_stream, lap_summary, daily_metrics
10. Ingestion support: sync_state

---

## Build order (layers)

We build in this order. Do not start a layer until the previous one is complete and tested.

1. **Storage schema** — PostgreSQL + TimescaleDB + pgvector. All 27 tables. ← COMPLETE
2. **API layer** — shared REST API all frontends and services talk to ← COMPLETE
3. **Data ingestion service** — Garmin, TrainingPeaks, Strava sync ← COMPLETE
4. **Coaching engine** — AI logic, methodology rules, session planning ← COMPLETE
5. **Knowledge engine** — ingest, chunk, embed, semantic search ← COMPLETE
6. **Messaging service** — Discord, WhatsApp, web chat ← COMPLETE
7. **Snapshot export service** — deferred to V2
8. **Frontend** — dashboard, knowledge browser ← COMPLETE
9. **Installer script** — install.ps1, start.bat, stop.bat, WelcomeTour.jsx ← COMPLETE

---

## Current status

**Storage layer complete.** All 26 tables created and verified in PostgreSQL (TimescaleDB + pgvector, Docker container `athleteos_db`).

Reference data seeded:
- `methodology`: 3 rows (Friel, Daniels VDOT, Seiler Polarised)
- `session_type`: 73 rows (cycling 22, running 24, swimming 15, brick 8, strength 4)

One schema correction applied during build:
- `daily_metrics` unique index updated to include `time` column — required by TimescaleDB for unique indexes on hypertables. Semantically equivalent to the original constraint.

One design decision made during build:
- `permission` table deferred. Not needed in V1 — see portability section.

SQL files for all 10 groups are in `sql/` in this folder.

---

**API layer complete.** Express app in `api/`. Node 24, ESM, no ORM.

All 10 route groups implemented and verified (zero 501 responses):
- Group 1: system.js (`GET /health`, `GET /config`)
- Group 2: athlete.js (`GET /athlete`, `PATCH /athlete`)
- Group 3: zones.js (`GET /zones`, `POST /zones/recalculate`)
- Group 4: sync.js (`GET /sync/status`, `POST /sync/trigger`, `PATCH /sync/status/:source`, `GET /methodologies`, `GET /session-types`)
- Group 5: season.js (`GET /season`, `POST /season`, `GET /goals`, `POST /goals`, `PATCH /goals/:id`, `GET /periods`, `POST /periods`, `GET /periods/:id/weeks`, `GET /weeks/current`)
- Group 6: sessions.js (`GET /sessions/planned`, `POST /sessions/planned`, `GET /sessions`, `GET /sessions/:id`, `POST /sessions`, `PATCH /sessions/:id`, `GET /sessions/:id/stream`)
- Group 7: fitness.js (`GET /fitness/snapshot`, `GET /fitness/snapshots`, `POST /fitness/snapshot`, `GET /fitness/tests`, `POST /fitness/tests`, `GET /fitness/labs`, `POST /fitness/labs`, `GET /health/daily`, `POST /health/daily`)
- Group 8: diary.js (`GET /diary`, `GET /diary/:date`, `POST /diary`, `PATCH /diary/:date/coach`, `GET /conversations`, `POST /conversations`, `GET /notifications`)
- Group 9: knowledge.js (`GET /knowledge/search`, `POST /knowledge/ingest`, `GET /knowledge/ingest/:job_id`, `GET /knowledge/sources`, `GET /knowledge/annotations`, `POST /knowledge/annotations`)
- Group 10: snapshot.js (`POST /snapshot/generate`, `GET /snapshot/status`)

All db query files complete: `db/athlete.js`, `db/season.js`, `db/sessions.js`, `db/fitness.js`, `db/diary.js`, `db/knowledge.js`, `db/sync.js`.

Patterns established across all routes:
- Zod strict schemas — unknown fields → 422
- Standard error shape: `{ error: { code, message, field } }`
- DB functions only in routes — no inline SQL
- `getAthleteId(pool)` from `db/sync.js` for lightweight athlete resolution

Two Layer 5 stubs (knowledge engine not yet built):
- `POST /knowledge/ingest` — returns 202 with UUID job_id; no persistence
- `GET /knowledge/ingest/:job_id` — returns fixed "processing" shape; no job table
- `GET /knowledge/search` — PostgreSQL ILIKE text fallback until knowledge engine provides embeddings

One design decision: `GET /snapshot/status` reads from `sync_state` where `source='snapshot'`. The snapshot export service writes this row via `PATCH /sync/status/snapshot`. `destination_url` stored in `last_item_id`. `file_size_kb` is null (V2 addition).

---

## Database connection

- Host: localhost
- Port: 5432
- Database: athleteos
- Password: (athlete sets this when starting Docker container)
- Extensions required: timescaledb, pgvector, uuid-ossp

---

## When you hit a problem

- Build problem (syntax error, type mismatch, extension conflict) — solve it here in Claude Code
- Design problem (schema gap, missing relationship, logic conflict) — flag it, stop, report back to the design session in Claude.ai before proceeding
- If unsure which it is — flag it and ask

---

## What this system is not

- It does not replace TrainingPeaks. It augments it.
- It does not replace Garmin. It reads from it.
- It is not a generic fitness app. It is a structured coaching platform built on sports science methodology.

---

## Portability requirement

Portability means open-source GitHub distribution. Each athlete runs their own instance with their own database. No multi-tenant permission system required in V1.

All tables are scoped to `athlete_id` so the schema supports a future multi-tenant deployment without redesign, but V1 assumes one athlete per running instance. The `permission` table has been deferred — do not implement it until multi-tenancy is explicitly scoped.

---

## API Layer

API layer specification complete. athlete_os_api_spec.md contains all 48 endpoints (spec table undercounts — 51 endpoints actually implemented across the 10 route files).

---

## Data Ingestion Service ← COMPLETE

Ingestion service implemented in `ingestion/`. Node.js 24, ESM, no ORM. All writes go through the API layer.

**20 files created:**

Scaffolding: `package.json`, `.env.template`, `.gitignore`, `bulk_import_log.json`, `user_settings.json`

Source files:
- `src/api/client.js` — axios wrapper, X-API-Key auth, 3× exponential backoff on 5xx, 409 returns null
- `src/utils/sportMapper.js` — SPORT_MAP + SKIP_TYPES, `mapSport()` returns null for skipped/unmapped
- `src/utils/fieldConflict.js` — `mergeGarminStrava()`, `mergeTrainingPeaks()`, ef_source_used logic
- `src/utils/bulkImportLog.js` — JSON file I/O, `alreadyImported()` dedup guard
- `src/parsers/garminActivityParser.js` — single activity from summarizedActivities; units: duration ms→s, distance cm→m, elevation cm→m, avgSpeed ×10; end_time derived from start+duration
- `src/parsers/garminBulkParser.js` — handles `[{ summarizedActivitiesExport: [...] }]` wrapper shape
- `src/parsers/garminWellnessParser.js` — body battery HIGHEST as morning proxy; sleep s→hrs; readiness_score mapping
- `src/parsers/tpCsvParser.js` — HH:MM:SS→seconds, km→metres, skips rows without date
- `src/parsers/fitParser.js` — stub, returns [], deferred to workout stream layer
- `src/watchers/activityWatcher.js` — chokidar on watched-activities/; routes .json → parser → POST /sessions; moves to processed/ with timestamp suffix (Windows rename fix)
- `src/watchers/bulkWatcher.js` — chokidar on watched-bulk/; dedup via bulkImportLog; appends log entry
- `src/sources/stravaClient.js` — OAuth token refresh, in-memory cache, 429 rate limit wait+retry
- `src/sources/stravaSync.js` — POST /sessions first; 409→GET+PATCH additive fields; 7-day lookback default
- `src/jobs/bulkImportJob.js` — two-level folder search for DI-Connect-Fitness/Wellness; activities then wellness
- `src/jobs/scheduler.js` — reads user_settings.json; auto→cron; manual→no cron; returns task array
- `src/index.js` — entry point; athlete check; watchers always start; scheduler conditional; graceful SIGINT/SIGTERM shutdown

**Actual Garmin field names (verified against sample-data):**
- `activityType` is a plain string (not `{ typeKey: "..." }`)
- `startTimeGmt` is epoch milliseconds (not ISO string)
- Field names: `avgHr`, `maxHr`, `avgBikeCadence`, `avgRunCadence` (not camelCase longer names)
- Elevation is in centimetres (÷100 to get metres)
- `summarizedActivities.json` wraps as `[ { summarizedActivitiesExport: [...] } ]`

**Live test result:** Paarl Road Cycling (garmin_activity_id: 20723195489) ingested via file watcher → POST /sessions → DB confirmed. 68.5km, 12354s, 104W avg, 117 avg HR, TSS 107.8.

**Next layer: Coaching engine** — must be designed in Claude.ai before building here. Design should cover: methodology rule engine, period progression gate logic, session scoring (Friel + Daniels), CTL/ATL/TSB calculation, readiness score composite, and the AI coaching prompt architecture.

Coaching engine design complete. coaching-engine-design.md ready for Claude Code.
Next after coaching engine: knowledge engine design.

Knowledge engine design complete. knowledge-engine-design.md ready for Claude Code.
Next: messaging service design (final backend service before frontend).

Messaging service design complete. messaging-service-design.md ready for Claude Code.
All four backend services designed. Next: snapshot export service, then frontend.

---

## Coaching Engine ← COMPLETE

Coaching engine implemented in `coaching-engine/`. Node.js 24, ESM. All writes go through the API layer.

**20 source files across 5 modules:**

Scaffolding: `package.json`, `.env.template`, `user_settings.json`, `src/api/client.js`

**Planning layer (7 files):**
- `src/planning/loadCalculator.js` — CTL/ATL/TSB exponential moving average (CTL=42d, ATL=7d); `calculateReadiness()` composite (HRV 35%, TSB 25%, sleep 20%, wellness 10%, HR trend 10%); TP override re-anchoring
- `src/scoring/sessionScorer.js` — Friel zone scoring (zone_weight × minutes); Daniels pace zone points (E=0.2 → FR=2.0); `scoreSession()` dispatches by methodology
- `src/scoring/efCalculator.js` — EF = NP/avgHR (falls back to avg power); decoupling %; stream and lap variants
- `src/planning/ruleEngine.js` — PERIOD_RULES, INTENSITY_DIST (pure_middle/polarised), PROGRESSION_GATES, REVISION_TRIGGERS; pure constants + helper functions
- `src/planning/blockPlanner.js` — 3+1 build/recovery cycle; day layout Mon–Sat; volume scaling; recovery week = 3×AE1; dryRun mode
- `src/planning/progressionGates.js` — base→build (4 conditions), build→peak (4), peak→race (3); each returns `{passed, conditions[], failed_count, summary}`
- `src/planning/planRevision.js` — pure functions: missed sessions, low readiness, high decoupling, HRV decline, TSS deviation; severity tiers (minor/moderate/major)
- `src/planning/atpImporter.js` — TP CSV parse; period detection from titles+keywords; `importAtp()` with dryRun mode; sub-period detection (avoids "AE2" false match)

**Coach layer (6 files):**
- `src/coach/systemPrompt.js` — SYSTEM_PROMPT ~1500 tokens: Friel philosophy, 7-zone HR model, power zones, intensity distribution, KPIs, gates, communication style, boundaries
- `src/coach/contextBuilder.js` — lean (~1000 tokens, last 5 msgs), balanced (~2900, last 10 + snapshot + week + summary), full (~5000, last 20 + period + diary + knowledge); parallel fetches via Promise.all
- `src/coach/conversationSummary.js` — Haiku summarisation at every 20th message; `shouldSummarise(count)`; `logUsage()` non-critical wrapper for POST /usage/log
- `src/coach/intentClassifier.js` — slash commands (exact match, confidence 1.0); 12 keyword rules (regex); Haiku AI fallback for ambiguous; `isComplexIntent()` routes Sonnet vs Haiku
- `src/coach/coachHandler.js` — main entry point; intent→context→model selection→Anthropic call→usage log→summarisation trigger; stats preamble injection; gate preamble injection
- `src/coach/onboarding.js` — 5-stage intake: welcome, fitness_anchors, history, goals, methodology; `getCurrentStage()`, `advanceStage()`; `isOnboardingComplete()`

**Scheduled jobs (4 files):**
- `src/jobs/weeklyPlanner.js` — Monday 06:00; structured→blockPlanner direct; guided/adaptive→AI review of draft
- `src/jobs/snapshotWriter.js` — Sunday 20:30; full CTL/ATL history → readiness → anchors → POST /fitness/snapshot (nulls stripped before write)
- `src/jobs/progressionChecker.js` — Sunday 21:00; final-week gate check; passed→notify athlete; failed→log conditions + optional 1-week extension
- `src/jobs/dailyDigest.js` — daily 09:00; readiness + today's sessions → WhatsApp-format message → POST /conversations

**Entry point:** `src/index.js` — loads user_settings.json; verifies athlete record; registers 4 cron jobs; trigger poll every 30s on sync/status; graceful SIGINT/SIGTERM shutdown.

**Verified startup log:**
```
coaching engine starting
athlete: Riaan-Erik Truter
4 cron jobs registered: weekly_planner(0 6 * * 1), snapshot_writer(30 20 * * 0), progression_checker(0 21 * * 0), daily_digest(0 9 * * *)
engine_mode: structured | context_mode: balanced
coaching engine ready
```

**Schema corrections applied during coaching engine build:**
- Added `UNIQUE` constraint to `session_score.completed_session_id` (required for ON CONFLICT upsert)
- Added `conversation_summary` to `UPDATABLE_FIELDS` in `api/src/db/athlete.js`

**New API endpoints added (8 total):**
- `GET /periods/current` — returns active period including engine_mode
- `GET /fitness/ctlatl` — TSS history with TP override values
- `POST /diary/:date/score` — upserts session_score
- `GET /conversations/summary` — returns athlete.conversation_summary
- `PATCH /conversations/summary` — updates conversation summary
- `GET /usage` — usage summary with by_service/by_model breakdown
- `GET /usage/history` — paginated usage log
- `POST /usage/log` — write API usage row (used by all Anthropic calls)

**EF consistency fix applied to ingestion service:**
- `ingestion/src/parsers/garminActivityParser.js` — `ef_garmin_calculated` now uses NP when available (was avg power); consistent with `ef_trainingpeaks` which always uses NP

---

## Knowledge Engine ← COMPLETE

Knowledge engine implemented in `knowledge-engine/`. Node.js 24, ESM. All writes go through the API layer.

**Schema additions (applied before build):**
- `resource` table — 25 columns tracking metadata, note sets, ingestion status, timestamps
- `knowledge_chunk.resource_id` — FK to resource, CASCADE delete
- 5 indexes: athlete, status, GIN(topic_tags), resource on chunk

**9 new API endpoints added to `api/src/routes/knowledge.js`:**
- `POST /knowledge/resources` — create resource (201); Zod strict with SOURCE_TYPES and EVIDENCE_LEVELS enums
- `GET /knowledge/resources` — list with filters (status, source_type, sport_tag, topic_tag, limit, offset)
- `GET /knowledge/resources/:id` — single resource; 404 on soft-deleted
- `PATCH /knowledge/resources/:id` — update fields; updatable set enforced in DB function
- `DELETE /knowledge/resources/:id` — soft delete (deleted_at), 204
- `POST /knowledge/resources/:id/summary` — sets `coach_summary_requested_at`, returns 202
- `POST /knowledge/resources/:id/instruct` — sets `coach_instructions_requested_at`, returns 202
- `POST /knowledge/discover` — validates topic/sport, returns 202 stub
- `GET /knowledge/topics` — returns empty array stub (engine populates)

DB functions added to `api/src/db/knowledge.js`: createResource, getResources, getResourceById, updateResource, softDeleteResource, markSummaryRequested, markInstructionsRequested.

**16 source files across 5 modules:**

Scaffolding: `package.json`, `.env.template`, `user_settings.json`, `src/api/client.js`

**Ingestion module (5 files):**
- `src/ingestion/contentExtractor.js` — PDF (pdf-parse), URL (fetch + HTML strip), plain text; returns `{text, word_count}`
- `src/ingestion/chunker.js` — paragraph-first split, sentence fallback for oversized paragraphs, overlapping chunks; default 400 words / 50 overlap
- `src/ingestion/classifier.js` — Haiku classifies evidence level + sport/topic tags from first 600-word excerpt; JSON response; logs usage
- `src/ingestion/embedder.js` — voyage-3 via Anthropic REST; batched (default 20); null embedding on batch failure; logs usage; $0.06/M tokens
- `src/ingestion/ingestionPipeline.js` — orchestrates extract→chunk→classify→embed→store; `pollAndIngest()` for cron

**Discovery module (2 files):**
- `src/discovery/resourceFinder.js` — Sonnet with web_search tool; falls back to training-data knowledge if tool unavailable; creates resource records; `pollAndDiscover()` for cron
- `src/discovery/topicSuggester.js` — Haiku generates 3 topics from athlete context; posts coach message with suggestions; optional auto-discovery trigger

**Notes module (3 files):**
- `src/notes/usageLogger.js` — shared `logUsage()` for all Anthropic calls; POST /usage/log; non-critical (try/catch)
- `src/notes/summaryGenerator.js` — Haiku, 300-400 words, structured format; `pollAndSummarise()` for cron
- `src/notes/instructionGenerator.js` — Sonnet, 400-500 words, athlete-specific; uses current period/FTP/limiter; `pollAndInstruct()` for cron

**Search module (2 files):**
- `src/search/semanticSearch.js` — embeds query via voyage-3, falls back to API text search; ready for vector search once API supports embedding param
- `src/search/relatedFinder.js` — tag overlap + title search; filters self from results

**Entry point:** `src/index.js` — 5 cron jobs: ingestion_poller(*/2 min), summary_poller(*/5 min), instruct_poller(*/5 min), discovery_poller(*/10 min), topic_suggester(08:00 daily)

**Verified startup log:**
```
knowledge engine starting
athlete: Riaan-Erik Truter — API reachable
5 jobs registered: ingestion_poller(*/2 * * * *), summary_poller(*/5 * * * *),
  instruct_poller(*/5 * * * *), discovery_poller(*/10 * * * *), topic_suggester(0 8 * * *)
knowledge engine ready
```

---

## Messaging Service ← COMPLETE

Messaging service implemented in `messaging-service/`. Node.js 24, ESM. All writes go through the API layer.

**Providers (3):**
- `src/providers/discord.js` — Discord.js v14; single coach channel; `ready` event registers one `messageCreate` listener; attachment download to `tmp/discord-downloads/`; 2000-char split. **Tested live — single response confirmed.**
- `src/providers/whatsapp.js` — Twilio; Express webhook server on port 3002; media download with Basic auth; 1600-char split. Activated only when `TWILIO_ACCOUNT_SID` is set.
- `src/providers/webChat.js` — WebSocket server (ws); base64 file upload; `broadcast()` for proactive notifications. Always on when `web_chat.enabled` in settings.
- `src/providers/index.js` — Discord → Telegram → WhatsApp priority chain; web chat alongside; `registerSenders()` wired to notificationHandler.

**Handlers (4):**
- `src/handlers/messageHandler.js` — main router; command check → log → coaching engine poll (15s, 1.5s intervals) → log response → return string
- `src/handlers/commandHandler.js` — `/status`, `/week`, `/sync`, `/log`, `/find`, `/help`
- `src/handlers/fileHandler.js` — `.pdf` → POST /knowledge/resources; `.csv/.json/.fit` → copy to watched-activities/; unknown → ask athlete
- `src/handlers/notificationHandler.js` — `registerSenders()`, `sendNotification()`, scale check, logs to /conversations

**Notification builders (6):**
- `src/notifications/morningDigest.js` — readiness score + today's session + health notes
- `src/notifications/weeklyDigest.js` — volume %, TSS %, CTL/ATL/TSB, next week preview
- `src/notifications/recoveryAlert.js` — HRV decline detector (`detectHrvDecline()`), streak count, swap notice
- `src/notifications/milestoneAlert.js` — FTP/VDOT/CSS variants, W/kg calculation
- `src/notifications/planRevision.js` — severity icons (⚠/📋/ℹ), trigger label map
- `src/notifications/knowledgeSuggest.js` — topic-tagged suggestion, `/find` call-to-action

**Proactive scale** (1–5, set in `user_settings.json`): recovery=1, milestone=2, morning/plan=3, weekly=4, knowledge=5. Implemented in `formatting/markdown.js` `shouldSend()`.

**Cron jobs (3):** morning_digest (configurable, default 09:00), weekly_digest (Sunday 20:30), recovery_check (daily 21:00).

**API additions during messaging service build:**
- `POST /athlete` — creates athlete record; 409 if exists; `name` required; all other fields optional. Added to resolve missing athlete record on first startup.

**Bug fixed during build:**
- `discord.js` — `clientReady` → `ready` (wrong event name in discord.js v14; ready handler was never firing, `_channel` always null, all sends silently dropped). `messageCreate` listener moved inside `ready` callback with `removeAllListeners` guard.

the snapshot export service is deferred to V2

Frontend build complete. All 19 steps done.
Components: Navbar, ThemeToggle, InfoTooltip, KpiCard,
ReadinessCard, FitnessChart, SessionList, RacePrediction,
GoalProgress, HealthMetrics, DiaryPanel, UsageSummary,
SettingsPanel, ChatWidget, MorningForm, ResourceList,
ResourceCard, ResourceDetail, DiscoverPanel, Profile.
System prompt personality updated.

Build status:
1. Storage schema ✅
2. API layer ✅
3. Ingestion service ✅
4. Coaching engine ✅
5. Knowledge engine ✅
6. Messaging service ✅
7. Snapshot export service ← deferred V2
8. Frontend ✅
9. Installer script ✅

**Athlete OS V1 is complete.** All 8 active layers built and committed.
Commit: b6d226f — installer, welcome tour, README, setup guide - V1 complete
