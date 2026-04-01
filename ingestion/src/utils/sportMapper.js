// Maps Garmin activityType.typeKey values to AthleteOS sport strings.
// SKIP_TYPES: activity types that should never be ingested.

export const SPORT_MAP = {
  // Cycling
  'cycling': 'cycling',
  'road_biking': 'cycling',
  'mountain_biking': 'cycling',
  'gravel_cycling': 'cycling',
  'virtual_ride': 'cycling',
  'indoor_cycling': 'cycling',

  // Running
  'running': 'running',
  'trail_running': 'running',
  'treadmill_running': 'running',
  'track_running': 'running',

  // Swimming
  'swimming': 'swimming',
  'open_water_swimming': 'swimming',
  'lap_swimming': 'swimming',

  // Strength
  'strength_training': 'strength',
  'fitness_equipment': 'strength',

  // Brick / multisport
  'multi_sport': 'brick',
  'triathlon': 'brick',
};

// Garmin activity types to skip entirely (not ingested into AthleteOS)
export const SKIP_TYPES = new Set([
  'walking',
  'casual_walking',
  'speed_walking',
  'hiking',
  'rock_climbing',
  'yoga',
  'pilates',
  'breathwork',
  'golf',
  'other',
  'uncategorized',
]);

/**
 * Returns the AthleteOS sport string for a Garmin typeKey, or null if skipped/unmapped.
 * @param {string} typeKey
 * @returns {string|null}
 */
export function mapSport(typeKey) {
  if (!typeKey) return null;
  const key = typeKey.toLowerCase();
  if (SKIP_TYPES.has(key)) return null;
  return SPORT_MAP[key] ?? null;
}
