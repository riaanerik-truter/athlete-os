// Daily Digest Job
// Cron: 09:00 daily (configurable in user_settings.json)
//
// Flow:
//   1. Get today's readiness score from fitness snapshot or health metrics
//   2. Get today's planned session(s)
//   3. Format a WhatsApp-style digest message
//   4. POST to /conversations as coach message
//      (messaging service picks this up and delivers to WhatsApp)

import pino from 'pino';
import { apiClient } from '../api/client.js';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

// Readiness descriptors
function readinessLabel(score) {
  if (score == null) return null;
  if (score >= 80) return 'excellent';
  if (score >= 65) return 'good';
  if (score >= 50) return 'moderate';
  if (score >= 35) return 'low';
  return 'very low';
}

// TSB → form label
function formLabel(tsb) {
  if (tsb == null) return null;
  if (tsb >= 15)  return 'fresh';
  if (tsb >= 5)   return 'good form';
  if (tsb >= -5)  return 'neutral';
  if (tsb >= -20) return 'some fatigue';
  return 'fatigued';
}

// Session type code → human-friendly name
const SESSION_LABELS = {
  AE1: 'Easy/Recovery',
  AE2: 'Aerobic Endurance',
  Te1: 'Tempo',
  MF1: 'Force Reps (flat)',
  MF2: 'Hill Force Reps',
  MF3: 'Hill Repeats',
  SS1: 'Spin-ups / Strides',
  ME1: 'Cruise Intervals',
  ME4: 'Threshold',
  AC1: 'VO₂max Intervals',
  SP2: 'Sprints',
  T1:  'FTP/FTHR Test',
};

function sessionLabel(code) {
  return SESSION_LABELS[code] ?? code ?? 'Training Session';
}

// ---------------------------------------------------------------------------
// Readiness data
// ---------------------------------------------------------------------------

async function getReadiness() {
  try {
    // Prefer the latest snapshot (calculated Sunday night)
    const snapshot = await apiClient.get('/fitness/snapshot');
    if (snapshot?.readiness_score != null) {
      return {
        score: snapshot.readiness_score,
        tsb:   snapshot.tsb,
        source: 'snapshot',
      };
    }
  } catch { /* fall through */ }

  // Fallback: today's health metrics
  try {
    const result = await apiClient.get('/health/daily?limit=1');
    const today = (result?.data ?? result ?? [])[0];
    if (today?.readiness_score != null) {
      return { score: today.readiness_score, tsb: null, source: 'health_metrics' };
    }
  } catch { /* fall through */ }

  return { score: null, tsb: null, source: null };
}

// ---------------------------------------------------------------------------
// Today's planned sessions
// ---------------------------------------------------------------------------

async function getTodaysSessions() {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const result = await apiClient.get(`/sessions/planned?date=${today}`);
    return result?.data ?? result ?? [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Message formatter
// ---------------------------------------------------------------------------

function formatDigest(readiness, sessions, today) {
  const lines = [];

  // Header
  lines.push(`Good morning. ${today}`);
  lines.push('');

  // Readiness
  if (readiness.score != null) {
    const label  = readinessLabel(readiness.score);
    const form   = formLabel(readiness.tsb);
    const formPart = form ? ` Form: ${form}.` : '';
    lines.push(`Readiness: ${readiness.score}/100 (${label}).${formPart}`);
  } else {
    lines.push('Readiness: no data yet.');
  }

  lines.push('');

  // Sessions
  if (!sessions.length) {
    lines.push('No sessions planned today. Rest day.');
  } else {
    lines.push(sessions.length === 1 ? "Today's session:" : "Today's sessions:");
    for (const s of sessions) {
      const name = sessionLabel(s.session_type_code);
      const dur  = s.target_duration_min ? `${s.target_duration_min}min` : '';
      const tss  = s.target_tss ? `~${s.target_tss} TSS` : '';
      const sport = s.sport ? `(${s.sport})` : '';
      const detail = [dur, tss].filter(Boolean).join(', ');
      lines.push(`• ${name} ${sport}${detail ? ' — ' + detail : ''}`);
      if (s.description) {
        lines.push(`  ${s.description.slice(0, 100)}`);
      }
    }
  }

  lines.push('');
  lines.push('Reply with your RPE and how you feel after the session.');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main job
// ---------------------------------------------------------------------------

/**
 * Generates and posts the daily digest.
 *
 * @param {object} [options]
 * @param {boolean} [options.dryRun=false] - preview only; do not post to /conversations
 * @returns {{ message: string, readiness: object, sessions: Array, posted: boolean }}
 */
export async function runDailyDigest({ dryRun = false } = {}) {
  log.info({ dryRun }, 'daily digest starting');

  const today = new Date().toISOString().slice(0, 10);

  const [readiness, sessions] = await Promise.all([
    getReadiness(),
    getTodaysSessions(),
  ]);

  log.info({
    readinessScore: readiness.score,
    sessionCount: sessions.length,
    today,
  }, 'digest data loaded');

  const message = formatDigest(readiness, sessions, today);

  if (dryRun) {
    return {
      dry_run: true,
      today,
      readiness,
      sessions,
      message,
      posted: false,
    };
  }

  // Post to conversations — messaging service delivers to WhatsApp
  try {
    await apiClient.post('/conversations', { role: 'assistant', content: message });
    log.info('daily digest posted to conversations');
  } catch (err) {
    log.error({ err: err.message }, 'failed to post daily digest');
    return { error: err.message, message, posted: false };
  }

  return {
    dry_run: false,
    today,
    readiness,
    sessions,
    message,
    posted: true,
  };
}
