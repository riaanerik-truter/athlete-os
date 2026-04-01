import { readFile, writeFile } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_PATH = resolve(__dirname, '../../../bulk_import_log.json');

/**
 * Reads the full bulk import log.
 * @returns {Promise<Array>}
 */
export async function readLog() {
  try {
    const raw = await readFile(LOG_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/**
 * Appends one entry to the bulk import log.
 * @param {object} entry - { file, status, activityId?, error?, processedAt }
 */
export async function appendLog(entry) {
  const log = await readLog();
  log.push({ ...entry, processedAt: entry.processedAt ?? new Date().toISOString() });
  await writeFile(LOG_PATH, JSON.stringify(log, null, 2), 'utf8');
}

/**
 * Returns true if a file path has already been successfully imported.
 * @param {string} filePath
 * @returns {Promise<boolean>}
 */
export async function alreadyImported(filePath) {
  const log = await readLog();
  return log.some(e => e.file === filePath && e.status === 'ok');
}
