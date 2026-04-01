# Athlete OS — Data Ingestion Service Design
**Version:** 1.0  
**Status:** Design complete — ready for Claude Code implementation  
**Language:** Node.js (matches API layer)  
**Last updated:** 2026-03-30

---

## Overview

The ingestion service is responsible for getting data from all external sources into the Athlete OS database. It runs on the same PC as the API and database. It never exposes a public interface — it reads files and calls the Strava API, then writes to the local Athlete OS API.

All database writes go through the API layer, not directly to the database. The ingestion service is a consumer of the API, same as the dashboard.

---

## Data sources

| Source | Method | Trigger | Primary tables written |
|---|---|---|---|
| Garmin activity export (individual) | File watcher on `watched-activities/` | File drop or manual | `completed_session`, `workout_stream`, `lap_summary` |
| Garmin bulk export (monthly) | File watcher on `watched-bulk/` | Manual after file drop | Full backfill — all activity and health tables |
| TrainingPeaks workout summary CSV | File watcher on `watched-activities/` | File drop or manual | `planned_session` |
| Strava API | HTTP client + OAuth | Scheduled or manual | Additive fields on `completed_session` |
| Morning health form | Dashboard form POST | Daily at configured time | `daily_metrics` |
| WhatsApp health fallback | Parsed coach message | On message | `daily_metrics` |

---

## Folder structure

```
AthleteOS/
  watched-activities/        ← individual Garmin activity JSON/FIT + TP CSV exports
    processed/               ← moved here after successful processing
  watched-bulk/              ← monthly Garmin full account export (unzipped folder)
    processed/               ← moved here after successful bulk import
  ingestion/                 ← ingestion service source code
  sample-data/               ← Garmin export sample for development and testing
```

---

## Field conflict resolution

When two sources provide a value for the same field, this rule applies:

1. Garmin value exists → use Garmin, mark `data_source_primary = 'garmin'`
2. Garmin value is null, Strava value exists → use Strava, mark `data_source_primary = 'strava'`
3. Both null → field remains null

`ef_garmin_calculated` is only ever populated from Garmin data.
`strava_suffer_score`, `strava_relative_effort`, `segment_prs` are only ever populated from Strava.
TSS, CTL, ATL, TSB, IF, EF, VI come from TrainingPeaks fields on `completed_session` — populated when TP CSV includes them.

---

## Source 1 — Garmin individual activity export

### What Garmin exports

Garmin Connect allows export of individual activities as JSON from the activity page. The DI_CONNECT folder structure from the full account export reveals the JSON schema used. Relevant subfolders:

- `DI-Connect-Fitness` — activity summaries (distance, duration, HR, power, cadence, elevation)
- `DI-Connect-Wellness` — sleep, HRV, body battery, stress, SpO2
- `DI-Connect-Metrics` — performance metrics
- `DI-ATP` — annual training plan data

### File detection

The ingestion service uses `chokidar` (Node.js file watcher) to monitor `watched-activities/` for new files. On detection:

1. Identify file type by extension and content: `.fit`, `.json`, `.csv`
2. Route to the correct parser
3. Process and write via API
4. Move file to `watched-activities/processed/` on success
5. Move file to `watched-activities/failed/` on error with a log entry

### Activity JSON parser

Reads Garmin activity JSON export. Extracts:

```javascript
// Fields extracted from Garmin activity JSON
{
  garmin_activity_id,      // from activityId field
  activity_date,           // from startTimeLocal
  start_time,              // from startTimeGMT
  end_time,                // derived: startTimeGMT + duration
  sport,                   // mapped from activityType.typeKey
  duration_sec,            // from duration
  distance_m,              // from distance
  elevation_gain_m,        // from elevationGain
  avg_power_w,             // from averagePower (nullable)
  normalized_power_w,      // from normPower (nullable)
  avg_hr,                  // from averageHR
  max_hr,                  // from maxHR
  avg_cadence,             // from averageBikingCadenceInRevPerMin or averageRunningCadenceInStepsPerMin
  avg_speed_ms,            // from averageSpeed
  variability_index,       // calculated: normPower / averagePower if both exist
  left_power_pct,          // from avgLeftPowerPhase (Assioma)
  right_power_pct,         // from avgRightPowerPhase (Assioma)
}
```

### Workout stream from activity JSON

Garmin activity JSON exports may include a `activityDetailMetrics` array with time-series data. If present, each entry is written to `workout_stream`. If not present (summary-only export), `workout_stream` is not populated until the bulk import.

### Sport mapping

Garmin uses its own activity type keys. Map to Athlete OS sport values:

```javascript
const SPORT_MAP = {
  'cycling': 'cycling',
  'mountain_biking': 'mtb',
  'gravel_cycling': 'cycling',
  'road_biking': 'cycling',
  'time_trialing': 'cycling',
  'running': 'running',
  'trail_running': 'running',
  'open_water_swimming': 'swimming',
  'lap_swimming': 'swimming',
  'strength_training': 'strength',
  'triathlon': 'triathlon',
  // add as needed based on sample-data scan
}
```

### Deduplication

Before calling `POST /sessions`, check `GET /sessions?garmin_activity_id=xxx`. If 409 CONFLICT returned, skip. If 200 with no match, insert.

---

## Source 2 — Garmin bulk export (monthly)

### Structure

The full Garmin account export is a folder with ~36 subfolders. Claude Code will scan `sample-data/` on first run to map the exact JSON schema. Key folders expected:

- `DI_CONNECT/DI-Connect-Fitness/` — all activity summaries as JSON files
- `DI_CONNECT/DI-Connect-Wellness/` — sleep, HRV, body battery per day
- `DI_CONNECT/DI-Connect-Metrics/` — performance and fitness metrics

The `garmin_merged` JSON file in `sample-data/` (31MB) is a pre-merged version created during a previous attempt. Claude Code should inspect this file first to understand the full field set before parsing the individual folder structure.

### Processing flow

1. Athlete drops the unzipped Garmin export folder into `watched-bulk/`
2. Ingestion service detects a new folder in `watched-bulk/`
3. Service checks `bulk_import_log` (a JSON file in `ingestion/`) for the folder name — if already processed, skip
4. Service scans the folder structure and identifies JSON files
5. Processes activities first, then wellness/health data
6. Writes a summary to `bulk_import_log`: folder name, timestamp, counts (processed, skipped, failed)
7. Moves folder to `watched-bulk/processed/`
8. Dashboard displays: "Bulk import complete — X activities processed, Y new, Z skipped (already in DB). Safe to delete watched-bulk/processed/"

### Garmin values take precedence

When a bulk import encounters a `garmin_activity_id` that already exists in `completed_session` (from a prior Strava sync):

- Do not skip — update the record
- Overwrite all fields where the Garmin value is not null
- Set `data_source_primary = 'garmin'`
- Calculate and store `ef_garmin_calculated = normalized_power / avg_hr`
- Write `workout_stream` rows if time-series data is available

---

## Source 3 — TrainingPeaks workout summary CSV

### What TP exports

The workout summary CSV contains both planned and completed workouts. Fields include:

```
Date, Title, Workout Type, Description, Planned Duration, Actual Duration,
Planned TSS, Actual TSS, Compliance %, Notes, Workout ID
```

### Processing flow

1. Athlete exports workout summary CSV from TP and drops into `watched-activities/`
2. File watcher detects `.csv` file
3. Parser reads each row
4. For completed workouts: match to existing `completed_session` by `date + sport + start_time`, update `tp_workout_id` and TSS fields
5. For planned workouts: upsert into `planned_session` by `tp_workout_id` — update if exists, insert if new
6. Move file to `watched-activities/processed/`

### CSV parser fields

```javascript
// Mapped from TP workout summary CSV
{
  tp_workout_id,           // from Workout ID column
  scheduled_date,          // from Date column
  sport,                   // mapped from Workout Type
  title,                   // from Title
  description,             // from Description
  target_duration_min,     // from Planned Duration
  target_tss,              // from Planned TSS
  actual_tss,              // from Actual TSS (completed only)
  compliance_score_tp,     // from Compliance %
  notes,                   // from Notes
}
```

---

## Source 4 — Strava API

### Authentication

OAuth 2.0. One-time setup during installer flow:

1. Athlete creates a Strava API application at strava.com/settings/api (free)
2. Installer opens browser to Strava OAuth consent page
3. Athlete authorises Athlete OS
4. Access token and refresh token stored in `.env` (never in database)
5. Ingestion service refreshes token automatically before expiry

Strava is optional — if `STRAVA_CLIENT_ID` is not set in `.env`, the Strava sync job is skipped silently.

### What Strava provides

```javascript
// Fields from Strava activity API
{
  strava_activity_id,       // from id
  name,                     // activity title
  start_date,               // ISO timestamp
  elapsed_time,             // seconds
  distance,                 // metres
  average_watts,            // nullable
  average_heartrate,        // nullable
  max_heartrate,            // nullable
  total_elevation_gain,     // metres
  suffer_score,             // Strava proprietary
  relative_effort,          // Strava proprietary
  segment_efforts,          // array — extract PRs
}
```

### Matching to completed_session

Match order:
1. If `strava_activity_id` already stored → skip (already synced)
2. Match by `activity_date + sport + start_time` within 60-second tolerance
3. If no match found → create new `completed_session` record with Strava as source

### Schedule

Configurable in `user_settings.json`. Default: daily at 06:00 if auto mode selected.

---

## Source 5 — Morning health form

### Form fields

The morning check-in form lives in the local dashboard. WhatsApp sends a nudge message at the configured time with a link. The form has:

**Mandatory (Tier 1):**
- HRV nightly (number — athlete reads from Garmin app)
- Resting HR (number — athlete reads from Garmin app or watch)
- Sleep duration (decimal hours — e.g. 7.5)
- Wellness score (slider 1-10)

**Optional (Tier 2):**
- Sleep quality (slider 1-10)
- Soreness score (slider 1-10)
- Motivation score (slider 1-10)
- Life stress score (slider 1-10)

**Submit** calls `POST /health/daily` with the form data. The form pre-fills today's date. If a record already exists for today, the form shows current values and allows update.

### WhatsApp fallback

If the athlete types health data into the coach chat instead of using the form, the messaging service parses natural language:

```
"slept 7.5 hours, HR 48, HRV 62, feeling 7/10"
```

The coaching engine extracts structured fields and calls `POST /health/daily`. This is a fallback only — the form is the primary path.

---

## Sync scheduling

### Configuration

Stored in `ingestion/user_settings.json`:

```json
{
  "strava": {
    "mode": "auto",
    "time": "06:00"
  },
  "health_form_nudge": {
    "mode": "auto",
    "time": "09:00"
  },
  "file_watcher": {
    "mode": "auto",
    "watched_activities_path": "../watched-activities",
    "watched_bulk_path": "../watched-bulk"
  }
}
```

`mode` is `"auto"` or `"manual"`. In manual mode, the scheduler is disabled for that source and sync only runs on explicit trigger via the dashboard or coach chat command.

### Scheduler

Uses `node-cron`. On startup:

1. Read `user_settings.json`
2. For each source in auto mode, register a cron job at the configured time
3. File watchers start regardless of mode — they only trigger when a file appears, so they are always safe to run

### Manual trigger

`POST /sync/trigger` with `{ "source": "strava" }` runs the sync immediately regardless of schedule. Dashboard has a "Sync now" button per source.

---

## Ingestion service folder structure

```
ingestion/
  src/
    watchers/
      activityWatcher.js     ← chokidar watcher for watched-activities/
      bulkWatcher.js         ← chokidar watcher for watched-bulk/
    parsers/
      garminActivityParser.js   ← parses individual Garmin JSON exports
      garminBulkParser.js       ← parses full Garmin account export structure
      garminWellnessParser.js   ← parses DI-Connect-Wellness JSON files
      tpCsvParser.js            ← parses TrainingPeaks workout summary CSV
      fitParser.js              ← parses FIT binary files (if encountered)
    sources/
      stravaClient.js           ← Strava OAuth + API calls
      stravaSync.js             ← Strava sync job logic
    jobs/
      scheduler.js              ← node-cron job registration
      bulkImportJob.js          ← orchestrates full bulk import
    api/
      client.js                 ← HTTP client for Athlete OS API calls
    utils/
      sportMapper.js            ← Garmin activity type → Athlete OS sport
      fieldConflict.js          ← Garmin vs Strava field resolution logic
      bulkImportLog.js          ← reads/writes bulk_import_log.json
    index.js                    ← entry point, starts watchers and scheduler
  bulk_import_log.json          ← tracks processed bulk exports
  user_settings.json            ← sync schedule configuration
  package.json
  .env.template
```

---

## Athlete onboarding (first run)

On first run, the ingestion service checks if an athlete record exists via `GET /athlete`. If 404:

1. Service pauses all sync jobs
2. Logs: "No athlete profile found. Complete setup before syncing."
3. Dashboard shows onboarding flow: enter name, email, primary sport, active methodology
4. On submit, `POST /athlete` (or `PATCH /athlete`) creates the record
5. Service resumes

This prevents processing files before there is an athlete to assign them to.

---

## Error handling

| Error | Behaviour |
|---|---|
| File parse error | Move file to `failed/`, write error to log, continue processing other files |
| API 409 CONFLICT | Skip silently — record already exists |
| API 404 (no athlete) | Pause all jobs, trigger onboarding |
| API 500 | Retry 3 times with exponential backoff, then move file to `failed/` |
| Strava token expired | Auto-refresh token, retry request once |
| Strava rate limit (429) | Wait until rate limit window resets, then retry |
| Bulk import interrupted | On restart, re-scan bulk folder — deduplication prevents double-writes |

---

## Build order for Claude Code

Implement in this order:

1. **Setup and scaffolding** — `package.json`, folder structure, `.env.template`, `api/client.js`
2. **Sample data scan** — Claude Code reads `sample-data/` and `garmin_merged` JSON to map the full Garmin field schema before writing any parsers
3. **Sport mapper and field conflict utils**
4. **Garmin activity JSON parser** — single activity, writes to `completed_session`
5. **File watcher for `watched-activities/`** — detects new files, routes to correct parser
6. **TP CSV parser** — writes to `planned_session`
7. **Garmin wellness parser** — writes to `daily_metrics`
8. **Garmin bulk import** — full account export processing
9. **Strava client + sync job**
10. **Scheduler** — node-cron, reads `user_settings.json`
11. **Onboarding check** — first-run athlete detection

Test each step with real data from `sample-data/` before moving to the next.

---

## Opening prompt for Claude Code

```
Read CLAUDE.md then read ingestion-service-design.md.

Before writing any code, scan the sample-data folder and the garmin_merged JSON file. 
Map the following:
1. Which fields in garmin_merged correspond to which completed_session fields in the schema
2. What the DI-Connect-Fitness folder structure looks like and what fields the activity JSON files contain
3. What the DI-Connect-Wellness folder contains and which fields map to daily_metrics

Produce a field mapping table for each. Wait for confirmation before writing any parser code.
```

---

## Notes for future versions

- FIT binary file support (`fit-file-parser` npm library) — add if athletes encounter FIT-only exports
- Garmin Health API integration — if Garmin opens a stable public API, replace the folder-based wellness import
- TrainingPeaks API — if partner access is granted, replace CSV import with API sync
- Apple Health / Whoop / Oura integration — add as additional wellness data sources following the same folder-watcher pattern

---

*End of ingestion service design. Ready for Claude Code implementation.*
