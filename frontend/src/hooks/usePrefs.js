// usePrefs — read/write display and service preferences to localStorage.
// Separates UI preferences from DB-backed athlete fields.

import { useState } from 'react'

export const PREF_DEFAULTS = {
  proactive_scale:      3,       // 1-5
  morning_digest_time:  '09:00',
  weekly_summary:       true,
  context_mode:         'balanced',  // lean | balanced | full
  engine_mode:          'guided',    // structured | guided | adaptive
  chart_range:          12,          // weeks: 8 | 12 | 24
}

const KEY = 'athleteos_prefs'

function load() {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? { ...PREF_DEFAULTS, ...JSON.parse(raw) } : { ...PREF_DEFAULTS }
  } catch {
    return { ...PREF_DEFAULTS }
  }
}

export function usePrefs() {
  const [prefs, setState] = useState(load)

  function setPref(key, value) {
    setState(prev => {
      const next = { ...prev, [key]: value }
      try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /**/ }
      return next
    })
  }

  function setPrefs(patch) {
    setState(prev => {
      const next = { ...prev, ...patch }
      try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /**/ }
      return next
    })
  }

  return { prefs, setPref, setPrefs }
}
