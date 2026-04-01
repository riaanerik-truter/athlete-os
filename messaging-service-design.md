# Athlete OS — Messaging Service Design
**Version:** 1.0  
**Status:** Design complete — ready for Claude Code implementation  
**Language:** Node.js (matches all other services)  
**Last updated:** 2026-03-31

---

## Overview

The messaging service is the bridge between the athlete and the coaching engine. It handles all inbound and outbound communication across three channels: Telegram (default), WhatsApp via Twilio (optional), and web chat (embedded in dashboard).

The messaging service does not contain coaching logic. It receives messages, routes them to the coaching engine, and delivers responses back to the athlete. It also manages proactive notifications triggered by other services (coaching engine, ingestion service, snapshot writer).

---

## Channel providers

| Channel | Provider | Setup complexity | Cost | Default |
|---|---|---|---|---|
| Telegram | Telegram Bot API | 30 seconds via @BotFather | Free | Yes |
| WhatsApp | Twilio + Meta Business API | 1-2 hours, account approval | ~$0.005/message + WhatsApp fees | Optional |
| Web chat | Local HTTP + WebSocket | Zero — built into dashboard | Free | Always available |

Channel configuration in `.env`:

```
# Telegram (default)
TELEGRAM_BOT_TOKEN=

# WhatsApp via Twilio (optional)
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_NUMBER=

# Web chat is always on — no config needed
```

Active channels determined by which tokens are present in `.env`. If `TELEGRAM_BOT_TOKEN` is set, Telegram is active. If both Telegram and Twilio are configured, both are active simultaneously.

---

## Provider abstraction

All channel-specific logic is isolated behind a provider interface. The coaching engine and notification system never interact with channel APIs directly — they call the messaging service, which routes to the correct provider.

```javascript
// Provider interface — all providers implement these methods
class ChannelProvider {
  async send(athleteId, message)           // send text message
  async sendMarkdown(athleteId, message)   // send formatted message
  async sendImage(athleteId, imagePath)    // send image file
  async sendFile(athleteId, filePath)      // send document
  async onMessage(handler)                // register inbound message handler
}
```

### Markdown rendering per channel

One message template, rendered differently per channel:

```javascript
function renderMarkdown(text, channel) {
  if (channel === 'telegram') return text  // native markdown
  if (channel === 'whatsapp') return text
    .replace(/\*\*(.*?)\*\*/g, '*$1*')    // bold: ** → *
    .replace(/_(.*?)_/g, '_$1_')          // italic: same
  if (channel === 'web') return marked(text)  // full HTML
}
```

**Message style guidelines:**
- Minimal bold and italics — only for genuinely critical information
- Generous use of bullet points and numbered lists
- Short paragraphs — WhatsApp and Telegram are mobile-first
- Never exceed 3 paragraphs without a list break

---

## Proactive notification scale

Configurable in app settings. Stored as `proactive_scale` (1-5) in `user_settings.json`. Default: 3.

| Priority | Notification type | Minimum scale |
|---|---|---|
| 1 — Critical | Recovery alerts — HRV declining, session auto-modified | 1 (always on) |
| 2 — Important | Milestone alerts — FTP improved, period complete, gate passed | 2+ |
| 3 — Standard | Morning readiness summary + today's planned session | 3+ |
| 4 — Standard | Plan revision notifications | 3+ |
| 5 — Informational | Weekly training summary (Sunday evening) | 4+ |
| 6 — Informational | Session reminders (configurable time before session) | 4+ |
| 7 — Optional | Knowledge suggestions — Path C proactive topics | 5 only |

```javascript
function shouldSend(notificationType, proactiveScale) {
  const THRESHOLDS = {
    'recovery_alert': 1,
    'milestone': 2,
    'morning_digest': 3,
    'plan_revision': 3,
    'weekly_summary': 4,
    'session_reminder': 4,
    'knowledge_suggestion': 5
  }
  return proactiveScale >= THRESHOLDS[notificationType]
}
```

---

## Inbound message flow

```
Athlete sends message (any channel)
  → Channel provider webhook receives it
  → Messaging service parses: channel, athlete phone/ID, content, timestamp
  → Check for slash command → if yes, route to command handler
  → If no command: log to conversation table via API
  → Route to coaching engine handler
  → Coaching engine returns response
  → Log response to conversation table
  → Send response via same channel provider
  → If media attached: route to file handler
```

### Inbound file handling

When athlete sends a file via chat:

```javascript
async function handleInboundFile(file, channel, athleteId) {
  const ext = path.extname(file.name).toLowerCase()

  if (ext === '.pdf') {
    // Route to knowledge engine ingestion (Path A)
    return await knowledgeApi.createResource({
      athlete_id: athleteId,
      source_type: 'pdf',
      file_path: file.savedPath,
      ingestion_path: 'A'
    })
  }

  if (ext === '.csv') {
    // Route to ingestion service TP CSV handler
    return await copyToWatchedActivities(file.savedPath)
  }

  if (ext === '.json' || ext === '.fit') {
    // Route to ingestion service activity handler
    return await copyToWatchedActivities(file.savedPath)
  }

  // Unknown file type — ask athlete what to do
  return { action: 'ask_athlete', message: `I received a ${ext} file. What would you like to do with it?` }
}
```

---

## Slash commands

Intercepted before routing to coaching engine. Work identically across all channels.

| Command | Action | Response |
|---|---|---|
| `/status` | Fetch readiness + today's session from API | Formatted readiness score, planned session details |
| `/week` | Fetch current week from API | Session list, volume, compliance % |
| `/sync` | Call `POST /sync/trigger { source: "all" }` | Confirmation with job ID |
| `/log [text]` | Create diary entry with provided text | Confirmation, asks for wellness score |
| `/find [topic]` | Trigger knowledge Path B with topic | Asks for evidence level preference, then returns 3 resources |
| `/help` | Return command list | Formatted list of available commands |

```javascript
const COMMANDS = {
  '/status': handleStatus,
  '/week': handleWeek,
  '/sync': handleSync,
  '/log': handleLog,
  '/find': handleFind,
  '/help': handleHelp
}

function isCommand(text) {
  return text.trim().startsWith('/')
}

function parseCommand(text) {
  const parts = text.trim().split(' ')
  const command = parts[0].toLowerCase()
  const args = parts.slice(1).join(' ')
  return { command, args }
}
```

### `/status` response format

```
*Readiness: 74/100*

• HRV: 64ms (balanced)
• Resting HR: 47bpm
• Sleep: 7.8hrs, score 78
• TSB: -3.7 (in training load)

Today's session:
• AE2 — Aerobic threshold ride
• Target: 90min, Z2 power
• Target TSS: 72
```

### `/week` response format

```
*Week 14 — Build 1*

Sessions:
1. ✅ Mon — AE1 Recovery (45min)
2. ✅ Tue — ME1 Cruise intervals (75min)
3. ⏳ Thu — AE2 Long ride (120min) ← today
4. ○ Sat — AC1 Group ride (90min)
5. ○ Sun — AE1 Recovery (45min)

Volume: 4.0/11.5hrs (35%)
TSS: 142/380 (37%)
```

---

## Proactive notification templates

### Morning digest (scale 3+)

Sent at configured time (default 09:00). Generated by `dailyDigest` job in coaching engine.

```
Good morning. Here's your day:

*Readiness: 81/100* ↑ Good to train

Today's session:
• AE2 — Aerobic threshold ride
• 90min, Z2 power (157-210W)
• Target TSS: 72

Notes: Sleep score 82 last night.
HR trending stable. Green light.
```

### Recovery alert (scale 1 — always on)

```
⚠ Recovery alert

Your HRV has declined for 4 consecutive days
(72 → 68 → 61 → 57ms). This pattern suggests
accumulated fatigue.

I've swapped tomorrow's threshold session for
an AE1 recovery ride (45min, Z1 only).

Consider: extra sleep tonight, reduce stress
where possible, light nutrition focus.
```

### Milestone alert (scale 2+)

```
🎯 New FTP recorded

Today's T1 test result:
• FTP: 285W (+5W from last test)
• FTHR: 163bpm
• W/kg: 3.80 (at 75kg)

Training zones updated. Well done —
consistent Z2 work is paying off.
```

### Weekly summary (scale 4+)

Sent Sunday evening after snapshot writer completes.

```
*Week 14 complete*

Volume: 10.8 / 11.5hrs (94%) ✅
TSS: 358 / 380 (94%) ✅
Sessions: 5/5 completed ✅

Fitness (CTL): 68.4 → 71.2 (+2.8)
Fatigue (ATL): 74.1
Form (TSB): -2.9

EF trend: improving (+1.8% vs 4wks ago)
Decoupling last long ride: 3.2% ✅

Next week: Build 1, Week 3.
Volume target: 12.5hrs.
Anchor session: Saturday long ride (3hr).
```

### Weekly chart (toggle in settings)

When enabled, a PNG chart is generated and sent alongside the weekly summary. Chart contains:
- CTL/ATL/TSB trend (12 weeks)
- Weekly TSS bars
- Current period marker

Generated by the snapshot export service. Sent via `sendImage()`.

---

## Web chat interface

Embedded as a tab in the athlete dashboard. Always available regardless of Telegram/WhatsApp configuration.

### Technical implementation

WebSocket connection between dashboard and messaging service. Messages sent and received in real time without page refresh.

```javascript
// Messaging service — WebSocket server
import { WebSocketServer } from 'ws'

const wss = new WebSocketServer({ port: 3001 })

wss.on('connection', (ws) => {
  ws.on('message', async (data) => {
    const { content, athleteId } = JSON.parse(data)
    // Route through same message handler as Telegram/WhatsApp
    const response = await handleMessage(athleteId, content, 'web')
    ws.send(JSON.stringify({ role: 'coach', content: response }))
  })
})
```

### Conversation display

- Scrollable thread showing full conversation history (all channels merged)
- Channel badge on each message (Telegram icon, WhatsApp icon, web icon)
- Timestamps on each message
- Slash commands work in web chat input box
- File upload button (routes to inbound file handler)

---

## Cross-channel conversation merging

All messages logged to `conversation` table regardless of channel. The `channel` field records the origin. When the coaching engine builds context, it reads from the merged history — the athlete's question from WhatsApp yesterday and the coach's response from web chat this morning are in the same thread.

Athlete identification across channels:
- Telegram: identified by `telegram_chat_id` stored on athlete record
- WhatsApp: identified by phone number matched to athlete record
- Web chat: identified by session (local app, single athlete)

Add fields to `athlete` table:

```sql
ALTER TABLE athlete
  ADD COLUMN telegram_chat_id TEXT,
  ADD COLUMN whatsapp_number_verified TEXT;  -- confirmed number for WhatsApp matching
```

---

## Twilio WhatsApp setup guide (for installer)

The installer includes a guided setup wizard for WhatsApp via Twilio:

```
Step 1: Create a free Twilio account at twilio.com
Step 2: In Twilio console, go to Messaging → Try it out → Send a WhatsApp message
Step 3: Follow Twilio's WhatsApp Business API setup (links to their docs)
Step 4: Once approved, copy your Account SID, Auth Token, and WhatsApp number
Step 5: Paste them into Athlete OS settings or .env file
Step 6: Send "join [sandbox-word]" from your personal WhatsApp to activate
```

This is documented in the installer README with screenshots. The setup is one-time per athlete instance.

---

## Service folder structure

```
messaging-service/
  src/
    providers/
      telegram.js          ← Telegram Bot API provider
      whatsapp.js          ← Twilio WhatsApp provider
      webChat.js           ← WebSocket provider for dashboard
      index.js             ← provider registry, routes by channel
    handlers/
      messageHandler.js    ← main inbound message router
      commandHandler.js    ← slash command processor
      fileHandler.js       ← inbound file routing
      notificationHandler.js ← outbound notification sender
    notifications/
      morningDigest.js     ← morning readiness + session message builder
      weeklyDigest.js      ← weekly summary + optional chart
      recoveryAlert.js     ← HRV/fatigue alert builder
      milestoneAlert.js    ← FTP/VDOT/CSS improvement builder
      planRevision.js      ← plan change notification builder
      knowledgeSuggest.js  ← Path C knowledge suggestion builder
    formatting/
      markdown.js          ← channel-specific markdown renderer
      templates.js         ← message template functions
    api/
      client.js            ← Athlete OS API HTTP client
    index.js               ← entry point, starts all providers
  package.json
  .env.template
```

---

## Schema additions

```sql
-- Add channel identity fields to athlete
ALTER TABLE athlete
  ADD COLUMN telegram_chat_id        TEXT,
  ADD COLUMN whatsapp_number_verified TEXT;

-- Add proactive_scale to user_settings.json (not DB)
-- Default: 3
```

No other schema changes required. The `conversation` and `notification_log` tables already have `channel` fields.

---

## Build order for Claude Code

1. **Schema migration** — add two fields to athlete table
2. **Scaffolding** — package.json, folder structure
3. **Telegram provider** — bot setup, webhook handler, send/receive
4. **Web chat provider** — WebSocket server, message routing
5. **Message handler** — main router: command check → log → coaching engine → log → respond
6. **Command handler** — all 6 slash commands
7. **File handler** — inbound file routing by extension
8. **Notification handler** — outbound notification sender with scale check
9. **Notification builders** — one file per notification type
10. **Markdown renderer** — channel-specific rendering
11. **WhatsApp provider** — Twilio integration (after Telegram is working)
12. **Provider registry** — routes to correct provider based on `.env` config
13. **Index.js** — starts all configured providers

Test order: web chat first (no external accounts needed) → Telegram → WhatsApp last.

---

## Opening prompt for Claude Code

```
Read CLAUDE.md then read messaging-service-design.md.

Run this migration first:

ALTER TABLE athlete
  ADD COLUMN telegram_chat_id        TEXT,
  ADD COLUMN whatsapp_number_verified TEXT;

Confirm migration, then begin scaffolding. Start with package.json 
and folder structure. Show me the structure before creating any files.

Build in this order: Telegram provider → web chat provider → message 
handler → command handler → file handler → notification system.

Test Telegram first. Once the bot is responding to messages and 
logging to the conversation table, move to web chat. WhatsApp 
last after both others are confirmed working.
```

---

## Cost estimates

All notification costs are zero for Telegram and web chat. WhatsApp costs apply only if Twilio is configured.

| Scenario | Monthly messages | WhatsApp cost (if used) |
|---|---|---|
| Scale 1, Telegram only | ~30 | $0 |
| Scale 3, Telegram only | ~150 | $0 |
| Scale 5, Telegram only | ~300 | $0 |
| Scale 3, WhatsApp via Twilio | ~150 | ~$7.50 |

---

*End of messaging service design. Ready for Claude Code implementation.*
