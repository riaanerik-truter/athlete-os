// Athlete OS — Messaging Service

import 'dotenv/config';
import pino from 'pino';
import cron from 'node-cron';
import { readFileSync } from 'fs';
import { startProviders, stopProviders } from './providers/index.js';
import { resolveAthleteId } from './handlers/messageHandler.js';
import { sendMorningDigest } from './notifications/morningDigest.js';
import { sendWeeklyDigest } from './notifications/weeklyDigest.js';
import { sendRecoveryAlert } from './notifications/recoveryAlert.js';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

let settings;
try {
  settings = JSON.parse(readFileSync(new URL('../user_settings.json', import.meta.url)));
} catch {
  log.error('could not read user_settings.json — exiting');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

log.info('messaging service starting');

// Verify athlete record is accessible
const athleteId = await resolveAthleteId();
if (!athleteId) {
  log.error('athlete record not found — check API connection and athlete table');
  process.exit(1);
}
log.info({ athleteId }, 'athlete resolved');

// Start providers (Discord / Telegram / WhatsApp + web chat)
await startProviders(settings);

// ---------------------------------------------------------------------------
// Cron jobs — proactive notifications
// ---------------------------------------------------------------------------

const digestTime = settings.morning_digest_time ?? '09:00';
const [digestHour, digestMin] = digestTime.split(':');
const morningCron = `${digestMin} ${digestHour} * * *`;

const summaryDay = settings.weekly_summary_day ?? 'sunday';
const DAY_MAP = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
const summaryDow = DAY_MAP[summaryDay.toLowerCase()] ?? 0;
const weeklyCron = `30 20 * * ${summaryDow}`; // Sunday 20:30, aligned with snapshot writer

const jobs = [
  {
    name: 'morning_digest',
    schedule: morningCron,
    fn: sendMorningDigest,
  },
  {
    name: 'weekly_digest',
    schedule: weeklyCron,
    fn: sendWeeklyDigest,
  },
  {
    name: 'recovery_check',
    schedule: '0 21 * * *',   // Daily 21:00 — after evening data is in
    fn: sendRecoveryAlert,
  },
];

for (const job of jobs) {
  cron.schedule(job.schedule, async () => {
    log.info({ job: job.name }, 'cron job firing');
    try {
      await job.fn();
    } catch (err) {
      log.error({ err: err.message, job: job.name }, 'cron job failed');
    }
  });
}

const jobSummary = jobs.map(j => `${j.name}(${j.schedule})`).join(', ');
log.info(`${jobs.length} cron jobs registered: ${jobSummary}`);
log.info('messaging service ready');

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

function shutdown(signal) {
  log.info({ signal }, 'shutting down');
  stopProviders();
  process.exit(0);
}

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
