# Athlete OS — Coaching Engine Design
**Version:** 1.0  
**Status:** Design complete — ready for Claude Code implementation  
**Language:** Node.js (matches API and ingestion layers)  
**Last updated:** 2026-03-31

---

## Overview

The coaching engine is the AI brain of Athlete OS. It has two distinct responsibilities:

1. **Planning engine** — deterministic and/or AI-assisted logic that generates and revises training plans, scores sessions, calculates fitness metrics, and manages period progression.
2. **Coach interface engine** — the WhatsApp AI coach personality that communicates with the athlete, runs onboarding, processes diary entries, answers questions, and surfaces knowledge base references.

These two responsibilities share the same service but are architecturally separate. The planning engine runs on a schedule and on triggers. The coach interface engine runs on demand when the athlete sends a message.

---

## Engine modes

Selectable per period in app settings. Stored as `engine_mode` on the `period` table and in `user_settings.json`.

| Mode | Name | Planning logic | AI involvement | API cost |
|---|---|---|---|---|
| `structured` | Structured | Pure rule engine. Friel rules applied deterministically. | None for planning. AI still used for coach chat. | Minimal |
| `guided` | Guided | Rule engine plans, AI reviews and adjusts. | Once per weekly planning cycle + significant deviations. | Moderate |
| `adaptive` | Adaptive | Rule engine provides constraints, AI makes all decisions. | Every planning cycle + daily inputs. | Higher |

Default: `structured` for base periods, `guided` for build, `adaptive` for peak and race. Athlete can override per period.

---

## Context window modes

Selectable in app settings. Stored as `context_mode` in `user_settings.json`.

| Mode | Name | Tokens per call | Contents |
|---|---|---|---|
| `lean` | Lean | ~1000 | System prompt + last 5 messages + basic athlete profile |
| `balanced` | Balanced | ~2900 | System prompt + last 10 messages + conversation summary + fitness snapshot + current week context |
| `full` | Full context | ~5000 | System prompt + last 20 messages + conversation summary + full fitness snapshot + current period detail + recent diary entries + relevant knowledge chunks |

Default: `balanced`. Athlete can switch at any time. Recommended: use `full` for race week planning and major plan decisions, `lean` for routine daily check-ins.

---

## Service folder structure

```
coaching-engine/
  src/
    planning/
      ruleEngine.js          ← deterministic Friel rules
      sessionPlanner.js      ← generates weekly/block session plans
      blockPlanner.js        ← generates full block from period definition
      planRevision.js        ← detects deviations, proposes adjustments
      progressionGates.js    ← base→build→peak readiness checks
      loadCalculator.js      ← CTL/ATL/TSB + readiness score
      atpImporter.js         ← reads TP CSV export → season/period/session structure
    coach/
      contextBuilder.js      ← assembles API call context window per mode
      systemPrompt.js        ← static system prompt definition
      conversationSummary.js ← summarises old messages into compressed history
      coachHandler.js        ← entry point for WhatsApp messages
      onboarding.js          ← progressive onboarding conversation manager
      intentClassifier.js    ← classifies incoming message intent
    scoring/
      sessionScorer.js       ← Friel zone×time and Daniels points scoring
      efCalculator.js        ← EF and decoupling calculation
    api/
      client.js              ← Athlete OS API HTTP client (shared with ingestion)
    jobs/
      weeklyPlanner.js       ← Sunday night job: plan next week
      dailyDigest.js         ← morning job: readiness check + diary prompt
      snapshotWriter.js      ← Sunday night job: write fitness_snapshot
      progressionChecker.js  ← checks period progression gates
    index.js                 ← entry point
  user_settings.json
  package.json
  .env.template
```

---

## Subsystem 1 — Training load calculator

### CTL / ATL / TSB

Calculated from TSS values in `completed_session`. Standard Coggan exponential weighted moving average:

```javascript
// Time constants
const CTL_CONSTANT = 42  // days
const ATL_CONSTANT = 7   // days

// Daily update
ctl_today = ctl_yesterday + (tss_today - ctl_yesterday) / CTL_CONSTANT
atl_today = atl_yesterday + (tss_today - atl_yesterday) / ATL_CONSTANT
tsb_today = ctl_yesterday - atl_yesterday  // form = fitness - fatigue
```

Seed values: CTL = 0, ATL = 0 on first day. The calculator processes all historical sessions in chronological order to build accurate starting values.

TP values take precedence when available (pulled from `completed_session.ctl_at_completion` etc). Our calculated values fill gaps when TP data is absent.

### Readiness score composite

Calculated daily from `daily_metrics`. Written to `daily_metrics.readiness_score`.

```javascript
function calculateReadiness(metrics) {
  const hrv = mapHrvStatus(metrics.hrv_status)      // 35% weight
  const tsb = mapTsb(metrics.tsb_current)            // 25% weight
  const sleep = metrics.sleep_score ?? 50            // 20% weight
  const wellness = (metrics.wellness_score ?? 5) * 10 // 10% weight
  const hrTrend = calcHrTrend(metrics)               // 10% weight

  return Math.round(
    hrv * 0.35 +
    tsb * 0.25 +
    sleep * 0.20 +
    wellness * 0.10 +
    hrTrend * 0.10
  )
}

// HRV status mapping
const HRV_SCORE = {
  'balanced': 100,
  'unbalanced': 60,
  'low': 30,
  'poor': 0,
  null: 50  // unknown → neutral
}

// TSB mapping
function mapTsb(tsb) {
  if (tsb > 10)  return 100
  if (tsb > 0)   return 80
  if (tsb > -10) return 60
  if (tsb > -20) return 40
  return 20
}

// Resting HR trend (3-day): rising = penalty
function calcHrTrend(metrics) {
  // compares today vs 3-day avg
  // rising > 5bpm → 30, rising 2-5bpm → 60, stable → 80, falling → 100
}
```

---

## Subsystem 2 — Session scorer

### Friel / Triathlon Bible scoring

Zone value × minutes in zone. Zone values: Z1=1, Z2=2, Z3=3, Z4=4, Z5=5.

```javascript
function calcFrielScore(zoneDistribution) {
  const weights = { Z1: 1, Z2: 2, Z3: 3, Z4: 4, Z5a: 5, Z5b: 5, Z5c: 5 }
  return Object.entries(zoneDistribution).reduce((sum, [zone, minutes]) => {
    return sum + (weights[zone] ?? 0) * minutes
  }, 0)
}
```

### Daniels points (running only)

Points per minute by pace zone:

```javascript
const DANIELS_POINTS = { E: 0.2, M: 0.4, T: 0.6, '10K': 0.8, I: 1.0, R: 1.5, FR: 2.0 }
```

Applied to running sessions where pace zone data is available. Requires GPS pace data from the activity stream.

### EF and decoupling

```javascript
// Efficiency Factor
ef = normalized_power_w / avg_hr

// Aerobic decoupling
// Compare EF of first half vs second half of session
decoupling_pct = ((ef_first_half - ef_second_half) / ef_first_half) * 100
```

Both written to `completed_session` by the scorer after each session is imported.

---

## Subsystem 3 — Rule engine (Structured mode)

The deterministic core. Encodes Friel's methodology rules as executable logic. No AI involved.

### Period rules

```javascript
const PERIOD_RULES = {
  preparation: {
    intensity_dist: 'general',
    progression: 'frequency',
    strength_phase: 'AA_MT',
    session_types: ['AE1', 'AE2', 'SS1', 'SS2'],
    weekly_easy_hard: '4:3',
    cross_training_ok: true
  },
  base: {
    intensity_dist: 'pure_middle',  // 70% Z1-Z2, 30% Z3-Z4
    progression: 'duration',
    strength_phase: 'MS_to_SM',
    session_types: ['AE1', 'AE2', 'MF1', 'MF2', 'SS1', 'SS2', 'ST1'],
    weekly_easy_hard: '4:3',
    anchor_sessions: ['AE2'],       // must include each week
    breakthrough_sessions: ['MF2']  // high priority
  },
  build: {
    intensity_dist: 'polarised',    // 80% Z1-Z2, 20% Z5
    progression: 'intensity',
    strength_phase: 'SM',
    session_types: ['AE1', 'AE2', 'ME1', 'ME2', 'AC1', 'AC2', 'SP2'],
    weekly_easy_hard: '5:2',
    limiter_focus: true             // prioritise athlete's identified limiter
  },
  peak: {
    intensity_dist: 'polarised',
    progression: 'taper',
    strength_phase: 'SM',
    volume_factor: 0.7,             // 70% of base3 volume
    session_types: ['AE1', 'AE2', 'AC1', 'SP1'],
    weekly_easy_hard: '5:2'
  },
  race: {
    intensity_dist: 'polarised',
    volume_factor: 0.5,
    session_types: ['AE1', 'AE2', 'AC2'],
    strength_phase: 'none'
  },
  transition: {
    intensity_dist: 'general',
    volume_factor: 0.2,
    session_types: ['AE1'],
    strength_phase: 'none'
  }
}
```

### Load progression rules

```javascript
const LOAD_PROGRESSION = {
  build_weeks: 3,
  recovery_weeks: 1,
  week_multipliers: [1.0, 1.1, 1.2, 0.65],  // weeks 1-3 build, week 4 recovery
  peak_vol_vs_base3: 0.7,
  race_vol_vs_base3: 0.5
}
```

---

## Subsystem 4 — Block planner

Generates a full training block (3-4 weeks) from a period definition. Called when a new period starts or when the ATP is imported.

### Block generation flow

```
1. Read period definition (type, dates, planned_weekly_hrs, methodology)
2. Apply PERIOD_RULES for this period type
3. Calculate per-week volume using LOAD_PROGRESSION multipliers
4. For each week:
   a. Determine easy:hard ratio
   b. Select session types based on period rules + athlete limiter
   c. Assign sessions to days (anchor sessions on fixed days, hard sessions 
      separated by at least one easy day)
   d. Scale session durations to hit weekly volume target
   e. Calculate target TSS per session
5. Write all planned_session records via API
6. Return block summary for coach review
```

### Day assignment rules

```javascript
// Hard sessions cannot be on consecutive days
// Anchor sessions (AE2 long ride) always on Saturday or Sunday
// Gym sessions separated by 2+ days
// Race week: hard session on Tuesday, easy the rest
```

### Block template then weekly scaling

Same session types each week. Duration and intensity scale week-to-week using the multipliers. This gives the athlete predictable structure while progressively overloading.

```
Week 1: AE2 (90min), MF2 (60min), AE1 (45min) × 2, SS1 (30min)
Week 2: AE2 (100min), MF2 (60min), AE1 (45min) × 2, SS1 (30min)  ← volume up 10%
Week 3: AE2 (110min), MF2 (70min), AE1 (50min) × 2, SS1 (30min)  ← volume up 10%
Week 4: AE2 (60min), AE1 (40min) × 2  ← recovery, 65% of peak week
```

---

## Subsystem 5 — Plan revision engine

Runs daily after diary entry is processed and after each sync. Compares actual vs planned and decides whether to act.

### Deviation detection

```javascript
// Triggers that prompt revision check
const REVISION_TRIGGERS = {
  missed_sessions: 2,           // 2+ missed sessions in a week
  readiness_score_low: 50,      // below 50 for 3 consecutive days
  decoupling_high: 7,           // decoupling > 7% on long ride (base period)
  hrv_declining_days: 4,        // HRV declining for 4+ days
  tss_deficit_pct: 25,          // actual TSS more than 25% below planned
  tss_excess_pct: 30            // actual TSS more than 30% above planned
}
```

### Revision actions (in order of severity)

```javascript
// Minor — engine acts autonomously, notifies athlete
'swap_session'      // replace hard session with easy session
'reduce_duration'   // shorten upcoming sessions by 15-20%
'move_session'      // shift session to different day within the week

// Moderate — engine proposes, athlete confirms
'extend_recovery'   // add extra recovery day
'reduce_week_load'  // reduce entire week by 20-30%
'delay_progression' // extend current period by 1 week

// Major — engine flags, recommends TP update
'extend_base'       // base period needs more time before build
'reduce_season_load' // overall plan too ambitious
'revise_arace_goal' // event goal may not be achievable at current trajectory
```

### Revision message format

When the engine proposes a revision, the coach sends a WhatsApp message:

```
"Your readiness score has been below 50 for 3 days (current: 42). 
I've swapped Thursday's threshold session for an easy AE1 ride. 
Your body is telling you it needs more recovery this week. 
The planned session will reschedule to next week."
```

Major revisions prompt a question: "Would you like me to adjust the plan?"

---

## Subsystem 6 — Period progression gates

Checks whether the athlete is ready to advance from one period to the next. Runs in the final week of each period.

```javascript
const PROGRESSION_GATES = {
  'base_to_build': {
    decoupling_pct_max: 5,          // long Z2 ride decoupling < 5%
    ef_trend: 'positive',           // EF improving over last 4 weeks
    weeks_minimum: 10,              // at least 10 weeks in base
    readiness_avg_min: 60           // average readiness > 60 in final week
  },
  'build_to_peak': {
    field_test_completed: true,     // FTP re-test done
    limiter_sessions_completed: 4,  // at least 4 limiter-focused sessions
    tsb_trend: 'recovering',        // TSB moving toward positive
    readiness_avg_min: 65
  },
  'peak_to_race': {
    tsb_positive: true,             // TSB > 0
    volume_at_target: true,         // week volume hit 0.7 × base3
    no_fatigue_flags: true          // no readiness < 50 in last 5 days
  }
}
```

If gates are not met, the engine extends the current period by one week and notifies the athlete. If gates are still not met after one extension, it proposes a major plan revision.

---

## Subsystem 7 — ATP importer

Reads the TrainingPeaks workout summary CSV and builds the full season structure.

### Import flow

```
1. Read CSV file (already parsed by tpCsvParser.js in ingestion service)
2. Detect period boundaries from workout types and titles
3. Create season record if none exists
4. Create period records from detected boundaries
5. Create planned_session records for all TP workouts
6. Map TP workout types to session_type_id using title and workout type fields
7. Store tp_workout_id on each planned_session for future matching
8. Return import summary: seasons created, periods created, sessions created
```

### Period detection from TP data

TP does not export period names explicitly. The importer detects them from:
- Workout titles containing "Base", "Build", "Peak", "Race", "Prep"
- Gaps in the schedule (transition periods)
- Workout intensity patterns (pure middle vs polarised distribution)

If detection is ambiguous, the engine prompts the athlete via coach chat: "I imported your TP plan. I detected 3 periods but I'm not sure about the dates. Can you confirm?"

---

## Subsystem 8 — AI coaching layer

### System prompt

The static personality and knowledge base sent with every AI API call. Approximately 1500 tokens.

```
You are an AI sports coach built on Joe Friel's training methodology. 
You coach endurance athletes across cycling, running, swimming, and triathlon.

Your coaching philosophy:
- Aerobic base is the foundation of all endurance performance
- Training should be periodised: preparation → base → build → peak → race → transition
- Most training (70-80%) should be done at low intensity (Z1-Z2)
- The athlete's limiter determines the focus of the build period
- Recovery is where adaptation happens — never skip it
- Every session has a goal; every goal serves the block objective

Your methodology reference:
- Joe Friel: Triathlon Training Bible, High Performance Cyclist
- Seiler: polarised training for build and peak periods
- Daniels: VDOT pace zones for running
You always acknowledge the source of your recommendations and encourage 
the athlete to read Friel's books for deeper understanding.

Your communication style:
- Direct and honest — if training is going poorly, say so clearly
- Encouraging but not sycophantic — praise real achievements, not effort alone
- Concise — WhatsApp messages, not essays
- Ask one question at a time
- When unsure, say so and explain your reasoning

Your boundaries:
- You do not diagnose injuries or medical conditions
- For pain or injury, always recommend seeing a professional
- You do not override the athlete's explicit preferences without asking
- You flag major plan changes before making them
```

### Context builder

Assembles the context window for each AI call based on `context_mode`.

```javascript
async function buildContext(athleteId, mode, conversationHistory) {
  const base = {
    system: SYSTEM_PROMPT,
    messages: []
  }

  // Always included
  const athlete = await api.get('/athlete')
  const snapshot = await api.get('/fitness/snapshot')

  if (mode === 'lean') {
    base.messages = [
      { role: 'system', content: buildLeanContext(athlete, snapshot) },
      ...conversationHistory.slice(-5)
    ]
  }

  if (mode === 'balanced') {
    const currentWeek = await api.get('/weeks/current')
    const summary = await getConversationSummary(athleteId)
    base.messages = [
      { role: 'system', content: buildBalancedContext(athlete, snapshot, currentWeek, summary) },
      ...conversationHistory.slice(-10)
    ]
  }

  if (mode === 'full') {
    const currentWeek = await api.get('/weeks/current')
    const period = await api.get('/periods/current')
    const diary = await api.get('/diary?limit=7')
    const summary = await getConversationSummary(athleteId)
    base.messages = [
      { role: 'system', content: buildFullContext(athlete, snapshot, currentWeek, period, diary, summary) },
      ...conversationHistory.slice(-20)
    ]
  }

  return base
}
```

### Conversation summary

Every 20 messages, the engine runs a summarisation call:

```javascript
async function updateConversationSummary(athleteId) {
  const messages = await api.get('/conversations?limit=20')
  const prompt = `Summarise this coaching conversation in 200 words or less. 
    Focus on: training decisions made, athlete's physical and mental state, 
    goals discussed, any concerns flagged. Be factual and concise.`
  
  const summary = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',  // cheap summarisation
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt + JSON.stringify(messages) }]
  })
  
  // Store summary in athlete record or dedicated field
  await api.patch('/athlete', { conversation_summary: summary })
}
```

### Intent classifier

Classifies incoming messages before routing to the correct handler:

```javascript
const INTENTS = {
  'diary'       : 'athlete reflecting on a session or day',
  'question'    : 'athlete asking about training, methodology, or science',
  'planning'    : 'athlete asking about upcoming sessions or the plan',
  'feedback'    : 'athlete responding to a coach suggestion',
  'health'      : 'athlete reporting how they feel',
  'onboarding'  : 'athlete answering an onboarding question',
  'knowledge'   : 'athlete asking about sports science concepts'
}
```

`knowledge` intent triggers a vector search on `knowledge_chunk` before the AI call, injecting the top 3 relevant chunks into the context.

### Model selection

```javascript
// Use Haiku for simple, routine interactions — cheap and fast
const HAIKU_INTENTS = ['diary', 'health', 'feedback', 'onboarding']

// Use Sonnet for complex reasoning and planning
const SONNET_INTENTS = ['question', 'planning', 'knowledge']
```

---

## Subsystem 9 — Onboarding manager

Manages the progressive 7-day onboarding conversation. Tracks stage via `athlete.onboarding_stage`.

### Stage definitions

```javascript
const ONBOARDING_STAGES = {
  'not_started': {
    day: 1,
    questions: ['name', 'primary_sport', 'active_sports', 'target_event', 'event_date'],
    opening_message: `Welcome to Athlete OS. I'm your AI coach, built on Joe Friel's 
      training methodology from the Triathlon Training Bible and High Performance Cyclist. 
      I recommend picking up those books — they'll help you understand the reasoning 
      behind everything I recommend. Let's start simply. What's your name, and what 
      sport are you primarily training for right now?`
  },
  'profile': {
    day: 2,
    questions: ['available_hrs_weekday', 'available_hrs_weekend', 'has_power_meter', 
                'has_indoor_trainer', 'has_pool_access', 'peak_weekly_hrs']
  },
  'history': {
    day: 3,
    questions: ['training_years_per_sport', 'recent_field_tests', 'known_injuries']
  },
  'physical': {
    day: 4,
    intro: `Now I'd like to understand your strengths and limiters. I use Friel's 
      six training abilities framework. I'll explain each one and ask you to rate 
      yourself 1-5. Be honest — this determines what we focus on in training.`,
    questions: ['ability_ratings_per_sport']  // 6 abilities × active sports
  },
  'mindset': {
    day: 6,
    intro: `Last part of your profile — Friel's mindset assessment. 30 quick questions 
      across 5 areas: motivation, confidence, focus, self-talk, and patience. 
      These shape how I communicate with you and where we focus mental training.`,
    questions: ['mindset_survey']  // 30 questions, grouped by category
  },
  'complete': {
    action: 'generate_first_season_structure'
  }
}
```

### Onboarding completion

When `onboarding_stage = 'complete'` the engine:
1. Calculates ability ratings and identifies primary limiter per sport
2. Calculates mindset scores and identifies mindset limiters
3. Updates `athlete` record with all derived fields
4. If TP ATP has been imported: links it to the season structure
5. If no ATP: proposes a season structure based on event date and current state
6. Sends summary message: "Profile complete. Here's what I know about you and what we'll focus on..."

---

## Scheduled jobs

| Job | Schedule | What it does |
|---|---|---|
| `weeklyPlanner` | Sunday 20:00 | Generates next week's planned sessions using current engine mode |
| `snapshotWriter` | Sunday 20:30 | Calculates CTL/ATL/TSB + readiness, writes `fitness_snapshot` |
| `progressionChecker` | Sunday 21:00 | Checks period progression gates in final week of each period |
| `dailyDigest` | Configured time (default 09:00) | Sends morning readiness summary + session reminder to WhatsApp |
| `conversationSummariser` | On trigger (every 20 messages) | Updates compressed conversation summary |

All schedules configurable in `user_settings.json`. All jobs can be triggered manually via `POST /sync/trigger`.

---

## Schema additions required

Before building, run these migrations:

```sql
-- Add engine_mode to period table
ALTER TABLE period ADD COLUMN engine_mode TEXT DEFAULT 'structured';

-- Add conversation_summary to athlete table  
ALTER TABLE athlete ADD COLUMN conversation_summary TEXT;

-- Add context_mode to user_settings (handled in user_settings.json, not DB)

-- Add current period helper view
CREATE VIEW current_period AS
  SELECT * FROM period
  WHERE athlete_id = (SELECT id FROM athlete LIMIT 1)
  AND start_date <= CURRENT_DATE
  AND end_date >= CURRENT_DATE
  LIMIT 1;
```

Add new API endpoints needed by the coaching engine:

```
GET  /periods/current          ← current active period
GET  /fitness/ctlatl           ← CTL/ATL/TSB history for calculator seeding
POST /diary/:date/score        ← write session score to completed_session
GET  /conversations/summary    ← get current conversation summary
PATCH /conversations/summary   ← update conversation summary
```

---

## Build order for Claude Code

Implement in this order:

1. **Migrations** — run schema additions above
2. **New API endpoints** — add the 5 endpoints listed above to the API layer
3. **Scaffolding** — package.json, folder structure, api/client.js (copy from ingestion)
4. **Load calculator** — CTL/ATL/TSB + readiness score. Test against real data from sample-data.
5. **Session scorer** — Friel score + EF + decoupling. Test against imported sessions.
6. **Rule engine** — PERIOD_RULES + LOAD_PROGRESSION constants. Unit testable.
7. **Block planner** — generates planned_session records for a full block. Test end to end.
8. **Progression gates** — checks and returns pass/fail + reason.
9. **Plan revision engine** — deviation detection + revision actions.
10. **ATP importer** — reads TP CSV, creates season/period/session structure.
11. **Context builder** — three modes, assembles context window.
12. **System prompt** — static prompt definition.
13. **Conversation summariser** — Haiku call, updates athlete record.
14. **Intent classifier** — routes messages to correct handler.
15. **Coach handler** — main entry point for WhatsApp messages.
16. **Onboarding manager** — progressive stage tracking.
17. **Scheduled jobs** — node-cron, reads user_settings.json.
18. **Index.js** — entry point, starts all jobs.

---

## Opening prompt for Claude Code

```
Read CLAUDE.md then read coaching-engine-design.md.

Before writing any code, run these migrations on the athleteos database:

ALTER TABLE period ADD COLUMN engine_mode TEXT DEFAULT 'structured';
ALTER TABLE athlete ADD COLUMN conversation_summary TEXT;

CREATE VIEW current_period AS
  SELECT * FROM period
  WHERE athlete_id = (SELECT id FROM athlete LIMIT 1)
  AND start_date <= CURRENT_DATE
  AND end_date >= CURRENT_DATE
  LIMIT 1;

Then add these 5 endpoints to the existing API layer (api/src/routes/):
- GET /periods/current
- GET /fitness/ctlatl
- POST /diary/:date/score
- GET /conversations/summary
- PATCH /conversations/summary

Confirm migrations and new endpoints are working, then begin the 
coaching engine scaffolding. Start with package.json and folder 
structure. Show me the structure before creating any files.
```

---

## Cost estimates

Based on typical daily usage (5 messages per day, 1 weekly planning cycle):

| Scenario | Daily tokens | Monthly cost (est.) |
|---|---|---|
| Lean mode, Structured engine | ~5,000 | < $0.50 |
| Balanced mode, Guided engine | ~15,000 | ~$1.50 |
| Full mode, Adaptive engine | ~30,000 | ~$3.00 |
| Race week (full/adaptive) | ~50,000 | ~$5.00/week |

All estimates using Haiku for routine calls, Sonnet for planning. Actual cost depends on usage frequency.

---

*End of coaching engine design. Ready for Claude Code implementation.*
