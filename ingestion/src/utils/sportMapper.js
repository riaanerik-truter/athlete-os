// Maps Garmin activityType.typeKey values to AthleteOS sport strings.
// SKIP_TYPES: activity types that should never be ingested.

export const SPORT_MAP = {
  // Cycling
  'cycling': 'cycling',
  'road_biking': 'cycling',
  'gravel_cycling': 'cycling',
  'virtual_ride': 'cycling',
  'indoor_cycling': 'cycling',

  // MTB
  'mountain_biking': 'mtb',
  'mountain_bike': 'mtb',

  // Running
  'running': 'running',
  'trail_running': 'running',
  'treadmill_running': 'running',
  'track_running': 'running',
  'obstacle_run': 'running',

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

  // Other training activities
  'indoor_cardio': 'other',
  'indoor_rowing': 'other',
  'rowing_v2': 'other',
  'rowing': 'other',
  'hiit': 'other',
  'floor_climbing': 'other',
  'elliptical': 'other',
  'stair_climbing': 'other',
  'cardio': 'other',
  'cross_country_skiing_ws': 'other',
  'cross_country_skiing': 'other',
  'skating': 'other',
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
  // Non-training activities
  'transition_v2',
  'transition',
  'surfing_v2',
  'surfing',
  'boating_v2',
  'boating',
  'snorkeling',
  'resort_skiing_snowboarding_ws',
  'resort_skiing_snowboarding',
  'cricket',
  'rugby',
  'tennis_v2',
  'tennis',
  'soccer',
  'basketball',
  'sailing',
  'hunting',
  'fishing',
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
