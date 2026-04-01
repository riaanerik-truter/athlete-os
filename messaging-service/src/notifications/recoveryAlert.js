// Recovery Alert builder
// Triggered when HRV has declined for multiple consecutive days.
// Scale threshold: 1 — always sent unless proactive_scale is 0.
// Matches the template in messaging-service-design.md.

import pino from 'pino';
import { apiClient } from '../api/client.js';
import { sendNotification, activeChannelName } from '../handlers/notificationHandler.js';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

// ---------------------------------------------------------------------------
// HRV trend detector
// ---------------------------------------------------------------------------

async function fetchRecentHrv(days = 5) {
  try {
    const result = await apiClient.get(`/health/daily?limit=${days}`);
    return (result?.data ?? [])
      .filter(d => d.hrv_ms != null)
      .sort((a, b) => new Date(a.recorded_date) - new Date(b.recorded_date));
  } catch {
    return [];
  }
}

/**
 * Returns { declining: boolean, streak: number, values: number[] }
 * declining = true if HRV has dropped for at least `minStreak` consecutive days.
 */
export function detectHrvDecline(records, minStreak = 3) {
  if (records.length < minStreak) return { declining: false, streak: 0, values: [] };

  const values = records.map(r => r.hrv_ms);
  let streak = 1;
  for (let i = values.length - 1; i > 0; i--) {
    if (values[i] < values[i - 1]) streak++;
    else break;
  }

  return { declining: streak >= minStreak, streak, values };
}

// ---------------------------------------------------------------------------
// Message builder
// ---------------------------------------------------------------------------

export function buildRecoveryAlert(hrvValues, streak, swappedSession = null) {
  const trend = hrvValues.join(' → ') + 'ms';
  const lines = [
    '⚠ **Recovery alert**',
    '',
    `Your HRV has declined for ${streak} consecutive days`,
    `(${trend}). This pattern suggests accumulated fatigue.`,
    '',
  ];

  if (swappedSession) {
    lines.push(
      `I've swapped tomorrow's ${swappedSession.original} for`,
      `an AE1 recovery ride (45min, Z1 only).`,
      '',
    );
  }

  lines.push(
    'Consider: extra sleep tonight, reduce stress',
    'where possible, light nutrition focus.',
  );

  return lines.join('\n').trim();
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function sendRecoveryAlert(swappedSession = null) {
  log.info('checking HRV trend for recovery alert');

  const records = await fetchRecentHrv(5);
  const { declining, streak, values } = detectHrvDecline(records);

  if (!declining) {
    log.debug('no HRV decline detected — recovery alert skipped');
    return;
  }

  log.info({ streak, values }, 'HRV decline detected — sending recovery alert');
  const message = buildRecoveryAlert(values, streak, swappedSession);
  await sendNotification('recovery_alert', message, activeChannelName());
}
