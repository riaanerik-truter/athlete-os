import { stravaConfigured, stravaGet } from './stravaClient.js';
import { apiClient } from '../api/client.js';
import { mapSport } from '../utils/sportMapper.js';
import pino from 'pino';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

// Strava activity types → AthleteOS sport
const STRAVA_SPORT_MAP = {
  'Ride': 'cycling',
  'VirtualRide': 'cycling',
  'GravelRide': 'cycling',
  'MountainBikeRide': 'cycling',
  'Run': 'running',
  'TrailRun': 'running',
  'VirtualRun': 'running',
  'Swim': 'swimming',
  'Workout': 'strength',
  'WeightTraining': 'strength',
};

function mapStravaSport(type) {
  return STRAVA_SPORT_MAP[type] ?? null;
}

/**
 * Extracts segment PRs from a Strava activity's segment_efforts array.
 * Returns an array of { segment_id, name, pr_rank } for entries where pr_rank is 1.
 */
function extractSegmentPrs(segmentEfforts) {
  if (!Array.isArray(segmentEfforts)) return null;
  const prs = segmentEfforts
    .filter(e => e.pr_rank === 1)
    .map(e => ({ segment_id: e.segment?.id, name: e.segment?.name, elapsed_time: e.elapsed_time }));
  return prs.length > 0 ? prs : null;
}

/**
 * Builds the payload for POST /sessions/completed from a Strava activity.
 * Only Strava-specific additive fields are populated — Garmin fields left null.
 */
function buildStravaPayload(activity) {
  const sport = mapStravaSport(activity.sport_type ?? activity.type);

  return {
    strava_activity_id:    String(activity.id),
    sport:                 sport ?? 'other',
    activity_date:         activity.start_date ? activity.start_date.split('T')[0] : null,
    start_time:            activity.start_date ?? null,
    duration_sec:          activity.elapsed_time ?? null,
    distance_m:            activity.distance != null ? Math.round(activity.distance) : null,
    avg_hr:                activity.average_heartrate ?? null,
    max_hr:                activity.max_heartrate ?? null,
    avg_power_w:           activity.average_watts ?? null,
    elevation_gain_m:      activity.total_elevation_gain ?? null,
    strava_suffer_score:   activity.suffer_score ?? null,
    strava_relative_effort: activity.relative_effort ?? null,
    segment_prs:           extractSegmentPrs(activity.segment_efforts),
    data_source_primary:   'strava',
  };
}

/**
 * Runs the Strava sync job.
 *
 * Flow:
 * 1. Fetch recent activities from Strava (page by page, up to 7 days back by default)
 * 2. For each activity: POST to /sessions/completed
 *    - 409 → already exists (Garmin-sourced) — PATCH to add Strava additive fields
 *    - 201 → new record created (Strava-only activity, no Garmin match)
 * 3. Update sync_state via PATCH /sync/status/strava
 *
 * @param {{ lookbackDays?: number }} options
 */
export async function runStravaSync({ lookbackDays = 7 } = {}) {
  if (!stravaConfigured()) {
    log.info('strava sync: credentials not configured — skipping');
    return;
  }

  log.info({ lookbackDays }, 'strava sync: starting');

  const afterEpoch = Math.floor((Date.now() - lookbackDays * 86_400_000) / 1000);

  let page = 1;
  let totalFetched = 0;
  let newCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;

  while (true) {
    let activities;
    try {
      activities = await stravaGet('/athlete/activities', {
        after: afterEpoch,
        per_page: 50,
        page,
      });
    } catch (err) {
      log.error({ page, err: err.message }, 'strava sync: failed to fetch activities page');
      break;
    }

    if (!Array.isArray(activities) || activities.length === 0) break;

    totalFetched += activities.length;

    for (const activity of activities) {
      const sport = mapStravaSport(activity.sport_type ?? activity.type);
      if (sport === null) {
        skippedCount++;
        continue;
      }

      const payload = buildStravaPayload(activity);

      try {
        // POST first — if 409 the record exists from Garmin, PATCH additive fields
        const result = await apiClient.post('/sessions', payload);

        if (result === null) {
          // 409 — find the existing session by strava_activity_id and PATCH additive fields
          const stravaFields = {
            strava_activity_id:     payload.strava_activity_id,
            strava_suffer_score:    payload.strava_suffer_score,
            strava_relative_effort: payload.strava_relative_effort,
            segment_prs:            payload.segment_prs,
          };

          // GET session by strava id to get the UUID, then PATCH
          const sessions = await apiClient.get(
            `/sessions?strava_activity_id=${payload.strava_activity_id}`
          );
          if (sessions?.data?.length > 0) {
            const sessionId = sessions.data[0].id;
            await apiClient.patch(`/sessions/${sessionId}`, stravaFields);
            updatedCount++;
          } else {
            skippedCount++;
          }
        } else {
          newCount++;
        }
      } catch (err) {
        log.warn({ activityId: activity.id, err: err.message }, 'strava sync: failed to write activity');
      }
    }

    // Strava returns fewer than per_page on the last page
    if (activities.length < 50) break;
    page++;
  }

  log.info({ totalFetched, newCount, updatedCount, skippedCount }, 'strava sync: complete');

  // Update sync state
  try {
    await apiClient.patch('/sync/status/strava', {
      status: 'ok',
      last_synced_at: new Date().toISOString(),
      last_item_id: null,
    });
  } catch (err) {
    log.warn({ err: err.message }, 'strava sync: failed to update sync state');
  }
}
