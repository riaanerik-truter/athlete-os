/**
 * Standalone import runner — JSON activities + wellness only (no FIT zip processing).
 * Run from ingestion/ with env vars loaded:
 *   node run_import.mjs
 */

import 'dotenv/config';
import { readdir, readFile } from 'fs/promises';
import { join, basename, resolve } from 'path';
import { parseGarminBulkFile } from './src/parsers/garminBulkParser.js';
import {
  parseUDSFile,
  parseSleepFile,
  parseHealthStatusFile,
  mergeWellnessByDate,
} from './src/parsers/garminWellnessParser.js';
import { apiClient } from './src/api/client.js';

// All files are in a single flat processed/ folder (moved by the file watcher)
const FLAT_DIR = resolve('../watched-bulk/processed');

async function listFilesFlat(dir, predicate) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter(e => e.isFile() && predicate(e.name))
      .map(e => join(dir, e.name));
  } catch { return []; }
}

async function main() {
  console.log('=== AthleteOS Bulk Import (JSON + Wellness) ===');
  console.log('Scanning:', FLAT_DIR);

  // --- STEP 1: JSON activities ---
  const actFiles = await listFilesFlat(FLAT_DIR,
    n => n.toLowerCase().includes('summarizedactivities') && n.endsWith('.json'));
  console.log(`\nStep 1: ${actFiles.length} summarizedActivities files`);

  let actOk = 0, actSkip = 0, actFail = 0;
  for (const filePath of actFiles) {
    const activities = await parseGarminBulkFile(filePath);
    if (activities.length === 0) continue;
    console.log(`  ${basename(filePath).slice(0, 50)}...: ${activities.length} activities`);
    for (const act of activities) {
      try {
        const r = await apiClient.post('/sessions', act);
        if (r === null) actSkip++;
        else actOk++;
      } catch (err) {
        actFail++;
        if (actFail <= 5) console.warn(`  FAIL: ${act.garmin_activity_id} — ${err.message}`);
      }
    }
    console.log(`  → ok=${actOk} skip=${actSkip} fail=${actFail}`);
  }
  console.log(`\nActivities: ${actOk} created, ${actSkip} skipped (409), ${actFail} failed`);

  // --- STEP 2: Wellness ---
  console.log('\nStep 2: Wellness data');

  const allUds    = [];
  const allSleep  = [];
  const allHealth = [];

  // UDS files
  const udsFiles = await listFilesFlat(FLAT_DIR,
    n => n.toLowerCase().includes('udsfile') && n.endsWith('.json'));
  console.log(`  UDS files: ${udsFiles.length}`);
  for (const f of udsFiles) {
    try {
      const raw = JSON.parse(await readFile(f, 'utf8'));
      allUds.push(...parseUDSFile(raw));
    } catch (e) { console.warn(`  WARN: ${basename(f)} — ${e.message}`); }
  }

  // Sleep + health status files (flat directory, check name patterns)
  const wellnessFiles = await listFilesFlat(FLAT_DIR, n => n.endsWith('.json'));
  let sleepFileCount = 0, healthFileCount = 0;
  for (const f of wellnessFiles) {
    const name = basename(f).toLowerCase();
    try {
      const raw = JSON.parse(await readFile(f, 'utf8'));
      if (name.includes('sleepdata')) { allSleep.push(...parseSleepFile(raw)); sleepFileCount++; }
      else if (name.includes('healthstatusdata')) { allHealth.push(...parseHealthStatusFile(raw)); healthFileCount++; }
    } catch (e) { /* skip non-parseable files silently */ }
  }

  console.log(`  UDS days: ${allUds.length}`);
  console.log(`  Sleep files: ${sleepFileCount}, days: ${allSleep.length}`);
  console.log(`  HealthStatus files: ${healthFileCount}, days: ${allHealth.length}`);

  const merged = mergeWellnessByDate(allUds, allSleep, allHealth);
  console.log(`  Merged days: ${merged.size}`);

  let wOk = 0, wSkip = 0, wFail = 0;
  for (const day of merged.values()) {
    if (Object.keys(day).length <= 1) continue;
    try {
      const r = await apiClient.post('/health/daily', day);
      if (r === null) wSkip++;
      else wOk++;
    } catch (err) {
      wFail++;
      if (wFail <= 5) console.warn(`  FAIL: ${day.date} — ${err.message}`);
    }
  }
  console.log(`\nWellness: ${wOk} created, ${wSkip} skipped (409), ${wFail} failed`);

  // --- STEP 3: Backfill ---
  console.log('\nStep 3: Fitness backfill...');
  try {
    const r = await apiClient.post('/fitness/backfill', {});
    console.log(`Backfill: ${r?.created} created, ${r?.skipped} skipped`);
  } catch (e) { console.warn('Backfill failed:', e.message); }

  console.log('\n=== Done ===');
}

main().catch(err => { console.error(err); process.exit(1); });
