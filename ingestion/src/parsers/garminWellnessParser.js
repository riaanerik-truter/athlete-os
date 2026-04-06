/**
 * Parses Garmin wellness export files into daily_metrics payloads.
 *
 * Three source types (all in DI_CONNECT subfolders):
 *
 * 1. UDSFile_*.json  (DI-Connect-Aggregator)
 *    Fields: calendarDate (ISO), restingHeartRate, allDayStress.aggregatorList[TOTAL],
 *            bodyBattery.bodyBatteryStatList[HIGHEST]
 *
 * 2. *_sleepData.json  (DI-Connect-Wellness)
 *    Fields: calendarDate (ISO), deepSleepSeconds, lightSleepSeconds, remSleepSeconds,
 *            sleepScores.overallScore
 *
 * 3. *_healthStatusData.json  (DI-Connect-Wellness)
 *    Fields: calendarDate (ISO), metrics[] with types HRV, SPO2, SKIN_TEMP_C
 *
 * All three are parsed separately then merged by date before posting to /health/daily.
 */

// ---------------------------------------------------------------------------
// UDS (User Daily Summary) — DI-Connect-Aggregator/UDSFile_*.json
// ---------------------------------------------------------------------------

/**
 * Parses a single UDS day entry.
 * Returns null if calendarDate is missing.
 */
export function parseUDSEntry(raw) {
  if (!raw?.calendarDate) return null;

  // Body battery: use HIGHEST as morning proxy
  const bbStats = raw.bodyBattery?.bodyBatteryStatList ?? [];
  const bbHighest = bbStats.find(s => s.bodyBatteryStatType === 'HIGHEST');
  const bodyBatteryMorning = bbHighest?.statsValue ?? null;

  // Stress: allDayStress → aggregatorList → TOTAL type
  const aggList = raw.allDayStress?.aggregatorList ?? [];
  const totalAgg = aggList.find(a => a.type === 'TOTAL');
  const stressAvg = totalAgg?.averageStressLevel ?? null;

  const entry = {
    date:                 raw.calendarDate,
    resting_hr:           raw.restingHeartRate ?? null,
    body_battery_morning: bodyBatteryMorning,
    stress_avg:           stressAvg,
  };
  return Object.fromEntries(Object.entries(entry).filter(([, v]) => v != null));
}

/**
 * Parses a UDS file (array of day objects).
 */
export function parseUDSFile(raw) {
  const arr = Array.isArray(raw) ? raw : (raw?.udsSummaryEntities ?? []);
  return arr.map(parseUDSEntry).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Sleep data — DI-Connect-Wellness/*_sleepData.json
// ---------------------------------------------------------------------------

/**
 * Parses a single sleep day entry.
 */
export function parseSleepEntry(raw) {
  if (!raw?.calendarDate) return null;

  const deep  = raw.deepSleepSeconds  ?? 0;
  const light = raw.lightSleepSeconds ?? 0;
  const rem   = raw.remSleepSeconds   ?? 0;
  const totalSec = deep + light + rem;

  const entry = {
    date:               raw.calendarDate,
    sleep_duration_hrs: totalSec > 0 ? Math.round((totalSec / 3600) * 100) / 100 : null,
    sleep_score:        raw.sleepScores?.overallScore ?? null,
  };
  return Object.fromEntries(Object.entries(entry).filter(([, v]) => v != null));
}

/**
 * Parses a sleep data file (array of day objects).
 */
export function parseSleepFile(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  return arr.map(parseSleepEntry).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Health status — DI-Connect-Wellness/*_healthStatusData.json
// ---------------------------------------------------------------------------

/**
 * Normalises Garmin HRV status strings to lowercase with underscores.
 * E.g. 'VERY_LOW' → 'very_low', 'BALANCED' → 'balanced'
 */
function normaliseHrvStatus(status) {
  if (!status) return null;
  return status.toLowerCase().replace(/\s+/g, '_');
}

/**
 * Maps healthStatusData.metrics[type=HRV].status to hrv_status enum values.
 * Garmin uses: ONBOARDING, BALANCED, UNBALANCED, LOW, POOR, etc.
 */
const HRV_STATUS_MAP = {
  balanced:   'balanced',
  unbalanced: 'low',
  low:        'low',
  poor:       'very_low',
  good:       'good',
  excellent:  'excellent',
  onboarding: null,
  none:       null,
  unknown:    null,
};

function mapHrvStatus(garminStatus) {
  if (!garminStatus) return null;
  const key = garminStatus.toLowerCase();
  return HRV_STATUS_MAP[key] ?? normaliseHrvStatus(garminStatus);
}

/**
 * Parses a single healthStatusData day entry.
 */
export function parseHealthStatusEntry(raw) {
  if (!raw?.calendarDate) return null;

  const metrics = Array.isArray(raw.metrics) ? raw.metrics : [];
  const find = type => metrics.find(m => m.type === type);

  const hrv     = find('HRV');
  const spo2    = find('SPO2');
  const skinTemp = find('SKIN_TEMP_C');

  const entry = {
    date:                raw.calendarDate,
    hrv_nightly_avg:     hrv?.value     ?? null,
    hrv_status:          hrv?.status    ? mapHrvStatus(hrv.status) : null,
    spo2_avg:            spo2?.value    ?? null,
    skin_temp_deviation: skinTemp?.value ?? null,
  };
  return Object.fromEntries(Object.entries(entry).filter(([, v]) => v != null));
}

/**
 * Parses a healthStatusData file (array of day objects).
 */
export function parseHealthStatusFile(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  return arr.map(parseHealthStatusEntry).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Merge arrays by date
// ---------------------------------------------------------------------------

/**
 * Merges multiple parsed entry arrays into a single map keyed by date.
 * Later arrays take precedence for overlapping fields.
 *
 * @param  {...Array} arrays - Parsed entry arrays (each item has a .date field)
 * @returns {Map<string, object>} date → merged payload
 */
export function mergeWellnessByDate(...arrays) {
  const map = new Map();
  for (const arr of arrays) {
    for (const entry of arr) {
      if (!entry?.date) continue;
      const existing = map.get(entry.date) ?? { date: entry.date };
      // Merge: only overwrite with non-null values
      for (const [k, v] of Object.entries(entry)) {
        if (v != null) existing[k] = v;
      }
      map.set(entry.date, existing);
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Dispatcher (backward-compat for single-file callers)
// ---------------------------------------------------------------------------

/**
 * Auto-detects file type by filename pattern and dispatches to the right parser.
 * Returns array of parsed payloads.
 *
 * @param {Array|object} raw - Parsed JSON content
 * @param {string} [filename] - Original filename (used for type detection)
 * @returns {Array}
 */
export function parseWellnessFile(raw, filename = '') {
  const name = filename.toLowerCase();
  if (name.includes('udsfile') || name.includes('aggregator')) {
    return parseUDSFile(raw);
  }
  if (name.includes('sleepdata')) {
    return parseSleepFile(raw);
  }
  if (name.includes('healthstatusdata')) {
    return parseHealthStatusFile(raw);
  }

  // Legacy: plain array of day objects
  if (Array.isArray(raw)) {
    return raw.map(parseUDSEntry).filter(Boolean);
  }
  return [];
}
