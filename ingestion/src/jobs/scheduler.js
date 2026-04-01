import cron from 'node-cron';
import { readFile } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runStravaSync } from '../sources/stravaSync.js';
import pino from 'pino';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

const __dirname = dirname(fileURLToPath(import.meta.url));
const SETTINGS_PATH = resolve(__dirname, '../../user_settings.json');

/**
 * Converts a HH:MM time string to a node-cron expression.
 * e.g. "06:00" → "0 6 * * *"
 */
function timeToCron(timeStr) {
  const [hour, minute] = timeStr.split(':').map(Number);
  return `${minute} ${hour} * * *`;
}

/**
 * Reads user_settings.json.
 * Returns the parsed settings object, or defaults on failure.
 */
async function loadSettings() {
  try {
    const text = await readFile(SETTINGS_PATH, 'utf8');
    return JSON.parse(text);
  } catch {
    log.warn('scheduler: could not read user_settings.json — using defaults');
    return {
      strava: { mode: 'manual', time: '06:00' },
      health_form_nudge: { mode: 'manual', time: '09:00' },
    };
  }
}

/**
 * Registers all scheduled cron jobs based on user_settings.json.
 * Returns an array of registered cron tasks (for shutdown cleanup).
 *
 * Jobs registered:
 * - Strava sync   — if strava.mode === 'auto'
 *
 * health_form_nudge is handled by the messaging service (not ingestion),
 * but the time is read here for reference.
 *
 * File watchers are started separately in index.js — they don't need a schedule.
 *
 * @returns {Promise<cron.ScheduledTask[]>}
 */
export async function registerScheduledJobs() {
  const settings = await loadSettings();
  const tasks = [];

  // Strava sync
  const strava = settings.strava ?? {};
  if (strava.mode === 'auto') {
    const cronExpr = timeToCron(strava.time ?? '06:00');
    const task = cron.schedule(cronExpr, async () => {
      log.info('scheduler: running scheduled Strava sync');
      try {
        await runStravaSync();
      } catch (err) {
        log.error({ err: err.message }, 'scheduler: Strava sync job failed');
      }
    });
    tasks.push(task);
    log.info({ cronExpr, time: strava.time }, 'scheduler: Strava sync registered');
  } else {
    log.info('scheduler: Strava sync is manual — not scheduled');
  }

  return tasks;
}

/**
 * Stops all registered cron tasks.
 * @param {cron.ScheduledTask[]} tasks
 */
export function stopScheduledJobs(tasks) {
  for (const task of tasks) {
    task.stop();
  }
  log.info({ count: tasks.length }, 'scheduler: all cron jobs stopped');
}
