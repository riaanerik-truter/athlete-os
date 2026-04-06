import { mapSport } from '../utils/sportMapper.js';

/**
 * HRV status derivation from feedbackLong string in TrainingReadinessDTO.
 * Garmin does not expose a discrete hrv_status field in the export.
 */
const HRV_KEYWORD_MAP = [
  { keywords: ['excellent', 'well rested', 'high'], status: 'excellent' },
  { keywords: ['good', 'recovered', 'positive'], status: 'good' },
  { keywords: ['balanced', 'moderate', 'average'], status: 'balanced' },
  { keywords: ['low', 'poor', 'depleted', 'tired'], status: 'low' },
  { keywords: ['very low', 'very poor', 'exhausted'], status: 'very_low' },
];

function deriveHrvStatus(feedbackLong) {
  if (!feedbackLong) return null;
  const lower = feedbackLong.toLowerCase();
  for (const { keywords, status } of HRV_KEYWORD_MAP) {
    if (keywords.some(k => lower.includes(k))) return status;
  }
  return null;
}

/**
 * Parses a single activity object from summarizedActivities.json.
 *
 * Unit corrections applied:
 * - duration: Garmin exports milliseconds → convert to seconds
 * - distance: Garmin exports centimetres → convert to metres
 * - avgSpeed: Garmin top-level value is 10× too small (confirmed against splitSummaries)
 *             → multiply by 10. Unit is then m/s.
 *
 * Returns null if the sport type should be skipped.
 *
 * @param {object} raw - Single entry from summarizedActivities array
 * @returns {object|null}
 */
export function parseGarminActivity(raw) {
  // activityType is a plain string in the summarizedActivities export (e.g. "road_biking").
  // Older individual exports may use { typeKey: "..." } — handle both.
  const typeKey = typeof raw.activityType === 'string'
    ? raw.activityType
    : (raw.activityType?.typeKey ?? null);
  const sport = mapSport(typeKey);
  if (sport === null) return null;

  // Duration: ms → seconds
  const durationSeconds = raw.duration != null ? Math.round(raw.duration / 1000) : null;

  // Distance: cm → metres
  const distanceMetres = raw.distance != null ? Math.round(raw.distance / 100) : null;

  // avgSpeed: top-level is 10× too small — multiply by 10 to get m/s
  // Verified: distance_m / duration_s ≈ avgSpeed * 10
  const avgSpeedMs = raw.avgSpeed != null ? raw.avgSpeed * 10 : null;

  // Elevation: in centimetres in the export → convert to metres
  // Verified: minElevation/maxElevation values match expected geography when divided by 100
  const elevationGain = raw.elevationGain != null ? Math.round(raw.elevationGain / 100) : null;

  // Field names in summarizedActivities export (verified against actual sample data):
  // avgHr (not averageHR), maxHr (not maxHR),
  // avgBikeCadence (not averageBikingCadenceInRevPerMinute),
  // avgRunCadence (not averageRunningCadenceInStepsPerMinute)
  const avgHr = raw.avgHr ?? null;
  const avgPowerW = raw.avgPower != null ? Math.round(raw.avgPower) : null;
  const normalizedPowerW = raw.normPower != null ? Math.round(raw.normPower) : null;

  // EF (efficiency factor): use normalised power when available so the value
  // is comparable with ef_trainingpeaks (which always uses NP).
  // Fall back to avg power when NP is absent (e.g. runs, swims, no power meter).
  const efPower = (normalizedPowerW != null && normalizedPowerW > 0) ? normalizedPowerW : avgPowerW;
  const efGarmin = efPower != null && avgHr != null && avgHr > 0
    ? Math.round((efPower / avgHr) * 10000) / 10000
    : null;

  // Timestamps:
  // startTimeGmt — epoch ms in UTC → start_time (ISO with Z offset, accepted by Zod datetime+offset)
  // startTimeLocal — epoch ms with TZ offset applied → derive activity_date (local calendar date)
  const startTimeMs = raw.startTimeGmt ?? raw.startTimeGMT ?? null;
  const startTimeLocalMs = raw.startTimeLocal ?? startTimeMs;
  const startTime = startTimeMs != null ? new Date(startTimeMs).toISOString() : null;
  // activity_date: take the date portion from local time representation
  const activityDate = startTimeLocalMs != null
    ? new Date(startTimeLocalMs).toISOString().split('T')[0]
    : null;

  // end_time: NOT NULL in DB — derive from start + duration
  const endTime = startTimeMs != null && durationSeconds != null
    ? new Date(startTimeMs + durationSeconds * 1000).toISOString()
    : null;

  // Zone distribution: HR zones hrTimeInZone_0..6 (ms → seconds)
  // and power zones powerTimeInZone_0..7 (ms → seconds)
  // Friel HR zones: Z1=idx0, Z2=idx1, Z3=idx2, Z4=idx3, Z5a=idx4, Z5b=idx5, Z5c=idx6
  // Power zones: pZ1..pZ8 (Coggan 8-zone model from Garmin)
  const hrZoneKeys  = ['Z1','Z2','Z3','Z4','Z5a','Z5b','Z5c'];
  const pwrZoneKeys = ['pZ1','pZ2','pZ3','pZ4','pZ5','pZ6','pZ7','pZ8'];

  const zoneDistribution = {};
  let hasZones = false;

  for (let i = 0; i < 7; i++) {
    const ms = raw[`hrTimeInZone_${i}`];
    if (ms != null && ms > 0) {
      zoneDistribution[hrZoneKeys[i]] = Math.round(ms / 1000);
      hasZones = true;
    }
  }
  for (let i = 0; i < 8; i++) {
    const ms = raw[`powerTimeInZone_${i}`];
    if (ms != null && ms > 0) {
      zoneDistribution[pwrZoneKeys[i]] = Math.round(ms / 1000);
      hasZones = true;
    }
  }

  // Variability index: NP / avg power (>1 means more variable effort)
  const variabilityIndex = normalizedPowerW != null && avgPowerW != null && avgPowerW > 0
    ? Math.round((normalizedPowerW / avgPowerW) * 1000) / 1000
    : null;

  // TSS: activityTrainingLoad is the correct field in summarizedActivities export
  // (trainingStressScore does not exist in bulk export — only in TP-synced data)
  const tss = raw.activityTrainingLoad ?? raw.trainingStressScore ?? null;

  // session_notes: store the location name when available
  const sessionNotes = raw.locationName ?? null;

  // Build payload and strip null/undefined values so Zod optional fields
  // don't receive explicit nulls (which fail z.number() validation).
  const payload = {
    garmin_activity_id:   String(raw.activityId),
    sport,
    activity_date:        activityDate,
    start_time:           startTime,
    end_time:             endTime,
    duration_sec:         durationSeconds,
    distance_m:           distanceMetres,
    avg_speed_ms:         avgSpeedMs,
    elevation_gain_m:     elevationGain,
    avg_hr:               avgHr,
    max_hr:               raw.maxHr ?? null,
    avg_power_w:          avgPowerW,
    normalized_power_w:   normalizedPowerW,
    avg_cadence:          raw.avgBikeCadence ?? raw.avgRunCadence ?? null,
    tss:                  tss,
    variability_index:    variabilityIndex,
    zone_distribution:    hasZones ? zoneDistribution : null,
    session_notes:        sessionNotes,
    ef_garmin_calculated: efGarmin,
    ef_source_used:       efGarmin != null ? 'garmin' : null,
    data_source_primary:  'garmin',
  };

  // Strip nulls — Zod optional fields reject explicit null values
  return Object.fromEntries(Object.entries(payload).filter(([, v]) => v != null));
}
