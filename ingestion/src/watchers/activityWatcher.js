import chokidar from 'chokidar';
import { resolve, extname, basename } from 'path';
import { rename, mkdir } from 'fs/promises';
import { parseGarminActivity } from '../parsers/garminActivityParser.js';
import { parseFitFile } from '../parsers/fitParser.js';
import { apiClient } from '../api/client.js';
import pino from 'pino';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

/**
 * Watches the watched-activities folder for new Garmin activity files.
 *
 * Supported file types:
 * - .json — single activity export (single object OR summarizedActivities array)
 * - .fit  — raw FIT file (stub, skipped until Layer 3)
 *
 * On detection:
 * 1. Parse the file
 * 2. POST to POST /sessions/completed
 * 3. Move to processed/ on success, failed/ on error
 *
 * @param {string} watchPath - Absolute path to watched-activities folder
 */
export function startActivityWatcher(watchPath) {
  const processedDir = resolve(watchPath, 'processed');
  const failedDir = resolve(watchPath, 'failed');

  // Ensure subdirs exist
  mkdir(processedDir, { recursive: true }).catch(() => {});
  mkdir(failedDir, { recursive: true }).catch(() => {});

  const watcher = chokidar.watch(watchPath, {
    ignored: [
      /(^|[/\\])\../,          // dotfiles
      /processed\//,            // already processed
      /failed\//,               // already failed
    ],
    persistent: true,
    ignoreInitial: false,
    awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 200 },
    depth: 0,                   // only watch root of watched-activities, not subdirs
  });

  watcher.on('add', filePath => handleFile(filePath, processedDir, failedDir));
  watcher.on('error', err => log.error({ err: err.message }, 'activity watcher error'));

  log.info({ watchPath }, 'activity watcher started');
  return watcher;
}

async function handleFile(filePath, processedDir, failedDir) {
  const ext = extname(filePath).toLowerCase();
  const filename = basename(filePath);

  log.info({ filePath }, 'activity watcher: detected file');

  try {
    if (ext === '.fit') {
      await handleFitFile(filePath, processedDir, failedDir, filename);
      return;
    }

    if (ext !== '.json') {
      log.warn({ filePath }, 'activity watcher: unsupported file type, moving to failed');
      await moveFile(filePath, failedDir, filename);
      return;
    }

    const { readFile } = await import('fs/promises');
    const text = await readFile(filePath, 'utf8');
    const raw = JSON.parse(text);

    // Support single activity object or array
    const activities = Array.isArray(raw) ? raw
      : Array.isArray(raw?.summarizedActivities) ? raw.summarizedActivities
      : [raw];

    let successCount = 0;
    let skipCount = 0;
    let errorCount = 0;

    for (const entry of activities) {
      const parsed = parseGarminActivity(entry);
      if (parsed === null) { skipCount++; continue; }

      const result = await apiClient.post('/sessions', parsed);
      if (result === null) {
        // 409 — already exists
        skipCount++;
      } else {
        successCount++;
      }
    }

    log.info({ filePath, successCount, skipCount, errorCount }, 'activity watcher: file processed');
    await moveFile(filePath, processedDir, filename);

  } catch (err) {
    log.error({ filePath, err: err.message }, 'activity watcher: failed to process file');
    await moveFile(filePath, failedDir, filename).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// FIT file handler
// ---------------------------------------------------------------------------

async function handleFitFile(filePath, processedDir, failedDir, filename) {
  try {
    const { session, streamRows } = await parseFitFile(filePath);

    if (session === null) {
      log.info({ filePath }, 'activity watcher: .fit sport skipped — moving to processed');
      await moveFile(filePath, processedDir, filename);
      return;
    }

    // POST the session
    const result = await apiClient.post('/sessions', session);
    let sessionId = null;

    if (result === null) {
      // 409 — session exists; fetch its ID so we can still write the stream
      log.info({ filePath, garmin_activity_id: session.garmin_activity_id }, 'activity watcher: .fit session already exists — fetching id for stream write');
      try {
        const existing = await apiClient.get(`/sessions?garmin_activity_id=${session.garmin_activity_id}&limit=1`);
        sessionId = existing?.data?.[0]?.id ?? null;
      } catch (_) { /* stream write will be skipped */ }
    } else {
      sessionId = result?.id ?? null;
      log.info({ filePath, sessionId, sport: session.sport }, 'activity watcher: .fit session created');
    }

    // POST stream rows in batches of 500
    if (sessionId && streamRows.length > 0) {
      const BATCH = 500;
      let totalInserted = 0;
      for (let i = 0; i < streamRows.length; i += BATCH) {
        const batch = streamRows.slice(i, i + BATCH);
        const res = await apiClient.post(`/sessions/${sessionId}/stream`, { rows: batch });
        totalInserted += res?.inserted ?? 0;
      }
      log.info({ filePath, sessionId, totalInserted }, 'activity watcher: .fit stream rows written');
    }

    await moveFile(filePath, processedDir, filename);

  } catch (err) {
    log.error({ filePath, err: err.message }, 'activity watcher: .fit processing failed');
    await moveFile(filePath, failedDir, filename).catch(() => {});
  }
}

async function moveFile(src, destDir, filename) {
  // On Windows, rename() fails with ENOENT if the destination already exists.
  // Add a timestamp suffix to ensure unique destination filename.
  const ts = Date.now();
  const dotIdx = filename.lastIndexOf('.');
  const base = dotIdx > 0 ? filename.slice(0, dotIdx) : filename;
  const ext  = dotIdx > 0 ? filename.slice(dotIdx) : '';
  const dest = resolve(destDir, `${base}_${ts}${ext}`);
  await rename(src, dest);
}
