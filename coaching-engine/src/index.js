// Coaching Engine — Entry Point
// Reads user_settings.json → registers cron jobs → starts API trigger listener.
//
// Trigger: POST /sync/trigger { source: 'coaching_engine' } via the API layer
//          allows manual job invocation without waiting for cron.

import 'dotenv/config';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import cron from 'node-cron';
import pino from 'pino';

import { runWeeklyPlanner }      from './jobs/weeklyPlanner.js';
import { runSnapshotWriter }     from './jobs/snapshotWriter.js';
import { runProgressionChecker } from './jobs/progressionChecker.js';
import { runDailyDigest }        from './jobs/dailyDigest.js';
import { apiClient }             from './api/client.js';

const log  = pino({ level: process.env.LOG_LEVEL ?? 'info' });
const __dir = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

async function loadSettings() {
  try {
    const raw = await readFile(join(__dir, '../user_settings.json'), 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    log.warn({ err: err.message }, 'could not load user_settings.json — using defaults');
    return {
      engine_mode:  'guided',
      context_mode: 'balanced',
      jobs: {
        weekly_planner:      { mode: 'auto', cron: '0 6 * * 1'  },
        snapshot_writer:     { mode: 'auto', cron: '30 20 * * 0' },
        progression_checker: { mode: 'auto', cron: '0 21 * * 0'  },
        daily_digest:        { mode: 'auto', cron: '0 9 * * *'   },
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Athlete check
// ---------------------------------------------------------------------------

async function verifyAthleteExists() {
  const athlete = await apiClient.get('/athlete');
  if (!athlete) throw new Error('No athlete record found. Run intake/onboarding first.');
  return athlete;
}

// ---------------------------------------------------------------------------
// Job registry
// ---------------------------------------------------------------------------

const JOB_RUNNERS = {
  weekly_planner:      () => runWeeklyPlanner(),
  snapshot_writer:     () => runSnapshotWriter(),
  progression_checker: () => runProgressionChecker(),
  daily_digest:        () => runDailyDigest(),
};

function registerCronJob(name, cronExpr, runner) {
  if (!cron.validate(cronExpr)) {
    log.error({ name, cronExpr }, 'invalid cron expression — job skipped');
    return null;
  }

  const task = cron.schedule(cronExpr, async () => {
    log.info({ job: name }, 'cron job triggered');
    try {
      const result = await runner();
      log.info({ job: name, result }, 'cron job complete');
    } catch (err) {
      log.error({ job: name, err: err.message }, 'cron job failed');
    }
  });

  log.info({ job: name, cron: cronExpr }, 'cron job registered');
  return task;
}

// ---------------------------------------------------------------------------
// Trigger poll
// Polls POST /sync/trigger via GET /sync/status to detect manual trigger requests.
// Lightweight — checks every 30 seconds. The API sets last_sync_attempt on trigger.
// ---------------------------------------------------------------------------

let lastTriggerTime = null;

async function checkForTrigger() {
  try {
    const status = await apiClient.get('/sync/status');
    const coachStatus = status?.find?.(s => s.source === 'coaching_engine');
    if (!coachStatus) return;

    const triggerTime = coachStatus.last_sync_attempt;
    if (triggerTime && triggerTime !== lastTriggerTime) {
      lastTriggerTime = triggerTime;
      const jobName = coachStatus.last_item_id; // API stores requested job here
      if (jobName && JOB_RUNNERS[jobName]) {
        log.info({ job: jobName }, 'manual trigger received');
        try {
          const result = await JOB_RUNNERS[jobName]();
          log.info({ job: jobName, result }, 'manual job complete');
        } catch (err) {
          log.error({ job: jobName, err: err.message }, 'manual job failed');
        }
      }
    }
  } catch { /* trigger check is non-critical */ }
}

// ---------------------------------------------------------------------------
// Main startup
// ---------------------------------------------------------------------------

async function start() {
  log.info('coaching engine starting');

  // Verify environment
  if (!process.env.API_BASE_URL) throw new Error('API_BASE_URL not set');
  if (!process.env.API_KEY)      throw new Error('API_KEY not set');
  if (!process.env.ANTHROPIC_API_KEY) log.warn('ANTHROPIC_API_KEY not set — AI calls will fail');

  // Verify athlete record exists
  let athlete;
  try {
    athlete = await verifyAthleteExists();
    log.info({ athlete: athlete.name ?? athlete.id }, 'athlete record confirmed');
  } catch (err) {
    log.warn({ err: err.message }, 'athlete check failed — continuing anyway');
  }

  // Load settings
  const settings = await loadSettings();
  log.info({ engineMode: settings.engine_mode, contextMode: settings.context_mode }, 'settings loaded');

  // Register cron jobs
  const tasks = [];
  const jobs  = settings.jobs ?? {};

  for (const [name, cfg] of Object.entries(jobs)) {
    if (cfg.mode !== 'auto' && cfg.mode !== 'manual') {
      log.info({ job: name, mode: cfg.mode }, 'job disabled — skipping');
      continue;
    }
    if (cfg.mode === 'manual') {
      log.info({ job: name }, 'job set to manual — no cron registered');
      continue;
    }
    const runner = JOB_RUNNERS[name];
    if (!runner) {
      log.warn({ job: name }, 'unknown job name — skipping');
      continue;
    }
    const task = registerCronJob(name, cfg.cron, runner);
    if (task) tasks.push({ name, task });
  }

  log.info({ jobCount: tasks.length }, 'all cron jobs registered');

  // Start trigger poll
  const triggerInterval = setInterval(checkForTrigger, 30_000);
  log.info('trigger listener started (30s poll)');

  // Startup summary
  log.info({
    jobs: tasks.map(t => t.name),
    engineMode: settings.engine_mode,
    athlete: athlete?.name ?? 'unknown',
  }, 'coaching engine ready');

  // Graceful shutdown
  const shutdown = (signal) => {
    log.info({ signal }, 'shutdown signal received');
    clearInterval(triggerInterval);
    for (const { name, task } of tasks) {
      task.stop();
      log.info({ job: name }, 'cron task stopped');
    }
    log.info('coaching engine stopped');
    process.exit(0);
  };

  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start().catch(err => {
  log.fatal({ err: err.message }, 'coaching engine failed to start');
  process.exit(1);
});
