// Morning Digest builder
// Fetches readiness and today's planned session from the API and formats
// the morning check-in message. Matches the template in messaging-service-design.md.
//
// Called by: coaching engine dailyDigest job via POST to notificationHandler,
// OR directly by messaging service index.js on a cron schedule.

import pino from 'pino';
import { apiClient } from '../api/client.js';
import { sendNotification, activeChannelName } from '../handlers/notificationHandler.js';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

// ---------------------------------------------------------------------------
// Data fetchers
// ---------------------------------------------------------------------------

async function fetchReadiness() {
  try {
    return await apiClient.get('/fitness/snapshot');
  } catch {
    return null;
  }
}

async function fetchTodaysSession() {
  try {
    const today = new Date().toISOString().split('T')[0];
    const result = await apiClient.get(`/sessions/planned?date=${today}&limit=1`);
    return result?.data?.[0] ?? null;
  } catch {
    return null;
  }
}

async function fetchDailyHealth() {
  try {
    const today = new Date().toISOString().split('T')[0];
    const result = await apiClient.get(`/health/daily?date=${today}&limit=1`);
    return result?.data?.[0] ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Message builder
// ---------------------------------------------------------------------------

export function buildMorningDigest(snapshot, session, health) {
  const lines = [];

  // Greeting
  lines.push('Good morning. Here\'s your day:', '');

  // Readiness
  if (snapshot?.readiness_score != null) {
    const score = snapshot.readiness_score;
    const arrow = score >= 75 ? '↑' : score >= 50 ? '→' : '↓';
    const label = score >= 75 ? 'Good to train' : score >= 50 ? 'Train with care' : 'Rest recommended';
    lines.push(`**Readiness: ${score}/100** ${arrow} ${label}`, '');
  }

  // Today's session
  if (session) {
    lines.push("Today's session:");
    if (session.session_type_id) lines.push(`• ${session.session_type_id}`);
    if (session.planned_duration_min) lines.push(`• ${session.planned_duration_min}min`);
    if (session.planned_tss)          lines.push(`• Target TSS: ${session.planned_tss}`);
    if (session.notes)                lines.push(`• ${session.notes}`);
    lines.push('');
  } else {
    lines.push('No session planned for today.', '');
  }

  // Health notes
  const notes = [];
  if (health?.sleep_score != null)  notes.push(`Sleep score ${health.sleep_score} last night.`);
  if (health?.hrv_ms != null)       notes.push(`HRV ${health.hrv_ms}ms.`);
  if (health?.body_battery != null) notes.push(`Body battery ${health.body_battery}.`);

  if (notes.length) {
    lines.push('Notes: ' + notes.join(' '));
  }

  // CTL/TSB addendum
  if (snapshot?.ctl != null && snapshot?.tsb != null) {
    const form = snapshot.tsb > 5 ? 'Green light.' : snapshot.tsb < -20 ? 'Carry caution.' : 'HR trending stable. Green light.';
    lines.push(form);
  }

  return lines.join('\n').trim();
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function sendMorningDigest() {
  log.info('building morning digest');

  const [snapshot, session, health] = await Promise.all([
    fetchReadiness(),
    fetchTodaysSession(),
    fetchDailyHealth(),
  ]);

  const message = buildMorningDigest(snapshot, session, health);
  await sendNotification('morning_digest', message, activeChannelName());
}
