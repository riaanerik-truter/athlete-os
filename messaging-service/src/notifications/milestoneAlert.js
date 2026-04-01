// Milestone Alert builder
// Triggered when a new FTP, VDOT, or CSS is recorded that improves on the last test.
// Scale threshold: 2.
// Matches the template in messaging-service-design.md.

import pino from 'pino';
import { apiClient } from '../api/client.js';
import { sendNotification, activeChannelName } from '../handlers/notificationHandler.js';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

// ---------------------------------------------------------------------------
// Message builders — one per anchor type
// ---------------------------------------------------------------------------

export function buildFtpMilestone({ ftp, ftpPrev, fthr, weightKg }) {
  const delta   = ftp - ftpPrev;
  const wPerKg  = weightKg ? (ftp / weightKg).toFixed(2) : null;

  const lines = [
    '🎯 **New FTP recorded**',
    '',
    "Today's T1 test result:",
    `• FTP: ${ftp}W (+${delta}W from last test)`,
  ];
  if (fthr)   lines.push(`• FTHR: ${fthr}bpm`);
  if (wPerKg) lines.push(`• W/kg: ${wPerKg}${weightKg ? ` (at ${weightKg}kg)` : ''}`);
  lines.push(
    '',
    'Training zones updated. Well done —',
    'consistent Z2 work is paying off.',
  );

  return lines.join('\n').trim();
}

export function buildVdotMilestone({ vdot, vdotPrev }) {
  const delta = (vdot - vdotPrev).toFixed(1);
  return [
    '🎯 **New VDOT recorded**',
    '',
    "Today's test result:",
    `• VDOT: ${vdot} (+${delta} from last test)`,
    '',
    'Running pace zones updated.',
    'Your aerobic base is translating into race-pace fitness.',
  ].join('\n').trim();
}

export function buildCssMilestone({ css, cssPrev }) {
  // CSS is pace per 100m — lower is faster
  const delta = (cssPrev - css).toFixed(1);
  return [
    '🎯 **New CSS recorded**',
    '',
    "Today's broken kilometer result:",
    `• CSS: ${css}s/100m (−${delta}s from last test)`,
    '',
    'Swim zones updated. Strong improvement.',
  ].join('\n').trim();
}

// ---------------------------------------------------------------------------
// Entry point — call with the test result data
// ---------------------------------------------------------------------------

/**
 * @param {'ftp'|'vdot'|'css'} type
 * @param {object} data   - anchor-specific fields (see builders above)
 */
export async function sendMilestoneAlert(type, data) {
  log.info({ type }, 'sending milestone alert');

  let message;
  switch (type) {
    case 'ftp':  message = buildFtpMilestone(data);  break;
    case 'vdot': message = buildVdotMilestone(data); break;
    case 'css':  message = buildCssMilestone(data);  break;
    default:
      log.warn({ type }, 'unknown milestone type — skipping');
      return;
  }

  await sendNotification('milestone', message, activeChannelName());
}
