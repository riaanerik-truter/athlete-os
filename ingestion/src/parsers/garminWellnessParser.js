/**
 * Parses Garmin UDS aggregator wellness files.
 *
 * Source files (in DI_CONNECT/DI-Connect-User-Uploaded-Files/):
 * - UDSFile_*_wellness.json  — daily wellness snapshot
 * - Garmin also produces per-day folders with HRV, sleep, body battery data
 *
 * The wellness export structure varies by firmware. We read the fields
 * defensively and skip any day where calendarDate is missing.
 *
 * Body battery approximation:
 * - Export provides HIGHEST / LOWEST / MOSTRECENT stats per day
 * - HIGHEST used as best proxy for morning (wake) reading
 * - MOSTRECENT is end-of-day — not suitable as morning proxy
 *
 * All fields mapped to the daily_metrics table columns.
 */

/**
 * Parses a single wellness day object.
 * Returns null if calendarDate is missing.
 *
 * @param {object} raw
 * @returns {object|null}
 */
export function parseWellnessDay(raw) {
  if (!raw?.calendarDate) return null;

  // Body battery: use HIGHEST as morning approximation
  const bodyBatteryStats = raw.bodyBatteryStatList?.[0];
  const bodyBatteryMorning = bodyBatteryStats?.HIGHEST ?? null;

  // HRV: last night's resting HRV
  const hrvLastNight = raw.lastNight?.avgHRV ?? raw.avgHRV ?? null;
  const hrvStatus = raw.lastNight?.status ?? null;  // e.g. 'BALANCED', 'LOW', etc.

  // Sleep
  const sleepSeconds = raw.sleepingSeconds ?? null;
  const sleepScoreValue = raw.sleepScore?.value ?? raw.sleepScore ?? null;

  // SpO2
  const spo2Avg = raw.averageSpO2 ?? raw.avgSpo2 ?? null;

  // Stress
  const stressAvg = raw.averageStressLevel ?? null;

  // Resting HR
  const restingHr = raw.restingHeartRate ?? null;

  // Steps
  const steps = raw.totalSteps ?? null;

  // Skin temperature deviation (Garmin exports deviation from baseline)
  const skinTempDeviation = raw.skinTemp?.deviation ?? null;

  // Training readiness (0–100 composite)
  const trainingReadiness = raw.trainingReadinessScore ?? null;

  // API field names verified against dailyMetricsCreateSchema
  return {
    date:                 raw.calendarDate,                         // YYYY-MM-DD
    resting_hr:           restingHr,
    hrv_nightly_avg:      hrvLastNight,                             // was hrv_last_night
    hrv_status:           hrvStatus ? normaliseHrvStatus(hrvStatus) : null,
    body_battery_morning: bodyBatteryMorning,
    sleep_duration_hrs:   sleepSeconds != null ? sleepSeconds / 3600 : null, // schema wants hours
    sleep_score:          sleepScoreValue,
    spo2_avg:             spo2Avg,
    stress_avg:           stressAvg,
    skin_temp_deviation:  skinTempDeviation,
    readiness_score:      trainingReadiness,                        // was training_readiness
    // steps: not in dailyMetricsCreateSchema — omitted
  };
}

/**
 * Normalises Garmin HRV status strings to lowercase snake_case.
 * E.g. 'VERY_LOW' → 'very_low', 'BALANCED' → 'balanced'
 */
function normaliseHrvStatus(status) {
  return status.toLowerCase().replace(/\s+/g, '_');
}

/**
 * Parses a wellness JSON file (array of day objects or wrapped).
 * Returns an array of parsed day payloads.
 *
 * @param {Array|object} raw - Parsed JSON content
 * @returns {Array}
 */
export function parseWellnessFile(raw) {
  let days;
  if (Array.isArray(raw)) {
    days = raw;
  } else if (Array.isArray(raw?.wellnessData)) {
    days = raw.wellnessData;
  } else {
    return [];
  }

  return days
    .map(parseWellnessDay)
    .filter(Boolean);
}
