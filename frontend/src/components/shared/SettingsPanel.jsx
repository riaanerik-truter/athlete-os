import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { useTheme } from '../../context/ThemeContext.jsx'
import { useAthlete } from '../../context/AthleteContext.jsx'
import { useApi, useFetch } from '../../hooks/useApi.js'
import { usePrefs } from '../../hooks/usePrefs.js'

// ---------------------------------------------------------------------------
// Section wrapper
// ---------------------------------------------------------------------------

function Section({ title, children }) {
  return (
    <div className="border-b border-gray-100 dark:border-gray-700 pb-5 mb-5 last:border-0 last:mb-0 last:pb-0">
      <h3 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3">{title}</h3>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

function Row({ label, hint, children }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-700 dark:text-gray-200">{label}</p>
        {hint && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function Toggle({ value, onChange }) {
  return (
    <button
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
      className={`relative inline-flex w-10 h-5 rounded-full transition-colors ${value ? 'bg-accent dark:bg-accent-dark' : 'bg-gray-300 dark:bg-gray-600'}`}
    >
      <span className={`inline-block w-4 h-4 m-0.5 rounded-full bg-white shadow transition-transform ${value ? 'translate-x-5' : 'translate-x-0'}`} />
    </button>
  )
}

function Select({ value, onChange, options }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="text-sm bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-md px-2 py-1 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-accent"
    >
      {options.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}

// ---------------------------------------------------------------------------
// Proactive scale (1-5)
// ---------------------------------------------------------------------------

const SCALE_LABELS = {
  1: 'Recovery only',
  2: 'Recovery + milestones',
  3: 'Recovery + milestones + daily',
  4: '+ Weekly digests',
  5: 'Everything',
}

function ProactiveSlider({ value, onChange }) {
  return (
    <div className="w-full space-y-1">
      <input
        type="range" min="1" max="5" step="1"
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full accent-accent"
      />
      <p className="text-xs text-gray-500 dark:text-gray-400">{SCALE_LABELS[value]}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

const SPORT_OPTIONS = [
  { value: 'cycling',   label: 'Cycling' },
  { value: 'mtb',       label: 'MTB' },
  { value: 'running',   label: 'Running' },
  { value: 'swimming',  label: 'Swimming' },
  { value: 'triathlon', label: 'Triathlon' },
]

export default function SettingsPanel({ open, onClose }) {
  const { theme, toggle: toggleTheme } = useTheme()
  const { athlete, reload: reloadAthlete } = useAthlete()
  const { prefs, setPref } = usePrefs()
  const { request: apiRequest, loading: saving } = useApi()

  const { data: configData }       = useFetch('/config',         { skip: !open })
  const { data: syncData }         = useFetch('/sync/status',    { skip: !open })
  const { data: methodologyData }  = useFetch('/methodologies',  { skip: !open })

  // Local state for DB-backed fields
  const [timezone,    setTimezone]    = useState('')
  const [whatsapp,    setWhatsapp]    = useState('')
  const [savedField,  setSavedField]  = useState(null) // shows inline "Saved" confirmation

  useEffect(() => {
    if (athlete) {
      setTimezone(athlete.timezone ?? 'UTC')
      setWhatsapp(athlete.whatsapp_number ?? '')
    }
  }, [athlete])

  async function patchAthlete(field, value) {
    await apiRequest('PATCH', '/athlete', { [field]: value })
    reloadAthlete()
    setSavedField(field)
    setTimeout(() => setSavedField(null), 1500)
  }

  async function saveDbSettings() {
    const patch = {}
    if (timezone !== (athlete?.timezone ?? 'UTC'))               patch.timezone        = timezone
    if (whatsapp  !== (athlete?.whatsapp_number ?? ''))          patch.whatsapp_number = whatsapp
    if (!Object.keys(patch).length) return
    await apiRequest('PATCH', '/config', patch)
    reloadAthlete()
  }

  async function triggerSync(source) {
    await apiRequest('POST', '/sync/trigger', { source })
  }

  const syncStatus = Array.isArray(syncData) ? syncData : (syncData?.data ?? [])
  const lastSync = (src) => {
    const row = syncStatus.find(r => r.source === src)
    if (!row?.last_synced_at) return 'Never'
    return new Date(row.last_synced_at).toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  }

  const connected = configData?.connected_sources ?? []

  if (!open) return null

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />

      {/* Panel */}
      <div className="relative z-50 w-80 bg-white dark:bg-gray-800 h-full shadow-xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Settings</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-5 py-5">

          {/* 0. Training */}
          <Section title="Training">
            <Row label="Primary sport">
              <div className="flex items-center gap-2">
                <Select
                  value={athlete?.primary_sport ?? ''}
                  onChange={v => patchAthlete('primary_sport', v)}
                  options={SPORT_OPTIONS}
                />
                {savedField === 'primary_sport' && (
                  <span className="text-xs text-green-600 dark:text-green-400">Saved</span>
                )}
              </div>
            </Row>
            <Row label="Methodology" hint="Coaching rules applied to your training plan">
              <div className="flex items-center gap-2">
                <Select
                  value={athlete?.active_methodology?.id ?? athlete?.active_methodology_id ?? ''}
                  onChange={v => patchAthlete('active_methodology_id', v)}
                  options={(methodologyData?.data ?? []).map(m => ({ value: m.id, label: m.name }))}
                />
                {savedField === 'active_methodology_id' && (
                  <span className="text-xs text-green-600 dark:text-green-400">Saved</span>
                )}
              </div>
            </Row>
          </Section>

          {/* 1. Notifications */}
          <Section title="Notifications">
            <Row label="Proactive scale" hint="Controls how often the coach sends unprompted messages">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{prefs.proactive_scale}/5</span>
            </Row>
            <ProactiveSlider value={prefs.proactive_scale} onChange={v => setPref('proactive_scale', v)} />
            <Row label="Morning digest">
              <input
                type="time"
                value={prefs.morning_digest_time}
                onChange={e => setPref('morning_digest_time', e.target.value)}
                className="text-sm bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-md px-2 py-1 text-gray-800 dark:text-gray-200"
              />
            </Row>
            <Row label="Weekly summary">
              <Toggle value={prefs.weekly_summary} onChange={v => setPref('weekly_summary', v)} />
            </Row>
          </Section>

          {/* 2. Coaching engine */}
          <Section title="Coaching engine">
            <Row label="Context window" hint="Larger = more context, higher cost per message">
              <Select
                value={prefs.context_mode}
                onChange={v => setPref('context_mode', v)}
                options={[
                  { value: 'lean',     label: 'Lean (~$0.001)' },
                  { value: 'balanced', label: 'Balanced (~$0.004)' },
                  { value: 'full',     label: 'Full (~$0.008)' },
                ]}
              />
            </Row>
            <Row label="Engine mode" hint="Adaptive uses Sonnet for all messages">
              <Select
                value={prefs.engine_mode}
                onChange={v => setPref('engine_mode', v)}
                options={[
                  { value: 'structured', label: 'Structured' },
                  { value: 'guided',     label: 'Guided' },
                  { value: 'adaptive',   label: 'Adaptive' },
                ]}
              />
            </Row>
            <p className="text-xs text-gray-400 dark:text-gray-500">Restart coaching engine to apply service settings</p>
          </Section>

          {/* 3. Data sync */}
          <Section title="Data sync">
            <Row label="Garmin" hint="Drop .fit or .json files into watched-activities/">
              <span className="text-xs text-green-600 dark:text-green-400">File watcher active</span>
            </Row>
            <Row label="Strava" hint={`Last sync: ${lastSync('strava')}`}>
              <button
                onClick={() => triggerSync('strava')}
                disabled={saving}
                className="text-xs px-3 py-1 rounded-md bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50"
              >
                Sync now
              </button>
            </Row>
          </Section>

          {/* 4. Channels */}
          <Section title="Channels">
            <Row label="Discord" hint={connected.includes('discord') ? 'Connected' : 'Not connected'}>
              <span className={`w-2 h-2 rounded-full inline-block ${connected.includes('discord') ? 'bg-green-500' : 'bg-gray-400'}`} />
            </Row>
            <Row label="WhatsApp">
              <input
                type="tel"
                value={whatsapp}
                onChange={e => setWhatsapp(e.target.value)}
                placeholder="+27..."
                className="w-28 text-sm bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-md px-2 py-1 text-gray-800 dark:text-gray-200"
              />
            </Row>
            <Row label="Web chat">
              <span className="text-xs text-green-600 dark:text-green-400">Always on</span>
            </Row>
          </Section>

          {/* 5. Display */}
          <Section title="Display">
            <Row label="Theme">
              <Select
                value={theme}
                onChange={v => { if (v !== theme) toggleTheme() }}
                options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]}
              />
            </Row>
            <Row label="Chart range">
              <Select
                value={String(prefs.chart_range)}
                onChange={v => setPref('chart_range', Number(v))}
                options={[
                  { value: '8',  label: '8 weeks' },
                  { value: '12', label: '12 weeks' },
                  { value: '24', label: '24 weeks' },
                ]}
              />
            </Row>
          </Section>

          {/* 6. Account */}
          <Section title="Account">
            <Row label="Athlete">
              <span className="text-sm text-gray-600 dark:text-gray-300">{athlete?.name ?? '—'}</span>
            </Row>
            <Row label="Timezone">
              <input
                value={timezone}
                onChange={e => setTimezone(e.target.value)}
                placeholder="UTC"
                className="w-28 text-sm bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-md px-2 py-1 text-gray-800 dark:text-gray-200"
              />
            </Row>
            <Row label="API key">
              <span className="text-xs font-mono text-gray-400">sk-local-kzS5FHuBZ6TNI214</span>
            </Row>
          </Section>

        </div>

        {/* Footer save */}
        <div className="px-5 py-4 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={saveDbSettings}
            disabled={saving}
            className="w-full py-2 rounded-lg bg-accent dark:bg-accent-dark text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
