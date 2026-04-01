import { readdir, rename, mkdir } from 'fs/promises';
import { resolve, join } from 'path';
import { parseGarminBulkFile } from '../parsers/garminBulkParser.js';
import { parseWellnessFile } from '../parsers/garminWellnessParser.js';
import { alreadyImported, appendLog } from '../utils/bulkImportLog.js';
import { apiClient } from '../api/client.js';
import { readFile } from 'fs/promises';
import pino from 'pino';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

// Garmin export subfolder names we care about
const FITNESS_FOLDER = 'DI-Connect-Fitness';
const WELLNESS_FOLDER = 'DI-Connect-Wellness';

/**
 * Processes a single unzipped Garmin account export folder dropped into watched-bulk/.
 *
 * Order of operations:
 * 1. Check bulk_import_log — skip if already processed
 * 2. Find and process activity summaries (DI-Connect-Fitness)
 * 3. Find and process wellness data (DI-Connect-Wellness)
 * 4. Write summary to bulk_import_log
 * 5. Move folder to processed/
 *
 * @param {string} folderPath - Absolute path to the dropped export folder
 * @param {string} processedDir - Absolute path to watched-bulk/processed/
 */
export async function processBulkExportFolder(folderPath, processedDir) {
  const folderName = folderPath.split(/[\\/]/).pop();

  if (await alreadyImported(folderPath)) {
    log.info({ folderPath }, 'bulk import: already processed, skipping');
    return;
  }

  log.info({ folderPath }, 'bulk import: starting');

  let activitySuccess = 0;
  let activitySkip = 0;
  let wellnessSuccess = 0;
  let wellnessSkip = 0;
  let errorMsg = null;
  let status = 'ok';

  try {
    // === STEP 1: Activities ===
    const fitnessPath = await findSubfolder(folderPath, FITNESS_FOLDER);
    if (fitnessPath) {
      const jsonFiles = await listJsonFiles(fitnessPath);
      log.info({ count: jsonFiles.length }, 'bulk import: processing activity files');

      for (const filePath of jsonFiles) {
        const activities = await parseGarminBulkFile(filePath);
        for (const parsed of activities) {
          try {
            const result = await apiClient.post('/sessions/completed', parsed);
            if (result === null) activitySkip++;
            else activitySuccess++;
          } catch (err) {
            log.warn({ filePath, activityId: parsed.garmin_activity_id, err: err.message }, 'bulk import: activity write failed');
          }
        }
      }
    } else {
      log.warn({ folderPath }, `bulk import: ${FITNESS_FOLDER} subfolder not found`);
    }

    // === STEP 2: Wellness ===
    const wellnessPath = await findSubfolder(folderPath, WELLNESS_FOLDER);
    if (wellnessPath) {
      const jsonFiles = await listJsonFiles(wellnessPath);
      log.info({ count: jsonFiles.length }, 'bulk import: processing wellness files');

      for (const filePath of jsonFiles) {
        let raw;
        try {
          const text = await readFile(filePath, 'utf8');
          raw = JSON.parse(text);
        } catch {
          log.warn({ filePath }, 'bulk import: failed to read wellness file');
          continue;
        }

        const days = parseWellnessFile(raw);
        for (const day of days) {
          try {
            const result = await apiClient.post('/health/daily', day);
            if (result === null) wellnessSkip++;
            else wellnessSuccess++;
          } catch (err) {
            log.warn({ date: day.date, err: err.message }, 'bulk import: wellness write failed');
          }
        }
      }
    } else {
      log.warn({ folderPath }, `bulk import: ${WELLNESS_FOLDER} subfolder not found`);
    }

    log.info({ activitySuccess, activitySkip, wellnessSuccess, wellnessSkip }, 'bulk import: complete');

  } catch (err) {
    log.error({ folderPath, err: err.message }, 'bulk import: unexpected error');
    status = 'error';
    errorMsg = err.message;
  }

  // Write log entry
  await appendLog({
    file: folderPath,
    status,
    activitySuccess,
    activitySkip,
    wellnessSuccess,
    wellnessSkip,
    error: errorMsg,
  });

  // Move folder to processed/
  try {
    await mkdir(processedDir, { recursive: true });
    const dest = resolve(processedDir, folderName);
    await rename(folderPath, dest);
    log.info({ dest }, 'bulk import: folder moved to processed');
  } catch (err) {
    log.error({ err: err.message }, 'bulk import: failed to move folder to processed');
  }
}

/**
 * Finds a named subfolder within parentPath, searching one level deep.
 * Returns the full path if found, null otherwise.
 */
async function findSubfolder(parentPath, name) {
  // Check direct child
  const direct = join(parentPath, name);
  try {
    const entries = await readdir(direct);
    if (entries) return direct;
  } catch {}

  // Check one level deeper (e.g. export/DI_CONNECT/DI-Connect-Fitness)
  try {
    const topEntries = await readdir(parentPath, { withFileTypes: true });
    for (const entry of topEntries) {
      if (entry.isDirectory()) {
        const nested = join(parentPath, entry.name, name);
        try {
          await readdir(nested);
          return nested;
        } catch {}
      }
    }
  } catch {}

  return null;
}

/**
 * Returns all .json file paths within a directory (non-recursive).
 */
async function listJsonFiles(dirPath) {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    return entries
      .filter(e => e.isFile() && e.name.toLowerCase().endsWith('.json'))
      .map(e => join(dirPath, e.name));
  } catch {
    return [];
  }
}
