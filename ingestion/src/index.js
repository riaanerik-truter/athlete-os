import 'dotenv/config';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import pino from 'pino';
import { apiClient } from './api/client.js';
import { startActivityWatcher } from './watchers/activityWatcher.js';
import { startBulkWatcher } from './watchers/bulkWatcher.js';
import { registerScheduledJobs, stopScheduledJobs } from './jobs/scheduler.js';
import { stravaConfigured } from './sources/stravaClient.js';

const log = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport: process.stdout.isTTY
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
});

const __dirname = dirname(fileURLToPath(import.meta.url));

// Resolve watch folder paths relative to the ingestion/ root
const WATCHED_ACTIVITIES = resolve(__dirname, '../../watched-activities');
const WATCHED_BULK = resolve(__dirname, '../../watched-bulk');

/**
 * Checks if an athlete record exists in the API.
 * If not, logs a warning and returns false — sync jobs should not run.
 */
async function checkAthleteExists() {
  try {
    await apiClient.get('/athlete');
    return true;
  } catch (err) {
    const status = err.response?.status;
    if (status === 404) {
      log.warn('No athlete profile found. Complete setup via the dashboard before syncing.');
      return false;
    }
    // API not reachable — warn but continue (watchers can still start)
    log.warn({ err: err.message }, 'Could not reach API to verify athlete — continuing anyway');
    return true;
  }
}

async function main() {
  log.info('Athlete OS ingestion service starting');

  // ── Strava status ──────────────────────────────────────────────────────────
  if (stravaConfigured()) {
    log.info('Strava client: configured (CLIENT_ID present)');
  } else {
    log.info('Strava client: not configured — STRAVA_CLIENT_ID not set, Strava sync disabled');
  }

  // ── Athlete check ──────────────────────────────────────────────────────────
  const athleteExists = await checkAthleteExists();
  if (!athleteExists) {
    log.warn('Scheduler disabled until athlete profile is created.');
  }

  // ── File watchers ──────────────────────────────────────────────────────────
  // Watchers always start — they only fire when a file appears, so safe regardless
  const activityWatcher = startActivityWatcher(WATCHED_ACTIVITIES);
  const bulkWatcher = startBulkWatcher(WATCHED_BULK);

  log.info({ path: WATCHED_ACTIVITIES }, 'Watcher active: watched-activities/');
  log.info({ path: WATCHED_BULK }, 'Watcher active: watched-bulk/');

  // ── Scheduler ─────────────────────────────────────────────────────────────
  let cronTasks = [];
  if (athleteExists) {
    cronTasks = await registerScheduledJobs();
    log.info({ jobs: cronTasks.length }, `Scheduler: ${cronTasks.length} job(s) registered`);
  }

  log.info('Ingestion service ready');

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  async function shutdown(signal) {
    log.info({ signal }, 'Shutting down ingestion service');
    stopScheduledJobs(cronTasks);
    await activityWatcher.close();
    await bulkWatcher.close();
    log.info('Ingestion service stopped');
    process.exit(0);
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch(err => {
  log.error({ err: err.message }, 'Fatal error during startup');
  process.exit(1);
});
