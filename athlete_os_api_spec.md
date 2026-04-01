# Athlete OS — API Layer Specification
**Version:** 1.0  
**Status:** Design complete — ready for Claude Code implementation  
**Style:** REST  
**Runtime:** Node.js + Express  
**Last updated:** 2026-03-30

---

## Overview

The API layer is the single interface between all consumers and the database. Nothing touches the database directly except through this API.

**Consumers:**
- Athlete dashboard (local web app, PC)
- Knowledge browser (local web app, PC)
- Coach interface (WhatsApp — via messaging service)
- Data ingestion service (scheduled, PC)
- Coaching engine (triggered, PC)
- Knowledge engine (triggered, PC)
- Snapshot export service (triggered after each sync, pushes static file)

**Not a consumer:**
- Mobile — mobile only loads the static snapshot. It never calls this API.

---

## Base URL

```
http://localhost:3000/api/v1
```

All routes are prefixed with `/api/v1`. Version prefix allows future breaking changes without disrupting existing clients.

---

## Authentication

All endpoints require an API key passed in the request header:

```
X-API-Key: <key>
```

The API key is a static string defined in the `.env` config file at setup time. All local services read it from the same config. No key rotation, no OAuth, no sessions — this is a single-user local system.

**Dashboard PIN protection** is handled at the frontend layer, not the API layer. The API trusts any request with a valid API key. The dashboard UI enforces the PIN before making API calls. This keeps the API stateless and simple.

**Exception:** the `/health` endpoint requires no authentication. Used by the installer and monitoring scripts.

---

## Error format

All errors return a consistent shape:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Athlete not found",
    "field": null
  }
}
```

**Standard error codes:**

| Code | HTTP status | Meaning |
|---|---|---|
| UNAUTHORIZED | 401 | Missing or invalid API key |
| NOT_FOUND | 404 | Resource does not exist |
| VALIDATION_ERROR | 422 | Request body failed validation |
| CONFLICT | 409 | Duplicate record (e.g. duplicate garmin_activity_id) |
| INTERNAL_ERROR | 500 | Unexpected server error |

---

## Pagination

All list endpoints that can return multiple records support pagination:

```
GET /sessions?page=1&limit=20
```

Response envelope for paginated endpoints:

```json
{
  "data": [...],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 143,
    "pages": 8
  }
}
```

Default limit: 20. Maximum limit: 100.

---

## Endpoint Groups

1. System
2. Athlete
3. Zone model
4. Season and planning
5. Sessions
6. Fitness and testing
7. Diary and coaching
8. Knowledge
9. Ingestion and sync
10. Snapshot export

---

## 1. System

### `GET /health`
Returns API and database status. No auth required. Used by installer and monitoring.

**Response 200:**
```json
{
  "status": "ok",
  "version": "1.0.0",
  "database": "connected",
  "extensions": {
    "timescaledb": "2.26.0",
    "pgvector": "0.8.2"
  },
  "timestamp": "2026-03-30T08:00:00Z"
}
```

---

### `GET /config`
Returns non-sensitive system configuration — active methodology, connected data sources, sync status summary.

**Response 200:**
```json
{
  "athlete_id": "uuid",
  "active_methodology": "Friel",
  "connected_sources": ["garmin", "trainingpeaks", "strava"],
  "last_sync": {
    "garmin_activities": "2026-03-30T06:00:00Z",
    "garmin_health": "2026-03-30T06:05:00Z",
    "trainingpeaks": "2026-03-30T06:10:00Z",
    "strava": "2026-03-30T06:12:00Z"
  }
}
```

---

## 2. Athlete

### `GET /athlete`
Returns the athlete profile. Single-athlete system — no ID parameter needed.

**Response 200:**
```json
{
  "id": "uuid",
  "name": "Riaan",
  "email": "riaan@example.com",
  "primary_sport": "mtb",
  "active_sports": ["mtb", "cycling", "running", "swimming"],
  "active_methodology": {
    "id": "uuid",
    "name": "Friel"
  },
  "ftp_watts": 280,
  "fthr_cycling": 168,
  "fthr_running": 172,
  "css_per_100m_sec": 98.5,
  "vdot": 48.2,
  "weight_kg": 75.0,
  "limiter": "aerobic endurance",
  "strengths": "muscular force, threshold power",
  "timezone": "Africa/Johannesburg"
}
```

---

### `PATCH /athlete`
Updates athlete profile fields. Partial update — only send fields that are changing.

**Request body:**
```json
{
  "ftp_watts": 285,
  "weight_kg": 74.5,
  "limiter": "stamina"
}
```

**Response 200:** Updated athlete object (same shape as GET).

---

## 3. Zone Model

### `GET /zones`
Returns the currently active zone model for all sports.

**Response 200:**
```json
{
  "cycling": {
    "anchor_metric": "ftp_watts",
    "anchor_value": 280,
    "effective_from": "2026-01-15",
    "zones": [
      {"zone": "Z1", "label": "Recovery", "min_pct": 0, "max_pct": 55, "min_value": 0, "max_value": 154, "unit": "watts"},
      {"zone": "Z2", "label": "Aerobic endurance", "min_pct": 56, "max_pct": 75, "min_value": 157, "max_value": 210, "unit": "watts"},
      {"zone": "Z3", "label": "Tempo", "min_pct": 76, "max_pct": 90, "min_value": 213, "max_value": 252, "unit": "watts"},
      {"zone": "Z4", "label": "Sub-threshold", "min_pct": 91, "max_pct": 105, "min_value": 255, "max_value": 294, "unit": "watts"},
      {"zone": "Z5a", "label": "Threshold", "min_pct": 106, "max_pct": 120, "min_value": 297, "max_value": 336, "unit": "watts"},
      {"zone": "Z5b", "label": "Aerobic capacity", "min_pct": 121, "max_pct": 150, "min_value": 339, "max_value": 420, "unit": "watts"},
      {"zone": "Z5c", "label": "Sprint", "min_pct": 151, "max_pct": null, "min_value": 423, "max_value": null, "unit": "watts"}
    ]
  },
  "running": {
    "anchor_metric": "vdot",
    "anchor_value": 48.2,
    "pace_zones": [
      {"zone": "E", "label": "Easy", "min_pace_sec_km": 330, "max_pace_sec_km": 390},
      {"zone": "M", "label": "Marathon", "min_pace_sec_km": 285, "max_pace_sec_km": 310},
      {"zone": "T", "label": "Threshold", "min_pace_sec_km": 258, "max_pace_sec_km": 270},
      {"zone": "I", "label": "Interval", "min_pace_sec_km": 234, "max_pace_sec_km": 246},
      {"zone": "R", "label": "Repetition", "min_pace_sec_km": 210, "max_pace_sec_km": 222}
    ]
  },
  "swimming": {
    "anchor_metric": "css_per_100m_sec",
    "anchor_value": 98.5,
    "pace_zones": [
      {"zone": "Z1", "label": "Recovery", "pace_per_100m": "1:50+"},
      {"zone": "Z2", "label": "Aerobic endurance", "pace_per_100m": "1:44-1:50"},
      {"zone": "Z3", "label": "Tempo", "pace_per_100m": "1:38-1:44"},
      {"zone": "Z4", "label": "Threshold", "pace_per_100m": "1:32-1:38"},
      {"zone": "Z5a", "label": "Aerobic capacity", "pace_per_100m": "1:26-1:32"},
      {"zone": "Z5b", "label": "Max", "pace_per_100m": "<1:26"}
    ]
  }
}
```

---

### `POST /zones/recalculate`
Triggers zone recalculation from latest field test results. Called by coaching engine after a test is logged.

**Request body:**
```json
{
  "sport": "cycling"
}
```

**Response 200:**
```json
{
  "message": "Zones recalculated",
  "new_anchor_value": 285,
  "effective_from": "2026-03-30"
}
```

---

## 4. Season and Planning

### `GET /season`
Returns the current active season with all periods and weeks.

**Response 200:**
```json
{
  "id": "uuid",
  "name": "2026 MTB Season",
  "year": 2026,
  "start_date": "2026-01-01",
  "end_date": "2026-12-31",
  "primary_goal": "Complete Transbaviaans 8 August",
  "periods": [
    {
      "id": "uuid",
      "name": "Base 1",
      "period_type": "base",
      "start_date": "2026-01-05",
      "end_date": "2026-02-01",
      "status": "complete",
      "planned_weekly_hrs": 10,
      "strength_phase": "MS"
    }
  ]
}
```

---

### `POST /season`
Creates a new season.

**Request body:**
```json
{
  "name": "2026 MTB Season",
  "year": 2026,
  "start_date": "2026-01-01",
  "end_date": "2026-12-31",
  "primary_goal": "Complete Transbaviaans 8 August"
}
```

**Response 201:** Created season object.

---

### `GET /goals`
Returns all goals, optionally filtered by status or type.

**Query params:** `?status=active`, `?type=a_race`

**Response 200:**
```json
{
  "data": [
    {
      "id": "uuid",
      "type": "a_race",
      "priority": "A",
      "title": "Transbaviaans 2026",
      "event_date": "2026-08-08",
      "event_distance": "230km",
      "event_sport": "mtb",
      "target_metric": "finish",
      "status": "active"
    }
  ]
}
```

---

### `POST /goals`
Creates a new goal.

**Request body:**
```json
{
  "season_id": "uuid",
  "type": "a_race",
  "priority": "A",
  "title": "Transbaviaans 2026",
  "event_date": "2026-08-08",
  "event_name": "Transbaviaans",
  "event_distance": "230km",
  "event_sport": "mtb",
  "target_metric": "finish"
}
```

**Response 201:** Created goal object.

---

### `PATCH /goals/:id`
Updates a goal. Appends to revision_log automatically with timestamp and previous value.

**Request body:** Any goal fields to update.

**Response 200:** Updated goal object.

---

### `GET /periods`
Returns all periods for the current season.

**Response 200:** Array of period objects.

---

### `POST /periods`
Creates a new training period.

**Request body:**
```json
{
  "season_id": "uuid",
  "name": "Build 1",
  "period_type": "build",
  "start_date": "2026-04-01",
  "end_date": "2026-04-28",
  "objective": "Increase FTP and race-specific stamina",
  "intensity_dist_type": "polarised",
  "planned_weekly_hrs": 12,
  "strength_phase": "SM"
}
```

**Response 201:** Created period object.

---

### `GET /periods/:id/weeks`
Returns all weeks within a period with planned vs actual volume.

**Response 200:** Array of week objects with compliance data.

---

### `GET /weeks/current`
Returns the current week with all planned sessions and their status.

**Response 200:**
```json
{
  "id": "uuid",
  "week_number": 14,
  "start_date": "2026-03-30",
  "end_date": "2026-04-05",
  "week_type": "build",
  "planned_volume_hrs": 11.5,
  "actual_volume_hrs": 4.0,
  "planned_tss": 380,
  "actual_tss": 142,
  "compliance_pct": 34.8,
  "sessions": [
    {
      "id": "uuid",
      "scheduled_date": "2026-03-30",
      "sport": "cycling",
      "title": "AE2 — Aerobic threshold ride",
      "target_zone": "Z2",
      "target_duration_min": 90,
      "status": "completed",
      "priority": "anchor"
    }
  ]
}
```

---

## 5. Sessions

### `GET /sessions`
Returns completed sessions. Supports filtering and pagination.

**Query params:** `?sport=cycling`, `?from=2026-01-01`, `?to=2026-03-30`, `?page=1&limit=20`

**Response 200:** Paginated array of completed session summaries.

---

### `GET /sessions/:id`
Returns a single completed session with full detail including zone distribution and scores.

**Response 200:**
```json
{
  "id": "uuid",
  "activity_date": "2026-03-29",
  "sport": "cycling",
  "title": "Morning ride",
  "duration_sec": 5400,
  "distance_m": 48200,
  "avg_power_w": 198,
  "normalized_power_w": 212,
  "avg_hr": 142,
  "tss": 98,
  "intensity_factor_tp": 0.757,
  "ef_garmin_calculated": 1.493,
  "ef_trainingpeaks": 1.501,
  "ef_source_used": "trainingpeaks",
  "decoupling_pct": 3.2,
  "zone_distribution": {
    "Z1": 8, "Z2": 52, "Z3": 18, "Z4": 7, "Z5a": 5, "Z5b": 0, "Z5c": 0
  },
  "score": {
    "tss": 98,
    "friel_score": 312,
    "daniels_points": null
  },
  "goal_achieved": true,
  "planned_session": {
    "title": "AE2 — Aerobic threshold ride",
    "target_zone": "Z2",
    "target_duration_min": 90
  }
}
```

---

### `POST /sessions`
Creates a completed session record. Called by the ingestion service after pulling from Garmin.

**Request body:** Full completed_session fields from schema.

**Response 201:** Created session object.

**Conflict 409:** Returned if `garmin_activity_id` already exists.

---

### `PATCH /sessions/:id`
Updates a completed session. Used by ingestion service to add TrainingPeaks or Strava fields after initial Garmin sync.

**Request body:** Only the fields being updated (e.g. TrainingPeaks fields on second pass).

**Response 200:** Updated session object.

---

### `GET /sessions/:id/stream`
Returns the raw workout stream for a session. Used by dashboard for power/HR charts.

**Query params:** `?resolution=10` (return every Nth data point — reduces payload for charting)

**Response 200:**
```json
{
  "garmin_activity_id": "abc123",
  "points": [
    {"time": "2026-03-29T06:00:00Z", "power_w": 195, "hr_bpm": 138, "cadence_rpm": 88},
    {"time": "2026-03-29T06:00:10Z", "power_w": 202, "hr_bpm": 139, "cadence_rpm": 89}
  ]
}
```

---

### `GET /sessions/planned`
Returns all planned sessions, optionally filtered by date range or status.

**Query params:** `?from=2026-03-30&to=2026-04-05`, `?status=scheduled`

**Response 200:** Array of planned session objects.

---

### `POST /sessions/planned`
Creates a planned session. Called by coaching engine when building a training week.

**Request body:**
```json
{
  "week_id": "uuid",
  "session_type_id": "uuid",
  "scheduled_date": "2026-04-01",
  "sport": "cycling",
  "title": "AE2 — Aerobic threshold ride",
  "goal": "Build aerobic base, target EF improvement",
  "block_objective_link": "Develop Z2 aerobic base before build phase",
  "target_zone": "Z2",
  "target_duration_min": 120,
  "target_tss": 85,
  "priority": "anchor"
}
```

**Response 201:** Created planned session object.

---

## 6. Fitness and Testing

### `GET /fitness/snapshot`
Returns the most recent fitness snapshot — the primary KPI summary for the dashboard.

**Response 200:**
```json
{
  "snapshot_date": "2026-03-29",
  "ctl": 68.4,
  "atl": 72.1,
  "tsb": -3.7,
  "ftp_current": 280,
  "w_per_kg": 3.73,
  "vdot_current": 48.2,
  "css_current_sec": 98.5,
  "ef_7day_avg": 1.487,
  "ef_trend": "improving",
  "decoupling_last_long": 3.2,
  "resting_hr_avg": 48,
  "hrv_7day_avg": 62.4,
  "readiness_score": 74,
  "weekly_volume_hrs": 9.5,
  "weekly_tss": 342,
  "ytd_volume_hrs": 187.5
}
```

---

### `GET /fitness/snapshots`
Returns historical fitness snapshots for charting CTL/ATL/TSB trends.

**Query params:** `?from=2026-01-01&to=2026-03-30`

**Response 200:** Array of snapshot objects ordered by date.

---

### `POST /fitness/snapshot`
Creates a new weekly fitness snapshot. Called by ingestion service every Sunday night.

**Request body:** Full fitness_snapshot fields.

**Response 201:** Created snapshot object.

---

### `GET /fitness/tests`
Returns all field tests ordered by date descending.

**Query params:** `?sport=cycling`, `?type=T1_ftp_fthr`

**Response 200:** Array of field test objects.

---

### `POST /fitness/tests`
Logs a field test result. Triggers zone recalculation if FTP, VDOT, or CSS changed.

**Request body:**
```json
{
  "test_date": "2026-03-28",
  "test_type": "T1_ftp_fthr",
  "sport": "cycling",
  "methodology_id": "uuid",
  "avg_power_20min": 295,
  "avg_hr_20min": 171,
  "ftp_watts": 280,
  "fthr_bpm": 162,
  "garmin_activity_id": "abc123"
}
```

**Response 201:** Created field test. Includes `zones_updated: true` if zones were recalculated.

---

### `GET /fitness/labs`
Returns all lab results ordered by date descending.

**Response 200:** Array of lab result objects.

---

### `POST /fitness/labs`
Uploads a lab result. Accepts structured data and optional file reference.

**Request body:**
```json
{
  "test_date": "2026-03-01",
  "test_type": "blood_panel",
  "performed_by": "Sports Science Lab JHB",
  "report_file_url": "/uploads/lab_2026_03_01.pdf",
  "structured_data": {
    "ferritin_ug_l": 42,
    "haemoglobin_g_dl": 14.8,
    "vitamin_d_nmol_l": 68
  },
  "notes": "Ferritin low — add supplementation"
}
```

**Response 201:** Created lab result object.

---

### `GET /health/daily`
Returns daily health metrics from Garmin. Used by dashboard recovery section.

**Query params:** `?from=2026-03-23&to=2026-03-30`

**Response 200:**
```json
{
  "data": [
    {
      "date": "2026-03-30",
      "hrv_nightly_avg": 64.2,
      "hrv_status": "balanced",
      "resting_hr": 47,
      "body_battery_morning": 82,
      "sleep_duration_hrs": 7.8,
      "sleep_score": 78,
      "sleep_deep_hrs": 1.4,
      "sleep_rem_hrs": 1.9,
      "spo2_avg": 97.2,
      "stress_avg": 28,
      "readiness_score": 81
    }
  ]
}
```

---

### `POST /health/daily`
Writes a daily health metrics record. Called by Garmin health sync job.

**Request body:** Full daily_metrics fields.

**Response 201:** Created daily metrics record.

---

## 7. Diary and Coaching

### `GET /diary`
Returns diary entries ordered by date descending.

**Query params:** `?from=2026-03-01&to=2026-03-30`, `?page=1&limit=7`

**Response 200:** Paginated array of diary entry objects.

---

### `GET /diary/:date`
Returns the diary entry for a specific date (format: YYYY-MM-DD).

**Response 200:** Single diary entry with linked session data.

---

### `POST /diary`
Creates or updates a diary entry for a date. Upsert — one entry per day.

**Request body:**
```json
{
  "entry_date": "2026-03-30",
  "completed_session_id": "uuid",
  "rpe_overall": 6.5,
  "wellness_score": 7,
  "sleep_quality": 8,
  "motivation_score": 8,
  "soreness_score": 4,
  "stress_life": 3,
  "session_reflection": "Held Z2 well for the first 90 minutes. HR drifted slightly in final 20.",
  "daily_notes": "Legs felt good. Weather was perfect."
}
```

**Response 200/201:** Diary entry object with coach_summary populated if coaching engine has processed it.

---

### `PATCH /diary/:date/coach`
Updates the coach-generated fields on a diary entry. Called by coaching engine after processing.

**Request body:**
```json
{
  "coach_summary": "Good aerobic session. EF improved 2.1% vs 8-week comparison. Decoupling at 3.2% — approaching base→build readiness threshold of 5%.",
  "coach_flags": ["ef_improving", "approaching_build_readiness"],
  "coach_recommendations": "Continue Z2 focus this week. Schedule T1 FTP test for end of next week."
}
```

**Response 200:** Updated diary entry.

---

### `GET /conversations`
Returns conversation history for coaching context. Used by coaching engine to maintain context window.

**Query params:** `?limit=20` (returns most recent N messages)

**Response 200:** Array of conversation messages ordered by timestamp descending.

---

### `POST /conversations`
Appends a message to conversation history. Called by messaging service when athlete or coach sends a message.

**Request body:**
```json
{
  "role": "athlete",
  "content": "Legs are heavy today, should I still do the threshold session?",
  "message_ts": "2026-03-30T07:15:00Z",
  "channel": "whatsapp",
  "intent": "question",
  "linked_session_id": null
}
```

**Response 201:** Created conversation record.

---

### `GET /notifications`
Returns notification log. Used by dashboard to show recent alerts.

**Query params:** `?limit=10`, `?unread=true`

**Response 200:** Array of notification records.

---

## 8. Knowledge

### `GET /knowledge/search`
Semantic search across the knowledge base. Returns relevant chunks ordered by relevance.

**Query params:** `?q=aerobic+decoupling+base+period&limit=5&sport=cycling`

**Response 200:**
```json
{
  "query": "aerobic decoupling base period",
  "results": [
    {
      "id": "uuid",
      "source_title": "High-Performance Cyclist",
      "source_author": "Joe Friel",
      "page_ref": "p.142",
      "evidence_level": "practitioner_consensus",
      "sport_tags": ["cycling"],
      "topic_tags": ["aerobic_endurance", "efficiency_factor", "base_period"],
      "content": "After finishing this workout and while briefly analysing its data, determine your efficiency factor (EF) for the ride...",
      "relevance_score": 0.924
    }
  ]
}
```

---

### `POST /knowledge/ingest`
Ingests a new document into the knowledge base. Chunks, embeds, and indexes it. Long-running — returns a job ID.

**Request body:**
```json
{
  "source_title": "Triathlon Training Bible",
  "source_author": "Joe Friel",
  "source_type": "book",
  "evidence_level": "practitioner_consensus",
  "sport_tags": ["triathlon", "cycling", "running", "swimming"],
  "content": "<full document text>"
}
```

**Response 202:**
```json
{
  "job_id": "uuid",
  "status": "processing",
  "message": "Document queued for chunking and embedding"
}
```

---

### `GET /knowledge/ingest/:job_id`
Returns the status of an ingestion job.

**Response 200:**
```json
{
  "job_id": "uuid",
  "status": "complete",
  "chunks_created": 142,
  "completed_at": "2026-03-30T08:05:00Z"
}
```

---

### `GET /knowledge/sources`
Returns all ingested source documents with chunk counts.

**Response 200:**
```json
{
  "data": [
    {
      "source_title": "High-Performance Cyclist",
      "source_author": "Joe Friel",
      "source_type": "book",
      "chunks": 186,
      "ingested_at": "2026-03-15T10:00:00Z"
    }
  ]
}
```

---

### `GET /knowledge/annotations`
Returns all athlete annotations on knowledge chunks.

**Response 200:** Array of annotation objects with chunk content included.

---

### `POST /knowledge/annotations`
Creates an annotation on a knowledge chunk.

**Request body:**
```json
{
  "knowledge_chunk_id": "uuid",
  "highlight": "EF is your power (usually normalized power) for the ride divided by your average heart rate",
  "note": "Key metric to track weekly during base period",
  "tags": ["ef", "base_period", "kpi"]
}
```

**Response 201:** Created annotation object.

---

## 9. Ingestion and Sync

### `GET /sync/status`
Returns sync state for all data sources.

**Response 200:**
```json
{
  "sources": [
    {
      "source": "garmin_activities",
      "last_synced_at": "2026-03-30T06:00:00Z",
      "sync_status": "success",
      "error_count": 0
    },
    {
      "source": "garmin_health",
      "last_synced_at": "2026-03-30T06:05:00Z",
      "sync_status": "success",
      "error_count": 0
    },
    {
      "source": "trainingpeaks",
      "last_synced_at": "2026-03-30T06:10:00Z",
      "sync_status": "success",
      "error_count": 0
    },
    {
      "source": "strava",
      "last_synced_at": "2026-03-30T06:12:00Z",
      "sync_status": "success",
      "error_count": 0
    }
  ]
}
```

---

### `POST /sync/trigger`
Manually triggers a sync for one or all sources. Used by dashboard manual sync button.

**Request body:**
```json
{
  "source": "garmin_activities"
}
```

Or trigger all:
```json
{
  "source": "all"
}
```

**Response 202:**
```json
{
  "message": "Sync triggered",
  "source": "garmin_activities",
  "job_id": "uuid"
}
```

---

### `PATCH /sync/status/:source`
Updates sync state after a sync job completes. Called internally by ingestion service.

**Request body:**
```json
{
  "last_synced_at": "2026-03-30T06:00:00Z",
  "last_item_id": "garmin_activity_12345",
  "sync_status": "success",
  "error_message": null,
  "next_sync_at": "2026-03-31T06:00:00Z"
}
```

**Response 200:** Updated sync state object.

---

### `GET /methodologies`
Returns all available methodologies. Used by onboarding and athlete profile.

**Response 200:**
```json
{
  "data": [
    {
      "id": "uuid",
      "name": "Friel",
      "sport_scope": ["cycling", "triathlon", "mtb"],
      "description": "Base/build/peak/race periodisation with 7-zone HR and power model",
      "evidence_level": "practitioner_consensus"
    }
  ]
}
```

---

### `GET /session-types`
Returns all session types, optionally filtered by sport or methodology.

**Query params:** `?sport=cycling`, `?methodology_id=uuid`, `?ability=aerobic_endurance`

**Response 200:** Array of session type objects.

---

## 10. Snapshot Export

### `POST /snapshot/generate`
Generates a static dashboard snapshot and pushes it to the configured hosting destination. Called by the export service after each sync cycle.

**Request body:**
```json
{
  "destination": "github_pages",
  "include_sections": ["fitness", "sessions", "goals", "health", "diary"]
}
```

**Response 202:**
```json
{
  "job_id": "uuid",
  "status": "generating",
  "destination": "github_pages",
  "message": "Snapshot generation started"
}
```

---

### `GET /snapshot/status`
Returns status of the most recent snapshot generation.

**Response 200:**
```json
{
  "last_generated_at": "2026-03-30T06:15:00Z",
  "status": "success",
  "destination_url": "https://riaanmtb.github.io/athlete-os-dashboard",
  "file_size_kb": 84
}
```

---

## Summary

### Endpoint count

| Group | Endpoints |
|---|---|
| System | 2 |
| Athlete | 2 |
| Zone model | 2 |
| Season and planning | 8 |
| Sessions | 6 |
| Fitness and testing | 8 |
| Diary and coaching | 7 |
| Knowledge | 6 |
| Ingestion and sync | 5 |
| Snapshot export | 2 |
| **Total** | **48** |

---

### Service-to-endpoint mapping

| Service | Reads from | Writes to |
|---|---|---|
| Data ingestion | /sync/status | /sessions (POST, PATCH), /health/daily, /fitness/snapshot, /sync/status (PATCH) |
| Coaching engine | /athlete, /zones, /fitness/snapshot, /sessions, /diary, /conversations, /weeks/current | /sessions/planned, /diary (PATCH coach), /conversations, /notifications, /zones/recalculate |
| Knowledge engine | /knowledge/sources | /knowledge/ingest |
| Messaging service | /conversations, /diary, /sessions, /fitness/snapshot, /knowledge/search | /conversations, /diary |
| Snapshot export | /fitness/snapshot, /sessions, /goals, /health/daily, /diary | /snapshot/status (PATCH) |
| Dashboard (frontend) | All GET endpoints | /diary (POST), /fitness/labs (POST), /sync/trigger (POST), /goals (PATCH) |

---

### Implementation notes for Claude Code

- Use Express.js with express-router — one router file per endpoint group
- Use `pg` (node-postgres) for all database queries — no ORM
- Validate all request bodies with `zod` before touching the database
- All database queries in a `/db` directory — one file per table group
- Environment variables in `.env`: `API_KEY`, `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_PASSWORD`, `ANTHROPIC_API_KEY`, `SNAPSHOT_DESTINATION`
- Logging with `pino` — structured JSON logs, one line per request
- No test framework required for V1 — but each route file should include a comment block describing what to manually verify after implementation

---

*End of API specification. Ready for Claude Code implementation.*
