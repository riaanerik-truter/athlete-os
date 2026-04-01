/**
 * Resolves field conflicts between Garmin and Strava for the same activity.
 *
 * Rules:
 * - Garmin is authoritative for: duration, distance, avg_hr, max_hr, avg_power,
 *   normalized_power, tss (when calculated), elevation, calories, avg_cadence, avg_speed.
 * - Strava contributes: suffer_score, relative_effort, segment_prs (additive fields only).
 * - EF: stored as both ef_garmin_calculated and ef_trainingpeaks; ef_source_used set by caller.
 * - TSS: TrainingPeaks authoritative when present; Garmin estimate used as fallback.
 */

/**
 * Merges a Garmin-parsed session payload with additive Strava fields.
 * Returns a single merged object safe to POST to the API.
 *
 * @param {object} garmin  - Output of garminActivityParser
 * @param {object} strava  - Output of stravaSync for the matched activity (may be null)
 * @returns {object}
 */
export function mergeGarminStrava(garmin, strava) {
  if (!strava) return garmin;

  return {
    ...garmin,
    // Strava-only additive fields
    strava_activity_id: strava.strava_activity_id ?? null,
    suffer_score: strava.suffer_score ?? null,
    relative_effort: strava.relative_effort ?? null,
    segment_prs: strava.segment_prs ?? null,
  };
}

/**
 * Merges TrainingPeaks CSV fields into a Garmin-parsed session payload.
 * TP is authoritative for TSS, CTL, ATL, TSB, IF, EF, VI, compliance_score.
 *
 * @param {object} garmin  - Output of garminActivityParser (or mergeGarminStrava result)
 * @param {object} tp      - Output of tpCsvParser for matched row (may be null)
 * @returns {object}
 */
export function mergeTrainingPeaks(garmin, tp) {
  if (!tp) return garmin;

  return {
    ...garmin,
    tp_workout_id: tp.tp_workout_id ?? null,
    tss: tp.tss ?? garmin.tss ?? null,           // TP authoritative; Garmin as fallback
    intensity_factor: tp.intensity_factor ?? null,
    variability_index: tp.variability_index ?? null,
    ef_trainingpeaks: tp.ef ?? null,
    compliance_score: tp.compliance_score ?? null,
    ef_source_used: tp.ef != null ? 'trainingpeaks' : (garmin.ef_garmin_calculated != null ? 'garmin' : null),
  };
}
