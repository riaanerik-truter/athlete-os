// Weekly Digest builder
// Sent Sunday evening after snapshot writer completes.
// Matches the template in messaging-service-design.md.

import pino from 'pino';
import { apiClient } from '../api/client.js';
import { sendNotification, activeChannelName } from '../handlers/notificationHandler.js';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

// ---------------------------------------------------------------------------
// Data fetchers
// ---------------------------------------------------------------------------

async function fetchCurrentWeek() {
  try {
    return await apiClient.get('/weeks/current');
  } catch {
    return null;
  }
}

async function fetchSnapshot() {
  try {
    return await apiClient.get('/fitness/snapshot');
  } catch {
    return null;
  }
}

async function fetchNextWeek() {
  // Fetch the upcoming week to show next week's target
  try {
    const season = await apiClient.get('/season');
    if (!season) return null;
    const period = await apiClient.get('/periods/current');
    return period ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Message builder
// ---------------------------------------------------------------------------

export function buildWeeklyDigest(week, snapshot, period) {
  const lines = [];

  const weekNum = week?.week_number ?? '?';
  lines.push(`**Week ${weekNum} complete**`, '');

  // Volume and TSS compliance
  if (week?.planned_duration_min != null && week?.actual_duration_min != null) {
    const plannedHrs = (week.planned_duration_min / 60).toFixed(1);
    const actualHrs  = (week.actual_duration_min  / 60).toFixed(1);
    const volPct     = Math.round((week.actual_duration_min / week.planned_duration_min) * 100);
    const volTick    = volPct >= 90 ? '✅' : volPct >= 75 ? '⚠' : '❌';
    lines.push(`Volume: ${actualHrs} / ${plannedHrs}hrs (${volPct}%) ${volTick}`);
  }

  if (week?.planned_tss != null && week?.actual_tss != null) {
    const tssPct  = Math.round((week.actual_tss / week.planned_tss) * 100);
    const tssTick = tssPct >= 90 ? '✅' : tssPct >= 75 ? '⚠' : '❌';
    lines.push(`TSS: ${week.actual_tss} / ${week.planned_tss} (${tssPct}%) ${tssTick}`);
  }

  lines.push('');

  // Fitness metrics
  if (snapshot) {
    const { ctl, atl, tsb } = snapshot;
    if (ctl != null) lines.push(`Fitness (CTL): ${ctl.toFixed(1)}`);
    if (atl != null) lines.push(`Fatigue (ATL): ${atl.toFixed(1)}`);
    if (tsb != null) lines.push(`Form (TSB): ${tsb.toFixed(1)}`);
    lines.push('');
  }

  // Next week preview
  if (period) {
    const nextWeek = (week?.week_number ?? 0) + 1;
    const periodType = period.period_type ?? 'upcoming';
    lines.push(`Next week: ${periodType}, Week ${nextWeek}.`);
    if (period.target_weekly_tss) lines.push(`TSS target: ${period.target_weekly_tss}.`);
  }

  return lines.join('\n').trim();
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function sendWeeklyDigest() {
  log.info('building weekly digest');

  const [week, snapshot, period] = await Promise.all([
    fetchCurrentWeek(),
    fetchSnapshot(),
    fetchNextWeek(),
  ]);

  const message = buildWeeklyDigest(week, snapshot, period);
  await sendNotification('weekly_summary', message, activeChannelName());
}
