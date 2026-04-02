import { readdir, rename, mkdir, rm, mkdtemp } from 'fs/promises';
import { resolve, join, basename } from 'path';
import { tmpdir } from 'os';
import AdmZip from 'adm-zip';
import { parseGarminBulkFile } from '../parsers/garminBulkParser.js';
import { parseFitFile } from '../parsers/fitParser.js';
import { parseWellnessFile } from '../parsers/garminWellnessParser.js';
import { alreadyImported, appendLog } from '../utils/bulkImportLog.js';
import { apiClient } from '../api/client.js';
import { readFile } from 'fs/promises';
import pino from 'pino';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

// Garmin export subfolder names
const FITNESS_FOLDER    = 'DI-Connect-Fitness';
const UPLOADED_FOLDER   = 'DI-Connect-Uploaded-Files';
const WELLNESS_FOLDER   = 'DI-Connect-Wellness';

// Batch size for posting stream rows
const STREAM_BATCH = 500;

/**
 * Processes a single unzipped Garmin account export folder dropped into watched-bulk/.
 *
 * Order of operations:
 * 1. Check bulk_import_log — skip if already processed
 * 2. Find and process activity summaries (DI-Connect-Fitness — JSON format)
 * 3. Find and process uploaded FIT files (DI-Connect-Uploaded-Files — zip of FIT files)
 * 4. Find and process wellness data (DI-Connect-Wellness)
 * 5. Write summary to bulk_import_log
 * 6. Move folder to processed/
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

  log.info({ folderPath }, 'bulk import: Garmin export folder detected — starting');

  let activitySuccess = 0;
  let activitySkip = 0;
  let wellnessSuccess = 0;
  let wellnessSkip = 0;
  let errorMsg = null;
  let status = 'ok';

  try {
    // === STEP 1: Activity summaries from DI-Connect-Fitness (JSON format) ===
    const fitnessPath = await findSubfolder(folderPath, FITNESS_FOLDER);
    if (fitnessPath) {
      const jsonFiles = await listFilesByExt(fitnessPath, '.json');
      log.info({ fitnessPath, count: jsonFiles.length }, 'bulk import: DI-Connect-Fitness — JSON files found');

      for (const filePath of jsonFiles) {
        const activities = await parseGarminBulkFile(filePath);
        log.info({ filePath, count: activities.length }, 'bulk import: parsed activity file');
        for (const parsed of activities) {
          try {
            const result = await apiClient.post('/sessions', parsed);
            if (result === null) activitySkip++;
            else activitySuccess++;
          } catch (err) {
            log.warn({ filePath, activityId: parsed.garmin_activity_id, err: err.message }, 'bulk import: activity write failed');
          }
        }
      }
    } else {
      log.info({ folderPath }, `bulk import: ${FITNESS_FOLDER} not found — skipping JSON activity path`);
    }

    // === STEP 2: FIT files from DI-Connect-Uploaded-Files (zip archives) ===
    const uploadedPath = await findSubfolder(folderPath, UPLOADED_FOLDER);
    if (uploadedPath) {
      const zipFiles = await listFilesByExt(uploadedPath, '.zip');
      log.info({ uploadedPath, zipCount: zipFiles.length }, 'bulk import: DI-Connect-Uploaded-Files — zip archives found');

      for (const zipPath of zipFiles) {
        const zipName = basename(zipPath, '.zip');
        let tmpDir = null;
        try {
          tmpDir = await mkdtemp(join(tmpdir(), 'athleteos-bulk-'));
          log.info({ zipPath, tmpDir }, 'bulk import: extracting zip');

          const zip = new AdmZip(zipPath);
          zip.extractAllTo(tmpDir, true);

          const fitFiles = await listFitFilesRecursive(tmpDir);
          log.info({ zipName, fitCount: fitFiles.length }, 'bulk import: FIT files found in zip');

          for (const fitPath of fitFiles) {
            try {
              const { session, streamRows } = await parseFitFile(fitPath);
              if (session === null) { activitySkip++; continue; }

              const result = await apiClient.post('/sessions', session);
              let sessionId = null;

              if (result === null) {
                // 409 — already exists; fetch ID so we can still write stream
                activitySkip++;
                try {
                  const existing = await apiClient.get(`/sessions?garmin_activity_id=${session.garmin_activity_id}&limit=1`);
                  sessionId = existing?.data?.[0]?.id ?? null;
                } catch (_) {}
              } else {
                activitySuccess++;
                sessionId = result?.id ?? null;
                log.info({ fitPath: basename(fitPath), sessionId, sport: session.sport }, 'bulk import: FIT session created');
              }

              // Post stream rows in batches
              if (sessionId && streamRows.length > 0) {
                let totalInserted = 0;
                for (let i = 0; i < streamRows.length; i += STREAM_BATCH) {
                  const batch = streamRows.slice(i, i + STREAM_BATCH);
                  const res = await apiClient.post(`/sessions/${sessionId}/stream`, { rows: batch });
                  totalInserted += res?.inserted ?? 0;
                }
                log.info({ sessionId, totalInserted }, 'bulk import: stream rows written');
              }

            } catch (err) {
              log.warn({ fitPath: basename(fitPath), err: err.message }, 'bulk import: FIT file failed');
            }
          }

        } catch (err) {
          log.error({ zipPath, err: err.message }, 'bulk import: zip extraction failed');
        } finally {
          if (tmpDir) {
            await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
          }
        }
      }
    } else {
      log.info({ folderPath }, `bulk import: ${UPLOADED_FOLDER} not found — skipping FIT/zip path`);
    }

    // === STEP 3: Wellness ===
    const wellnessPath = await findSubfolder(folderPath, WELLNESS_FOLDER);
    if (wellnessPath) {
      const jsonFiles = await listFilesByExt(wellnessPath, '.json');
      log.info({ wellnessPath, count: jsonFiles.length }, 'bulk import: DI-Connect-Wellness — files found');

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
      log.info({ folderPath }, `bulk import: ${WELLNESS_FOLDER} not found — skipping wellness`);
    }

    log.info(
      { activitySuccess, activitySkip, wellnessSuccess, wellnessSkip },
      'bulk import: processing complete'
    );

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Finds a named subfolder within parentPath, searching two levels deep.
 * Returns the full path if found, null otherwise.
 *
 * Handles both:
 *   parentPath/DI-Connect-Fitness            (direct child)
 *   parentPath/DI_CONNECT/DI-Connect-Fitness (one level nested — Garmin GDPR format)
 */
async function findSubfolder(parentPath, name) {
  // Check direct child
  const direct = join(parentPath, name);
  try {
    await readdir(direct);
    return direct;
  } catch {}

  // Check one level deeper
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
 * Returns all files with a given extension in a directory (non-recursive).
 */
async function listFilesByExt(dirPath, ext) {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    return entries
      .filter(e => e.isFile() && e.name.toLowerCase().endsWith(ext))
      .map(e => join(dirPath, e.name));
  } catch {
    return [];
  }
}

/**
 * Recursively finds all .fit files under a directory.
 */
async function listFitFilesRecursive(dirPath) {
  const results = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile() && e.name.toLowerCase().endsWith('.fit')) results.push(full);
    }
  }
  await walk(dirPath);
  return results;
}
