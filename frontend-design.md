# Athlete OS — Frontend Design
**Version:** 1.0  
**Status:** Design complete — ready for Claude Code implementation  
**Stack:** React + Vite + Tailwind CSS  
**Last updated:** 2026-04-01

---

## Overview

The frontend is a local web application running on the athlete's PC, accessible via browser at `http://localhost:5173` (development) or `http://localhost:4173` (production build). It is the primary visual interface for the athlete — the dashboard, knowledge browser, settings, and web chat all live here.

It communicates exclusively with the Athlete OS API on port 3000. No direct database access.

---

## Tech stack

| Component | Technology | Reason |
|---|---|---|
| Framework | React 18 + Vite | Fast dev server, simple build, no framework overhead |
| Styling | Tailwind CSS | Utility-first, dark/light mode trivial, consistent spacing |
| Charts | Recharts | React-native, good time-series support, customisable |
| Icons | Lucide React | Clean, consistent, tree-shakeable |
| HTTP client | Axios | Already used across all services |
| State | React Context + useState | No Redux needed for a single-user app |
| Routing | React Router v6 | Simple page navigation |
| WebSocket | Native browser WebSocket | Web chat connection to messaging service |

---

## Application structure

```
frontend/
  src/
    pages/
      Dashboard.jsx        ← main athlete dashboard
      Knowledge.jsx        ← knowledge browser
      Profile.jsx          ← athlete profile and fitness anchors
    components/
      dashboard/
        KpiCard.jsx        ← individual KPI metric card
        FitnessChart.jsx   ← CTL/ATL/TSB trend chart
        SessionList.jsx    ← this week's sessions with status
        GoalProgress.jsx   ← goal cards with countdown
        RacePrediction.jsx ← prediction widget with tooltip
        ReadinessCard.jsx  ← daily readiness summary
        HealthMetrics.jsx  ← HRV, sleep, body battery
        UsageSummary.jsx   ← API cost tracker widget
      knowledge/
        ResourceList.jsx   ← library list view
        ResourceCard.jsx   ← individual resource card
        ResourceDetail.jsx ← full resource view with note tabs
        DiscoverPanel.jsx  ← paths A, B, C ingestion interface
        EvidenceBadge.jsx  ← evidence level indicator
        StatusBadge.jsx    ← queued/in_progress/done/for_revision
      shared/
        Navbar.jsx         ← top navigation bar
        SettingsPanel.jsx  ← slide-out settings panel
        ChatWidget.jsx     ← floating chat button + window
        ThemeToggle.jsx    ← light/dark mode toggle
        InfoTooltip.jsx    ← hover tooltip with assumptions
        MorningForm.jsx    ← daily health check-in form
    hooks/
      useApi.js            ← API call wrapper with loading/error
      useTheme.js          ← dark/light mode state
      useChat.js           ← WebSocket connection management
    context/
      AthleteContext.jsx   ← athlete profile, zones, snapshot
      ThemeContext.jsx     ← theme preference
    utils/
      formatters.js        ← number, date, duration formatting
      predictions.js       ← race prediction calculations
      chartHelpers.js      ← chart data transformation
    App.jsx                ← router, context providers
    main.jsx               ← entry point
  index.html
  tailwind.config.js
  vite.config.js
  package.json
```

---

## Theme system

Light and dark mode toggled via the navbar. Preference persisted in localStorage.

```javascript
// tailwind.config.js
module.exports = {
  darkMode: 'class',  // toggle via class on <html>
  theme: {
    extend: {
      colors: {
        // Brand accent — used for progress rings, highlights
        accent: {
          DEFAULT: '#3B82F6',  // blue-500
          dark: '#60A5FA'      // blue-400 (brighter in dark mode)
        }
      }
    }
  }
}
```

**Light mode:** white background, gray-50 surfaces, gray-900 text, blue accent
**Dark mode:** gray-900 background, gray-800 surfaces, gray-100 text, blue-400 accent

---

## Navigation

Top navbar with four items:

```
[Athlete OS logo]   Dashboard   Knowledge   Profile   [⚙ Settings]  [🌙 Theme]
```

- Logo links to Dashboard
- Settings opens the slide-out panel
- Theme toggle switches light/dark
- Active page indicated by underline accent

Mobile: navbar collapses to a hamburger menu at < 768px breakpoint.

---

## Page 1 — Dashboard

The hero page. Opened a few times per week. Immediate executive summary of training state.

### Layout (desktop — two column grid)

```
┌─────────────────────────────────────────────────────────────────────┐
│  NAVBAR                                                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌──────────┐  │
│  │  READINESS  │  │     CTL     │  │     TSB     │  │  FTP     │  │
│  │    81/100   │  │    68.4     │  │    -3.7     │  │  280W    │  │
│  │  ▲ Good     │  │  ▲ +2.8    │  │  ▼ Fatigue  │  │  3.73W/kg│  │
│  └─────────────┘  └─────────────┘  └─────────────┘  └──────────┘  │
│                                                                     │
│  ┌───────────────────────────────────┐  ┌───────────────────────┐  │
│  │  FITNESS TREND (CTL/ATL/TSB)      │  │  THIS WEEK            │  │
│  │  [12-week line chart]             │  │  ✅ Mon AE1 45min     │  │
│  │                                   │  │  ✅ Tue ME1 75min     │  │
│  │                                   │  │  ⏳ Thu AE2 ← today  │  │
│  │                                   │  │  ○ Sat AC1 90min      │  │
│  └───────────────────────────────────┘  │  ○ Sun AE1 45min      │  │
│                                         │  Vol: 4.0/11.5hrs     │  │
│                                         └───────────────────────┘  │
│                                                                     │
│  ┌───────────────────────────────────┐  ┌───────────────────────┐  │
│  │  RACE PREDICTION                  │  │  HEALTH & RECOVERY    │  │
│  │  Transbaviaans — 8 Aug 2026       │  │  HRV: 64ms ▲          │  │
│  │  Current fitness:  15–19 hrs  [ℹ] │  │  Sleep: 7.8hrs / 78  │  │
│  │  If plan continues: 11–14 hrs [ℹ] │  │  Body battery: 82    │  │
│  │  ████████░░░░  127 days to go     │  │  Stress: 28 (low)    │  │
│  └───────────────────────────────────┘  └───────────────────────┘  │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  GOALS                                                        │  │
│  │  [A] Transbaviaans 2026  ████████░░  127 days  8 Aug 2026    │  │
│  │  [B] FTP 300W            ██████░░░░  280/300W  ongoing       │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌─────────────────────────────┐  ┌───────────────────────────┐    │
│  │  RECENT DIARY               │  │  API USAGE                │    │
│  │  Today — Coach summary...   │  │  This month: $1.87        │    │
│  │  Yesterday — ...            │  │  Predicted: ~$2.40/mo     │    │
│  │  2 days ago — ...           │  │  [breakdown bar chart]    │    │
│  └─────────────────────────────┘  └───────────────────────────┘    │
│                                                                     │
└──────────────────────────────[💬 Chat]──────────────────────────────┘
```

### KPI cards

Four cards in a row. Each card shows:
- Metric name
- Current value (large, bold)
- Delta from last week (arrow + number)
- Status label (colour coded)

Status colour coding:
- Green — positive / on track
- Amber — caution / watch
- Red — concern / action needed
- Blue — neutral / informational

Cards: Readiness, CTL, TSB, FTP (or VDOT for running-focused weeks)

### Fitness trend chart

12-week rolling chart. Three lines:
- CTL (blue) — fitness
- ATL (orange) — fatigue
- TSB (green) — form

X axis: weeks. Y axis: training load units.
Hover tooltip shows exact values per week.
Period markers shown as vertical dashed lines (Base 1, Build 1, etc.)
Current week highlighted.

### This week panel

Session list for the current week. Each session shows:
- Status icon: ✅ completed, ⏳ today, ○ upcoming, ❌ missed
- Day abbreviation
- Session type and duration
- Today's session highlighted with accent colour

Bottom: volume progress bar (actual / planned hours) and compliance %.

### Race prediction widget

```
RACE PREDICTION
Transbaviaans — 8 Aug 2026

Current fitness      If plan continues
  15–19 hours    →     11–14 hours    [ℹ]
  (moderate conf.)      (high conf.)

████████████░░░░░░░░  127 days remaining
```

The [ℹ] icon on hover shows a tooltip:

```
Prediction assumptions:
• Event: 230km, 2,540m elevation
• Current CTL: 68.4
• Current FTP: 280W (3.73 W/kg at 75kg)
• Course demands: ~65-75% FTP sustained

To improve accuracy, add:
• Weight (currently using 75kg estimate)
• Recent long ride data (>3hrs)
• Previous event history

Prediction model: Friel endurance performance 
estimation. Not a guarantee — individual response 
to race conditions varies significantly.
```

### Goals section

One card per goal. Shows:
- Priority badge (A / B / C)
- Goal title
- Progress bar
- Days to event or current vs target value
- Status colour

### Health and recovery panel

Five metrics in a compact grid:
- HRV with 7-day trend sparkline
- Sleep duration and score
- Body battery (morning value)
- Resting HR with 7-day trend
- Daily stress score

Each metric shows a small trend arrow (up/down/stable) based on 7-day comparison.

### Recent diary panel

Last 3 diary entries. Each shows:
- Date
- Coach summary (truncated to 2 lines)
- Click to expand full entry

### API usage widget

Compact cost summary:
- This month spend
- Predicted monthly
- Small horizontal bar chart showing spend by call type (coach messages, summaries, discovery)

---

## Race prediction calculation

Implemented in `src/utils/predictions.js`.

### Current fitness prediction

```javascript
function predictRaceTime(ctl, ftpWatts, weightKg, event) {
  const wPerKg = ftpWatts / weightKg
  
  // Endurance performance index — simplified Friel model
  // Based on sustained power fraction at event duration
  const eventDurationHrs = estimateBaseDuration(event)  // from event demands
  const sustainableFraction = getSustainableFraction(eventDurationHrs)
  const sustainableWatts = ftpWatts * sustainableFraction
  
  // CTL modifier — higher fitness = better pacing and recovery
  const ctlModifier = Math.min(1.0, ctl / 80)  // 80 CTL = full potential
  
  // Terrain modifier — climbing cost
  const climbingCost = event.elevation_m * 0.000083  // hrs per metre climbed
  
  const baseTime = event.distance_km / (sustainableWatts * ctlModifier * 0.015)
  const totalTime = baseTime + climbingCost
  
  // Confidence based on data quality
  const confidence = calculateConfidence({ ctl, ftpWatts, weightKg, hasLongRideData })
  
  return {
    low_hrs: totalTime * 0.92,
    high_hrs: totalTime * 1.12,
    confidence,  // 'low' | 'moderate' | 'high'
    assumptions: buildAssumptions({ ctl, ftpWatts, weightKg })
  }
}
```

### Plan continuation prediction

Projects CTL forward using planned TSS, then applies the same model:

```javascript
function projectCtl(currentCtl, plannedSessions, daysToRace) {
  let ctl = currentCtl
  for (const session of plannedSessions) {
    ctl = ctl + (session.target_tss - ctl) / 42
  }
  return ctl
}
```

---

## Page 2 — Knowledge browser

Separate page. Visited occasionally for focused reading and research sessions.

### Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│  NAVBAR                                                             │
├──────────────┬──────────────────────────────────────────────────────┤
│              │                                                      │
│  FILTERS     │  [+ Add Resource]  [🔍 Find Resources]  [💡 Explore] │
│              │                                                      │
│  Status:     │  ┌──────────────────────────────────────────────┐   │
│  ○ All       │  │ 📄 High-Performance Cyclist — Joe Friel       │   │
│  ● Queued    │  │ Book · evidence_based · cycling, methodology  │   │
│  ○ In prog.  │  │ Status: IN PROGRESS · 186 chunks             │   │
│  ○ Done      │  │ Last updated: 2 days ago                     │   │
│  ○ Revision  │  └──────────────────────────────────────────────┘   │
│              │                                                      │
│  Evidence:   │  ┌──────────────────────────────────────────────┐   │
│  ☑ Evidence  │  │ 🌐 Heat Acclimatization Study — Lorenzo 2010  │   │
│  ☑ Practit.  │  │ Paper · evidence_based · cycling, heat       │   │
│  ☑ Anecdote  │  │ Status: QUEUED · 12 chunks                   │   │
│              │  └──────────────────────────────────────────────┘   │
│  Sport:      │                                                      │
│  ☑ Cycling   │  [Load more...]                                      │
│  ☑ Running   │                                                      │
│  ☑ Swimming  │                                                      │
│              │                                                      │
└──────────────┴──────────────────────────────────────────────────────┘
```

### Three action buttons

- **+ Add resource** (Path A) — opens a modal with: file upload area, URL input, text paste area, evidence level selector
- **🔍 Find resources** (Path B) — opens a modal with: topic text input, evidence level selector, returns 3 resource cards to choose from
- **💡 Explore topics** (Path C) — opens a modal showing 5-8 AI-suggested topic cards based on athlete context, select one to find resources

### Resource detail view

Clicking a resource opens a full detail view:

```
← Back to library

📄 High-Performance Cyclist
Joe Friel · Book · evidence_based
[queued] [in_progress] [done] [for_revision]  ← clickable status pills

Tags: cycling · methodology · periodisation · [+ add tag]

────────────────────────────────────────────────────────

[Content] [My Notes] [Coach Summary] [Coach Instructions]

────────────────────────────────────────────────────────

CONTENT TAB:
Paginated chunk display with in-page search
[< Prev chunk]  Chunk 14 of 186  [Next chunk >]

MY NOTES TAB:
[Free-form text editor — autosaves]
Placeholder: "Your thoughts, highlights, questions..."

COACH SUMMARY TAB:
[No summary yet]
[Request coach summary]  ← button, triggers AI call + usage log

COACH INSTRUCTIONS TAB:
[No instructions yet]
[Request coach instructions]  ← triggers AI call
[Or type your own instructions for the coach...]
Free-form text editor for athlete-written instructions
```

---

## Page 3 — Profile

Athlete profile and fitness anchor management.

### Sections

**Personal details**
- Name, email, date of birth, sex, weight, height, timezone
- Save button — calls PATCH /athlete

**Active sports and methodology**
- Checkboxes for active sports
- Methodology selector (Friel / Daniels / Seiler)
- Engine mode per period (shown as a period timeline with mode selector per block)

**Current fitness anchors**
- FTP (watts) — editable, shows last test date
- FTHR cycling (bpm)
- FTHR running (bpm)
- VDOT score
- CSS per 100m (shown as mm:ss per 100m)
- Max HR
- Each field shows last updated date and "Run test" button linking to test protocol

**Training background**
- Years training per sport (number inputs)
- Peak weekly hours last 12 months
- Available hours weekday / weekend

**Equipment**
- Power meter toggle
- Indoor trainer toggle
- Pool access toggle

**Onboarding progress**
- Progress bar showing onboarding stage completion
- If incomplete: "Continue onboarding with Coach Ri" button

---

## Slide-out settings panel

Accessible from the navbar settings icon. Slides in from the right. Does not navigate away from current page.

### Sections

**Notifications**
- Proactive scale slider (1–5) with label per level
- Morning digest time picker
- Weekly summary toggle

**Coaching engine**
- Context window mode selector (Lean / Balanced / Full) with cost estimate
- Default engine mode selector (Structured / Guided / Adaptive)

**Data sync**
- Strava sync: Auto / Manual toggle + time picker if auto
- File watcher status (watched-activities/ and watched-bulk/)
- Manual sync buttons per source

**Channels**
- Discord: connected indicator + channel name
- WhatsApp: setup guide link or connected indicator
- Web chat: always on indicator

**Display**
- Theme: Light / Dark toggle (same as navbar toggle)
- Dashboard chart range: 8 weeks / 12 weeks / 24 weeks

**Account**
- Athlete name display
- API key display (masked)

---

## Floating chat widget

Fixed position — bottom right corner. Always visible on all pages.

### Collapsed state
```
                              [💬]
```
A floating button with a pulsing indicator dot when there are unread coach messages.

### Expanded state (400px wide × 500px tall)
```
┌─────────────────────────────────────┐
│ Coach Ri                        [×] │
├─────────────────────────────────────┤
│                                     │
│  [Coach Ri]  Hey Riaan-Erik...      │
│                                     │
│  [You]  What should I focus on?    │
│                                     │
│  [Coach Ri]  Given your CTL...      │
│                                     │
├─────────────────────────────────────┤
│ [📎] Type a message...      [Send]  │
└─────────────────────────────────────┘
```

- Scrollable message history
- Paperclip button for file attachment (routes to fileHandler)
- Send on Enter or button click
- Messages render with markdown (bold, bullets, numbered lists)
- Channel badge on each message (Discord / web / WhatsApp icon)
- Unread count badge on collapsed button

### WebSocket connection
Connects to `ws://localhost:3001` on page load. Reconnects automatically if disconnected. Connection status shown as a small dot (green = connected, grey = reconnecting).

---

## Morning health form

Triggered by the morning digest notification or accessible via a "Log today" button on the dashboard readiness card.

### Form fields

**Mandatory:**
- HRV nightly (number input, athlete reads from Garmin app)
- Resting HR (number input)
- Sleep duration (decimal hours, e.g. 7.5)
- Wellness score (slider 1–10)

**Optional:**
- Sleep quality (slider 1–10)
- Soreness (slider 1–10)
- Motivation (slider 1–10)
- Life stress (slider 1–10)

Submit calls `POST /health/daily`. Pre-fills today's date. If a record exists for today, shows current values and allows update.

---

## System prompt refinement

The coaching engine system prompt needs tone and personality additions. Add this section to `coaching-engine/src/coach/systemPrompt.js`:

```javascript
// Tone and personality
const PERSONALITY = `
Communication style:
- Warm but direct — like a coach who respects the athlete's intelligence
- Use the athlete's first name occasionally but not every message
- Bullet points for lists, short paragraphs for explanations
- Never more than 4 paragraphs in a single response
- Avoid sports jargon without explanation — define terms the first time
- When delivering hard truths (e.g. "your base is not ready for build"), 
  be honest but constructive — explain why and what to do about it
- Celebrate real achievements specifically — not "great job" but 
  "your EF improved 3% over 8 weeks — that's meaningful aerobic progress"
- Ask one question at a time, not multiple questions in one message
- Emoji: never, except a single checkmark ✓ for confirmed actions
`
```

---

## Build order for Claude Code

1. **Scaffolding** — Vite + React + Tailwind setup, routing, context providers
2. **Shared components** — Navbar, ThemeToggle, InfoTooltip, formatters
3. **API hooks** — useApi.js with loading/error states
4. **Dashboard KPI cards** — ReadinessCard, KpiCard
5. **Fitness trend chart** — FitnessChart with CTL/ATL/TSB
6. **This week panel** — SessionList
7. **Race prediction widget** — RacePrediction with tooltip, predictions.js calculator
8. **Goals section** — GoalProgress
9. **Health metrics panel** — HealthMetrics
10. **Recent diary panel**
11. **API usage widget** — UsageSummary
12. **Dashboard page assembly** — full layout
13. **Settings panel** — SettingsPanel slide-out
14. **Chat widget** — ChatWidget with WebSocket, useChat hook
15. **Morning form** — MorningForm
16. **Knowledge browser** — ResourceList, ResourceCard, filter sidebar
17. **Resource detail view** — ResourceDetail with tabs
18. **Discover panel** — paths A, B, C modals
19. **Profile page** — all sections
20. **System prompt personality update** — coaching engine

---

## Opening prompt for Claude Code

```
Read CLAUDE.md then read frontend-design.md.

Set up the frontend project:

cd AthleteOS
npm create vite@latest frontend -- --template react
cd frontend
npm install
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
npm install react-router-dom axios recharts lucide-react

Configure tailwind.config.js with darkMode: 'class' and 
content paths covering src/**/*.{js,jsx}.

Set up the base App.jsx with:
- React Router with three routes: / (Dashboard), 
  /knowledge (Knowledge), /profile (Profile)
- ThemeContext provider wrapping the app
- AthleteContext provider wrapping the app
- Navbar component at the top of every page
- ChatWidget floating in the bottom right corner
- SettingsPanel slide-out overlay

Configure vite.config.js to proxy /api/v1 requests to 
http://localhost:3000 so the frontend never has to 
hardcode the API base URL.

Show me the complete file structure and App.jsx before 
creating any component files.
```

---

*End of frontend design. Ready for Claude Code implementation.*
