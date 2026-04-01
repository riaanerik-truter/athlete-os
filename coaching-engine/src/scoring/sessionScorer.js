// Session Scorer
// Two scoring systems as defined in the design doc:
//   1. Friel / Triathlon Bible: zone_value × minutes in zone
//   2. Daniels: points per minute by pace zone (running only)
//
// Scores are written to session_score via POST /diary/:date/score.

// ---------------------------------------------------------------------------
// Friel zone scoring
// Zone value × minutes. Z5a/b/c all score as 5.
// ---------------------------------------------------------------------------

const FRIEL_ZONE_WEIGHTS = {
  Z1:  1,
  Z2:  2,
  Z3:  3,
  Z4:  4,
  Z5a: 5,
  Z5b: 5,
  Z5c: 5,
};

/**
 * Calculates the Friel training score from a zone distribution object.
 *
 * @param {object} zoneDistribution - { Z1: minutes, Z2: minutes, ... }
 * @returns {number|null} Friel score, or null if no zone data
 */
export function calcFrielScore(zoneDistribution) {
  if (!zoneDistribution || typeof zoneDistribution !== 'object') return null;

  const entries = Object.entries(zoneDistribution);
  if (!entries.length) return null;

  const score = entries.reduce((sum, [zone, minutes]) => {
    const weight = FRIEL_ZONE_WEIGHTS[zone] ?? 0;
    return sum + weight * Number(minutes);
  }, 0);

  return Math.round(score * 100) / 100;
}

// ---------------------------------------------------------------------------
// Daniels pace zone scoring (running only)
// ---------------------------------------------------------------------------

const DANIELS_POINTS_PER_MIN = {
  E:   0.2,  // Easy / Long
  M:   0.4,  // Marathon pace
  T:   0.6,  // Threshold
  '10K': 0.8,
  I:   1.0,  // Interval / VO2max
  R:   1.5,  // Repetition
  FR:  2.0,  // Fast repetition
};

/**
 * Calculates Daniels training points from a pace zone distribution.
 * Only applicable to running sessions.
 *
 * @param {object} paceZoneDistribution - { E: minutes, T: minutes, I: minutes, ... }
 * @param {string} sport - only 'running' sessions should use Daniels
 * @returns {number|null} Daniels points, or null if not applicable
 */
export function calcDanielsPoints(paceZoneDistribution, sport) {
  if (sport !== 'running') return null;
  if (!paceZoneDistribution || typeof paceZoneDistribution !== 'object') return null;

  const entries = Object.entries(paceZoneDistribution);
  if (!entries.length) return null;

  const points = entries.reduce((sum, [zone, minutes]) => {
    const rate = DANIELS_POINTS_PER_MIN[zone] ?? 0;
    return sum + rate * Number(minutes);
  }, 0);

  return Math.round(points * 100) / 100;
}

// ---------------------------------------------------------------------------
// Score a session from its completed_session record
// ---------------------------------------------------------------------------

/**
 * Derives scoring inputs from a completed_session record and returns
 * the score payload ready for POST /diary/:date/score.
 *
 * zone_distribution on the session is expected to be in minutes-per-zone:
 *   { Z1: 45.2, Z2: 120.1, ... }  (Friel HR/power zones)
 * OR for running pace zones:
 *   { E: 60, T: 20, I: 10, ... }
 *
 * @param {object} session - completed_session row from the API
 * @param {string|null} methodologyId - UUID of active methodology
 * @returns {object} score payload
 */
export function scoreSession(session, methodologyId = null) {
  const zones = session.zone_distribution ?? null;
  const sport = session.sport;

  // Determine which zone schema we have — Friel keys (Z1/Z2...) vs Daniels (E/T/I...)
  const isFrielZones   = zones && Object.keys(zones).some(k => k.startsWith('Z'));
  const isDanielsZones = zones && sport === 'running' && Object.keys(zones).some(k => DANIELS_POINTS_PER_MIN[k] !== undefined);

  const frielScore    = isFrielZones   ? calcFrielScore(zones)              : null;
  const danielsPoints = isDanielsZones ? calcDanielsPoints(zones, sport)    : null;

  return {
    methodology_id:  methodologyId,
    tss:             session.tss             ? Number(session.tss) : null,
    friel_score:     frielScore,
    daniels_points:  danielsPoints,
    score_breakdown: {
      zone_distribution: zones,
      scoring_method:    isFrielZones ? 'friel' : isDanielsZones ? 'daniels' : 'tss_only',
      sport
    }
  };
}
