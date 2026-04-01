// EF and Aerobic Decoupling Calculator
//
// Efficiency Factor (EF) = Normalised Power / Average HR
//   — measures aerobic fitness; higher = more efficient at same HR
//   — typically 1.0–1.6 for trained cyclists, varies by sport
//
// Aerobic Decoupling = EF drift between first and second half of a session
//   — compares EF(first half) vs EF(second half)
//   — target: < 5% for base period (indicates solid aerobic base)
//   — > 7% triggers a review flag in the plan revision engine

// ---------------------------------------------------------------------------
// EF from session summary fields
// ---------------------------------------------------------------------------

/**
 * Calculates EF from a session's power and HR fields.
 * Uses normalised power when available so the result is comparable with
 * ef_trainingpeaks (which always uses NP). Falls back to avg power when NP
 * is absent (runs, swims, sessions without a power meter).
 *
 * @param {number|null} normalizedPowerW - preferred; use when > 0
 * @param {number|null} avgPowerW        - fallback
 * @param {number|null} avgHr
 * @returns {{ ef: number|null, power_source: 'normalized'|'avg'|null }}
 */
export function calcEF(normalizedPowerW, avgPowerW, avgHr) {
  if (!avgHr || avgHr === 0) return { ef: null, power_source: null };

  const useNP = normalizedPowerW != null && normalizedPowerW > 0;
  const power = useNP ? normalizedPowerW : avgPowerW;

  if (power == null || power === 0) return { ef: null, power_source: null };

  return {
    ef:           Math.round((power / avgHr) * 10000) / 10000,
    power_source: useNP ? 'normalized' : 'avg',
  };
}

// ---------------------------------------------------------------------------
// Aerobic decoupling from lap or stream data
// ---------------------------------------------------------------------------

/**
 * Calculates aerobic decoupling from two half-session EF values.
 *
 * Formula: ((EF_first - EF_second) / EF_first) * 100
 * Positive = decoupling (EF falling = HR drifting up relative to power)
 * Negative = coupling improvement (unusual but possible in first half warm-up)
 *
 * @param {number} efFirstHalf
 * @param {number} efSecondHalf
 * @returns {number|null} decoupling % rounded to 2 decimal places
 */
export function calcDecoupling(efFirstHalf, efSecondHalf) {
  if (!efFirstHalf || efFirstHalf === 0) return null;
  const pct = ((efFirstHalf - efSecondHalf) / efFirstHalf) * 100;
  return Math.round(pct * 100) / 100;
}

/**
 * Calculates EF and decoupling from a stream of power and HR data points.
 * Splits the stream at the midpoint by data points (not time).
 *
 * @param {Array<{power_w: number, hr: number}>} stream
 *   Array of stream points. Each must have power_w and hr.
 * @returns {{ ef: number|null, decoupling_pct: number|null, ef_first: number|null, ef_second: number|null }}
 */
export function calcEFFromStream(stream) {
  if (!stream?.length) {
    return { ef: null, decoupling_pct: null, ef_first: null, ef_second: null };
  }

  // Filter to points where both power and HR are valid
  const valid = stream.filter(p => p.power_w > 0 && p.hr > 0);
  if (valid.length < 10) {
    return { ef: null, decoupling_pct: null, ef_first: null, ef_second: null };
  }

  const mid    = Math.floor(valid.length / 2);
  const first  = valid.slice(0, mid);
  const second = valid.slice(mid);

  const efOverHalf = (points) => {
    const avgPower = points.reduce((s, p) => s + p.power_w, 0) / points.length;
    const avgHr    = points.reduce((s, p) => s + p.hr, 0)    / points.length;
    return calcEF(null, avgPower, avgHr).ef;  // stream points have no NP — use avg
  };

  const efFirst  = efOverHalf(first);
  const efSecond = efOverHalf(second);
  const efTotal  = efOverHalf(valid);

  return {
    ef:             efTotal,
    ef_first:       efFirst,
    ef_second:      efSecond,
    decoupling_pct: calcDecoupling(efFirst, efSecond),
  };
}

/**
 * Calculates EF and decoupling from the two lap_summary halves.
 * Used when stream data is not available but lap data is.
 *
 * @param {Array} laps - array of lap_summary rows from the API
 * @returns {{ ef: number|null, decoupling_pct: number|null }}
 */
export function calcEFFromLaps(laps) {
  if (!laps?.length) return { ef: null, decoupling_pct: null };

  const mid    = Math.floor(laps.length / 2);
  const first  = laps.slice(0, mid);
  const second = laps.slice(mid);

  const efOverLaps = (group) => {
    const withData = group.filter(l => l.avg_power_w > 0 && l.avg_hr > 0);
    if (!withData.length) return null;
    const avgNP    = withData.reduce((s, l) => s + Number(l.normalized_power_w ?? 0), 0) / withData.length;
    const avgPower = withData.reduce((s, l) => s + Number(l.avg_power_w), 0) / withData.length;
    const avgHr    = withData.reduce((s, l) => s + Number(l.avg_hr), 0)    / withData.length;
    return calcEF(avgNP > 0 ? avgNP : null, avgPower, avgHr).ef;
  };

  const efFirst  = efOverLaps(first);
  const efSecond = efOverLaps(second);
  const efAll    = efOverLaps(laps);

  return {
    ef:             efAll,
    ef_first:       efFirst,
    ef_second:      efSecond,
    decoupling_pct: calcDecoupling(efFirst, efSecond),
  };
}

// ---------------------------------------------------------------------------
// Decoupling interpretation
// ---------------------------------------------------------------------------

/**
 * Returns a flag and message for a given decoupling percentage.
 * Used by the plan revision engine.
 *
 * @param {number|null} decouplingPct
 * @param {string} periodType - 'base', 'build', 'peak', etc.
 * @returns {{ flag: string, message: string }}
 */
export function interpretDecoupling(decouplingPct, periodType = 'base') {
  if (decouplingPct === null) return { flag: 'unknown', message: 'No decoupling data' };

  if (decouplingPct < 0) {
    return { flag: 'excellent', message: `Decoupling ${decouplingPct.toFixed(1)}% — negative coupling (improving efficiency through session)` };
  }
  if (decouplingPct < 5) {
    return { flag: periodType === 'base' ? 'base_ready' : 'good', message: `Decoupling ${decouplingPct.toFixed(1)}% — aerobic base solid` };
  }
  if (decouplingPct < 7) {
    return { flag: 'marginal', message: `Decoupling ${decouplingPct.toFixed(1)}% — aerobic system under mild stress` };
  }
  return { flag: 'high', message: `Decoupling ${decouplingPct.toFixed(1)}% — high cardiac drift, review Z2 intensity` };
}
