// Plan Revision builder
// Sent when the coaching engine revises the training plan —
// e.g. swapped sessions, volume reduction, period extension.
// Scale threshold: 3.

import pino from 'pino';
import { sendNotification, activeChannelName } from '../handlers/notificationHandler.js';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

// ---------------------------------------------------------------------------
// Message builder
// ---------------------------------------------------------------------------

/**
 * @param {object} revision
 * @param {string}   revision.trigger     - what caused the revision (e.g. 'low_readiness')
 * @param {string}   revision.severity    - 'minor' | 'moderate' | 'major'
 * @param {string[]} revision.changes     - list of human-readable change descriptions
 * @param {string}   [revision.reason]    - optional additional context
 */
export function buildPlanRevision({ trigger, severity, changes, reason }) {
  const icon  = severity === 'major' ? '⚠' : severity === 'moderate' ? '📋' : 'ℹ';
  const label = severity === 'major' ? 'Major plan revision'
              : severity === 'moderate' ? 'Plan updated'
              : 'Minor plan adjustment';

  const lines = [`${icon} **${label}**`, ''];

  const triggerLabel = {
    low_readiness:    'Low readiness score',
    missed_sessions:  'Missed sessions',
    high_decoupling:  'High aerobic decoupling',
    hrv_decline:      'HRV decline trend',
    tss_deviation:    'TSS off target',
  }[trigger] ?? trigger;

  lines.push(`Reason: ${triggerLabel}`);
  if (reason) lines.push(reason);
  lines.push('');
  lines.push('Changes:');
  changes.forEach(c => lines.push(`• ${c}`));

  if (severity === 'major') {
    lines.push('', 'Reply if you have questions about the revised plan.');
  }

  return lines.join('\n').trim();
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function sendPlanRevision(revision) {
  log.info({ trigger: revision.trigger, severity: revision.severity }, 'sending plan revision notification');
  const message = buildPlanRevision(revision);
  await sendNotification('plan_revision', message, activeChannelName());
}
