// Command Handler
// Intercepts slash commands before they reach the coaching engine.
//
// Supported commands:
//   /status  — current fitness snapshot (CTL/ATL/TSB/readiness)
//   /week    — current week summary (load, sessions completed)
//   /sync    — trigger data ingestion sync
//   /log     — prompt to log a diary entry
//   /find    — semantic search in knowledge base
//   /help    — list available commands
//
// Commands are channel-agnostic. The coaching engine is never called for commands.

import pino from 'pino';
import { apiClient } from '../api/client.js';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

// ---------------------------------------------------------------------------
// Command detection
// ---------------------------------------------------------------------------

const COMMANDS = ['/status', '/week', '/sync', '/log', '/find', '/help'];

export function isCommand(text) {
  if (!text) return false;
  const lower = text.trim().toLowerCase();
  return COMMANDS.some(cmd => lower === cmd || lower.startsWith(cmd + ' '));
}

// ---------------------------------------------------------------------------
// Command router
// ---------------------------------------------------------------------------

export async function routeCommand(text, athleteId, channel) {
  const trimmed = text.trim();
  const [cmd, ...args] = trimmed.split(/\s+/);
  const arg = args.join(' ');

  log.info({ cmd, channel }, 'routing command');

  switch (cmd.toLowerCase()) {
    case '/status': return handleStatus(athleteId);
    case '/week':   return handleWeek(athleteId);
    case '/sync':   return handleSync();
    case '/log':    return handleLog(arg);
    case '/find':   return handleFind(arg);
    case '/help':   return handleHelp();
    default:
      return `Unknown command: ${cmd}\nType /help for available commands.`;
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleStatus(athleteId) {
  try {
    const snapshot = await apiClient.get('/fitness/snapshot');
    if (!snapshot) return 'No fitness data available yet.';

    const { ctl, atl, tsb, readiness_score, recorded_at } = snapshot;
    const date = recorded_at ? new Date(recorded_at).toLocaleDateString() : 'unknown';
    const form = tsb > 5 ? 'fresh' : tsb < -20 ? 'fatigued' : 'neutral';

    return [
      `**Fitness Status** (${date})`,
      '',
      `- CTL (fitness): **${ctl ?? 'n/a'}**`,
      `- ATL (fatigue): **${atl ?? 'n/a'}**`,
      `- TSB (form): **${tsb ?? 'n/a'}** — ${form}`,
      `- Readiness: **${readiness_score ?? 'n/a'}**`,
    ].join('\n');
  } catch (err) {
    log.error({ err: err.message }, '/status failed');
    return 'Could not retrieve fitness status. Check the API connection.';
  }
}

async function handleWeek(athleteId) {
  try {
    const week = await apiClient.get('/weeks/current');
    if (!week) return 'No current week data available.';

    const { week_number, period_type, planned_tss, actual_tss, notes } = week;

    return [
      `**Current Week** (Week ${week_number ?? '?'} — ${period_type ?? 'unknown'})`,
      '',
      `- Planned TSS: ${planned_tss ?? 'n/a'}`,
      `- Actual TSS: ${actual_tss ?? 'n/a'}`,
      notes ? `- Notes: ${notes}` : null,
    ].filter(Boolean).join('\n');
  } catch (err) {
    log.error({ err: err.message }, '/week failed');
    return 'Could not retrieve week data.';
  }
}

async function handleSync() {
  try {
    await apiClient.post('/sync/trigger', { source: 'manual' });
    return 'Sync triggered. Data ingestion is running in the background.';
  } catch (err) {
    log.error({ err: err.message }, '/sync failed');
    return 'Sync trigger failed. Check the ingestion service.';
  }
}

function handleLog(prompt) {
  if (prompt) {
    return `To log a diary entry, send your notes as a message.\n\nYou said: "${prompt}"\n\nSend that as a normal message and it will be logged to your training diary.`;
  }
  return 'Send your diary entry as a normal message and it will be logged automatically.';
}

async function handleFind(query) {
  if (!query) {
    return 'Usage: /find <search terms>\nExample: /find lactate threshold base training';
  }

  try {
    const results = await apiClient.get(`/knowledge/search?q=${encodeURIComponent(query)}&limit=3`);
    const chunks = results?.results ?? [];

    if (!chunks.length) {
      return `No results found for "${query}".`;
    }

    const lines = [`**Knowledge search:** ${query}`, ''];
    chunks.forEach((chunk, i) => {
      const title = chunk.source_title ?? 'Unknown source';
      const preview = (chunk.content ?? '').slice(0, 150).replace(/\n/g, ' ');
      lines.push(`${i + 1}. **${title}**`);
      lines.push(`   ${preview}…`);
      lines.push('');
    });

    return lines.join('\n').trim();
  } catch (err) {
    log.error({ err: err.message }, '/find failed');
    return 'Knowledge search failed. Check the knowledge engine.';
  }
}

function handleHelp() {
  return [
    '**Available commands:**',
    '',
    '`/status` — fitness snapshot (CTL, ATL, TSB, readiness)',
    '`/week` — current week load and sessions',
    '`/sync` — trigger data sync from Garmin / TrainingPeaks',
    '`/log` — info on how to log a diary entry',
    '`/find <query>` — search the knowledge base',
    '`/help` — this list',
    '',
    'For everything else, just send a message — your coach is listening.',
  ].join('\n');
}
