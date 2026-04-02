import chokidar from 'chokidar';
import { resolve, extname, basename, join } from 'path';
import { rename, mkdir, readdir } from 'fs/promises';
import { parseGarminBulkFile } from '../parsers/garminBulkParser.js';
import { parseTpCsv } from '../parsers/tpCsvParser.js';
import { alreadyImported, appendLog } from '../utils/bulkImportLog.js';
import { apiClient } from '../api/client.js';
import { processBulkExportFolder } from '../jobs/bulkImportJob.js';
import pino from 'pino';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

/**
 * Watches the watched-bulk folder for historical export files.
 *
 * Supported file types:
 * - .json — Garmin bulk activity export (summarizedActivities format)
 * - .csv  — TrainingPeaks workout export
 *
 * Each file is checked against bulk_import_log.json before processing.
 * Duplicate imports (same file path, status=ok) are skipped.
 *
 * On success: file moved to processed/
 * On error: file moved to processed/ with status=error logged (do not block on one bad file)
 *
 * @param {string} watchPath - Absolute path to watched-bulk folder
 */
export function startBulkWatcher(watchPath) {
  const processedDir = resolve(watchPath, 'processed');
  mkdir(processedDir, { recursive: true }).catch(() => {});

  const watcher = chokidar.watch(watchPath, {
    ignored: [
      /(^|[/\\])\../,
      /processed\//,
    ],
    persistent: true,
    ignoreInitial: false,
    awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 300 },
    depth: 0,
  });

  watcher.on('add',    filePath => handleBulkFile(filePath, processedDir));
  // addDir fires when a folder is dropped into watched-bulk/ (e.g. a Garmin Connect export folder).
  // Scan it immediately for supported files and process each one.
  watcher.on('addDir', dirPath  => handleBulkDir(dirPath, processedDir));
  watcher.on('error',  err     => log.error({ err: err.message }, 'bulk watcher error'));

  log.info({ watchPath }, 'bulk watcher started');
  return watcher;
}

async function handleBulkFile(filePath, processedDir) {
  const ext = extname(filePath).toLowerCase();
  const filename = basename(filePath);

  if (!['.json', '.csv'].includes(ext)) {
    log.warn({ filePath }, 'bulk watcher: unsupported file type, ignoring');
    return;
  }

  // Dedup check
  if (await alreadyImported(filePath)) {
    log.info({ filePath }, 'bulk watcher: already imported, skipping');
    return;
  }

  log.info({ filePath }, 'bulk watcher: detected bulk file');

  let successCount = 0;
  let skipCount = 0;
  let status = 'ok';
  let errorMsg = null;

  try {
    if (ext === '.json') {
      const activities = await parseGarminBulkFile(filePath);
      for (const parsed of activities) {
        const result = await apiClient.post('/sessions', parsed);
        if (result === null) skipCount++; // 409 duplicate
        else successCount++;
      }
    } else if (ext === '.csv') {
      const rows = await parseTpCsv(filePath);
      for (const row of rows) {
        // TP CSV rows update existing sessions by tp_workout_id or date match
        // POST to /sessions/completed with TP fields; API handles upsert
        const result = await apiClient.post('/sessions', row);
        if (result === null) skipCount++;
        else successCount++;
      }
    }

    log.info({ filePath, successCount, skipCount }, 'bulk watcher: file processed');
    await moveFile(filePath, processedDir, filename);

  } catch (err) {
    log.error({ filePath, err: err.message }, 'bulk watcher: error processing file');
    status = 'error';
    errorMsg = err.message;
    await moveFile(filePath, processedDir, filename).catch(() => {});
  }

  await appendLog({
    file: filePath,
    status,
    successCount,
    skipCount,
    error: errorMsg,
  });
}

/**
 * Handles a folder dropped into watched-bulk/.
 *
 * If the folder looks like a Garmin Connect export (contains a DI_CONNECT subfolder),
 * delegates to processBulkExportFolder which knows the DI_CONNECT structure, handles
 * zip extraction of FIT files, and moves the entire folder to processed/ when done.
 *
 * Otherwise falls back to a generic recursive walk processing individual .json/.csv files.
 *
 * The root watched-bulk/ itself fires addDir on startup — skip it.
 */
async function handleBulkDir(dirPath, processedDir) {
  if (dirPath === resolve(processedDir, '..')) return  // skip watched-bulk root itself

  log.info({ dirPath }, 'bulk watcher: folder detected');

  // Detect Garmin Connect GDPR export: has DI_CONNECT subfolder
  const isGarminExport = await hasSubfolder(dirPath, 'DI_CONNECT');
  if (isGarminExport) {
    log.info({ dirPath }, 'bulk watcher: Garmin export format detected — routing to processBulkExportFolder');
    await processBulkExportFolder(dirPath, processedDir);
    return;
  }

  // Generic fallback: walk folder and process individual .json/.csv files
  log.info({ dirPath }, 'bulk watcher: generic folder — scanning for importable files');

  async function walkAndProcess(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      log.warn({ dir, err: err.message }, 'bulk watcher: could not read directory');
      return;
    }
    for (const entry of entries) {
      const fullPath = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        await walkAndProcess(fullPath);
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        if (['.json', '.csv'].includes(ext)) {
          await handleBulkFile(fullPath, processedDir);
        }
      }
    }
  }

  await walkAndProcess(dirPath);
}

/**
 * Returns true if parentDir contains a direct subdirectory with the given name.
 */
async function hasSubfolder(parentDir, name) {
  try {
    const entries = await readdir(parentDir, { withFileTypes: true });
    return entries.some(e => e.isDirectory() && e.name === name);
  } catch {
    return false;
  }
}

async function moveFile(src, destDir, filename) {
  // On Windows, rename() fails if destination already exists — add timestamp suffix.
  const ts = Date.now();
  const dotIdx = filename.lastIndexOf('.');
  const base = dotIdx > 0 ? filename.slice(0, dotIdx) : filename;
  const ext  = dotIdx > 0 ? filename.slice(dotIdx) : '';
  const dest = resolve(destDir, `${base}_${ts}${ext}`);
  await rename(src, dest);
}
