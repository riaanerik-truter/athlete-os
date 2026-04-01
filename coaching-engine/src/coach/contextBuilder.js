// Context Builder
// Assembles the API context window for each Anthropic call based on context_mode.
//
// Modes (from user_settings.json):
//   lean     ~1000 tokens  — system + last 5 messages + basic athlete profile
//   balanced ~2900 tokens  — system + last 10 messages + summary + snapshot + current week
//   full     ~5000 tokens  — system + last 20 messages + summary + full snapshot + period + diary + knowledge
//
// Token estimation: rough 4 chars per token approximation for pre-call budgeting.
// Actual token counts returned from the Anthropic API after each call.

import { apiClient } from '../api/client.js';
import { SYSTEM_PROMPT } from './systemPrompt.js';

// ---------------------------------------------------------------------------
// Role mapper — Anthropic only accepts 'user' or 'assistant'
// DB stores 'athlete' / 'coach' / 'system'; map before sending to API
// ---------------------------------------------------------------------------

function mapToAnthropicRole(role) {
  return (role === 'user' || role === 'athlete') ? 'user' : 'assistant';
}

function normaliseMessages(messages) {
  return messages
    .filter(m => m.role !== 'system')
    .map(m => ({ role: mapToAnthropicRole(m.role), content: m.content }));
}

// ---------------------------------------------------------------------------
// Token estimation (pre-call budget check only)
// ---------------------------------------------------------------------------

function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

function countTokens(obj) {
  return estimateTokens(JSON.stringify(obj));
}

// ---------------------------------------------------------------------------
// Section builders — produce formatted strings for injection
// ---------------------------------------------------------------------------

function buildAthleteSection(athlete) {
  if (!athlete) return '';
  return [
    `Athlete: ${athlete.name ?? 'Unknown'}`,
    athlete.primary_sport    ? `Primary sport: ${athlete.primary_sport}` : null,
    athlete.active_sports    ? `Active sports: ${athlete.active_sports}` : null,
    athlete.ftp_watts        ? `FTP: ${athlete.ftp_watts}W` : null,
    athlete.vdot             ? `VDOT: ${athlete.vdot}` : null,
    athlete.css_per_100m_sec ? `CSS: ${athlete.css_per_100m_sec}s/100m` : null,
    athlete.fthr_cycling     ? `FTHR cycling: ${athlete.fthr_cycling}bpm` : null,
    athlete.fthr_running     ? `FTHR running: ${athlete.fthr_running}bpm` : null,
    athlete.limiter          ? `Training limiter: ${athlete.limiter}` : null,
    athlete.methodology_name ? `Methodology: ${athlete.methodology_name}` : null,
    athlete.weight_kg        ? `Weight: ${athlete.weight_kg}kg` : null,
  ].filter(Boolean).join('\n');
}

function buildSnapshotSection(snapshot) {
  if (!snapshot) return 'No fitness snapshot available.';
  return [
    `Snapshot date: ${snapshot.snapshot_date}`,
    snapshot.ctl             !== null ? `CTL (fitness): ${snapshot.ctl}` : null,
    snapshot.atl             !== null ? `ATL (fatigue): ${snapshot.atl}` : null,
    snapshot.tsb             !== null ? `TSB (form): ${snapshot.tsb}` : null,
    snapshot.ftp_current     !== null ? `FTP: ${snapshot.ftp_current}W` : null,
    snapshot.vdot_current    !== null ? `VDOT: ${snapshot.vdot_current}` : null,
    snapshot.readiness_score !== null ? `Readiness: ${snapshot.readiness_score}/100` : null,
    snapshot.ef_trend        !== null ? `EF trend: ${snapshot.ef_trend}` : null,
    snapshot.decoupling_last_long !== null
      ? `Last long ride decoupling: ${snapshot.decoupling_last_long}%` : null,
    snapshot.weekly_volume_hrs !== null
      ? `Weekly volume: ${snapshot.weekly_volume_hrs}hrs` : null,
    snapshot.weekly_tss        !== null ? `Weekly TSS: ${snapshot.weekly_tss}` : null,
  ].filter(Boolean).join('\n');
}

function buildWeekSection(week) {
  if (!week) return 'No current week data.';
  const lines = [
    `Current week: ${week.start_date} → ${week.end_date}  (${week.week_type ?? 'build'})`,
    week.planned_volume_hrs !== null
      ? `Planned: ${week.planned_volume_hrs}hrs / ${week.planned_tss ?? '?'} TSS` : null,
    week.actual_volume_hrs  !== null
      ? `Actual:  ${week.actual_volume_hrs}hrs / ${week.actual_tss ?? '?'} TSS` : null,
    week.compliance_pct     !== null ? `Compliance: ${week.compliance_pct}%` : null,
  ].filter(Boolean);
  if (week.sessions?.length) {
    lines.push('Sessions:');
    for (const s of week.sessions) {
      lines.push(`  ${s.scheduled_date} ${s.sport} ${s.title} ${s.target_duration_min ?? '?'}min [${s.status}]`);
    }
  }
  return lines.join('\n');
}

function buildPeriodSection(period) {
  if (!period) return 'No active period.';
  return [
    `Period: ${period.name} (${period.period_type}${period.sub_period ? ' ' + period.sub_period : ''})`,
    `Dates: ${period.start_date} → ${period.end_date}`,
    period.objective           ? `Objective: ${period.objective}` : null,
    period.intensity_dist_type ? `Intensity: ${period.intensity_dist_type}` : null,
    period.planned_weekly_hrs  ? `Target volume: ${period.planned_weekly_hrs}hrs/week` : null,
    period.engine_mode         ? `Engine mode: ${period.engine_mode}` : null,
  ].filter(Boolean).join('\n');
}

function buildDiarySection(diaryEntries) {
  if (!diaryEntries?.length) return 'No recent diary entries.';
  return diaryEntries.slice(0, 7).map(e => {
    const fields = [
      e.entry_date,
      e.rpe_overall       !== null ? `RPE ${e.rpe_overall}` : null,
      e.wellness_score    !== null ? `wellness ${e.wellness_score}` : null,
      e.soreness_score    !== null ? `soreness ${e.soreness_score}` : null,
      e.session_reflection ? `"${e.session_reflection.slice(0, 100)}"` : null,
    ].filter(Boolean).join(' | ');
    return `  ${fields}`;
  }).join('\n');
}

// ---------------------------------------------------------------------------
// Mode: lean
// ~1000 tokens. System + athlete profile + last 5 messages.
// ---------------------------------------------------------------------------

export async function buildLeanContext(conversationHistory) {
  const athlete  = await apiClient.get('/athlete');
  const sections = {
    athlete_profile: buildAthleteSection(athlete)
  };
  const systemContent = [SYSTEM_PROMPT, '\n---\n', sections.athlete_profile].join('\n');

  return {
    mode:    'lean',
    system:  systemContent,
    messages: normaliseMessages(conversationHistory.slice(-5)),
    _meta: {
      sections,
      token_estimates: {
        system:   estimateTokens(systemContent),
        messages: countTokens(conversationHistory.slice(-5)),
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Mode: balanced (default)
// ~2900 tokens. System + athlete + snapshot + current week + summary + last 10.
// ---------------------------------------------------------------------------

export async function buildBalancedContext(conversationHistory) {
  const [athlete, snapshot, week, summaryRes] = await Promise.all([
    apiClient.get('/athlete'),
    apiClient.get('/fitness/snapshot'),
    apiClient.get('/weeks/current'),
    apiClient.get('/conversations/summary'),
  ]);

  const summary = summaryRes?.summary ?? null;

  const sections = {
    athlete_profile:      buildAthleteSection(athlete),
    fitness_snapshot:     buildSnapshotSection(snapshot),
    current_week:         buildWeekSection(week),
    conversation_summary: summary ? `Conversation history summary:\n${summary}` : null,
  };

  const systemParts = [
    SYSTEM_PROMPT,
    '\n---\nATHLETE PROFILE\n' + sections.athlete_profile,
    '\n---\nFITNESS SNAPSHOT\n' + sections.fitness_snapshot,
    '\n---\nCURRENT WEEK\n' + sections.current_week,
    sections.conversation_summary
      ? '\n---\nCONVERSATION HISTORY SUMMARY\n' + sections.conversation_summary
      : null,
  ].filter(Boolean).join('\n');

  return {
    mode:    'balanced',
    system:  systemParts,
    messages: normaliseMessages(conversationHistory.slice(-10)),
    _meta: {
      sections,
      token_estimates: {
        system:   estimateTokens(systemParts),
        messages: countTokens(conversationHistory.slice(-10)),
        total:    estimateTokens(systemParts) + countTokens(conversationHistory.slice(-10)),
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Mode: full
// ~5000 tokens. Balanced + current period + last 7 diary entries + knowledge chunks.
// ---------------------------------------------------------------------------

export async function buildFullContext(conversationHistory, knowledgeChunks = []) {
  const [athlete, snapshot, week, period, diaryRes, summaryRes] = await Promise.all([
    apiClient.get('/athlete'),
    apiClient.get('/fitness/snapshot'),
    apiClient.get('/weeks/current'),
    apiClient.get('/periods/current'),
    apiClient.get('/diary?limit=7'),
    apiClient.get('/conversations/summary'),
  ]);

  const diary   = diaryRes?.data ?? [];
  const summary = summaryRes?.summary ?? null;

  const sections = {
    athlete_profile:      buildAthleteSection(athlete),
    fitness_snapshot:     buildSnapshotSection(snapshot),
    current_period:       buildPeriodSection(period),
    current_week:         buildWeekSection(week),
    recent_diary:         buildDiarySection(diary),
    conversation_summary: summary ? `Conversation history summary:\n${summary}` : null,
    knowledge_chunks:     knowledgeChunks.length
      ? 'Relevant reference material:\n' + knowledgeChunks.map(c => `  [${c.source}] ${c.content}`).join('\n')
      : null,
  };

  const systemParts = [
    SYSTEM_PROMPT,
    '\n---\nATHLETE PROFILE\n'       + sections.athlete_profile,
    '\n---\nFITNESS SNAPSHOT\n'      + sections.fitness_snapshot,
    '\n---\nCURRENT PERIOD\n'        + sections.current_period,
    '\n---\nCURRENT WEEK\n'          + sections.current_week,
    '\n---\nRECENT DIARY\n'          + sections.recent_diary,
    sections.conversation_summary
      ? '\n---\nCONVERSATION HISTORY SUMMARY\n' + sections.conversation_summary
      : null,
    sections.knowledge_chunks
      ? '\n---\nREFERENCE MATERIAL\n' + sections.knowledge_chunks
      : null,
  ].filter(Boolean).join('\n');

  return {
    mode:    'full',
    system:  systemParts,
    messages: normaliseMessages(conversationHistory.slice(-20)),
    _meta: {
      sections,
      token_estimates: {
        system:   estimateTokens(systemParts),
        messages: countTokens(conversationHistory.slice(-20)),
        total:    estimateTokens(systemParts) + countTokens(conversationHistory.slice(-20)),
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Router — builds context for the requested mode
// ---------------------------------------------------------------------------

export async function buildContext(mode, conversationHistory, knowledgeChunks = []) {
  switch (mode) {
    case 'lean':     return buildLeanContext(conversationHistory);
    case 'full':     return buildFullContext(conversationHistory, knowledgeChunks);
    case 'balanced':
    default:         return buildBalancedContext(conversationHistory);
  }
}
