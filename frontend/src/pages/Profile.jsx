import { useState, useEffect } from 'react'
import { useAthlete } from '../context/AthleteContext.jsx'
import { useApi, useFetch } from '../hooks/useApi.js'

// ---------------------------------------------------------------------------
// Shared field components
// ---------------------------------------------------------------------------

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
        {label}
        {hint && <span className="text-gray-400 font-normal ml-1">({hint})</span>}
      </label>
      {children}
    </div>
  )
}

const inputClass = 'w-full text-sm bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-accent'

function SaveBar({ onSave, saving, saved, error }) {
  return (
    <div className="flex items-center gap-3 pt-2">
      <button onClick={onSave} disabled={saving}
        className="text-sm px-5 py-2 rounded-xl bg-accent dark:bg-accent-dark text-white hover:opacity-90 disabled:opacity-50">
        {saving ? 'Saving…' : 'Save'}
      </button>
      {saved  && <span className="text-xs text-green-600 dark:text-green-400">Saved</span>}
      {error  && <span className="text-xs text-red-500">{error}</span>}
    </div>
  )
}

function Section({ title, children }) {
  return (
    <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 mb-4">
      <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-4">{title}</h2>
      {children}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Personal details section
// ---------------------------------------------------------------------------

function PersonalSection({ athlete, onSaved }) {
  const { request, loading, error } = useApi()
  const [saved, setSaved] = useState(false)
  const [fields, setFields] = useState({
    name:          athlete?.name          ?? '',
    email:         athlete?.email         ?? '',
    date_of_birth: athlete?.date_of_birth ?? '',
    sex:           athlete?.sex           ?? '',
    weight_kg:     athlete?.weight_kg     ?? '',
    height_cm:     athlete?.height_cm     ?? '',
    timezone:      athlete?.timezone      ?? 'UTC',
  })

  useEffect(() => {
    if (athlete) setFields({
      name:          athlete.name          ?? '',
      email:         athlete.email         ?? '',
      date_of_birth: athlete.date_of_birth ? athlete.date_of_birth.slice(0, 10) : '',
      sex:           athlete.sex           ?? '',
      weight_kg:     athlete.weight_kg     ?? '',
      height_cm:     athlete.height_cm     ?? '',
      timezone:      athlete.timezone      ?? 'UTC',
    })
  }, [athlete])

  function set(k, v) { setFields(f => ({ ...f, [k]: v })) }

  async function save() {
    const patch = {}
    for (const [k, v] of Object.entries(fields)) {
      if (v !== '' && v != null) patch[k] = (k === 'weight_kg' || k === 'height_cm') ? Number(v) : v
    }
    const result = await request('PATCH', '/athlete', patch)
    if (result) { setSaved(true); setTimeout(() => setSaved(false), 2500); onSaved?.() }
  }

  return (
    <Section title="Personal details">
      <div className="grid grid-cols-2 gap-4 mb-4">
        <Field label="Full name">
          <input value={fields.name} onChange={e => set('name', e.target.value)} className={inputClass} />
        </Field>
        <Field label="Email">
          <input type="email" value={fields.email} onChange={e => set('email', e.target.value)} className={inputClass} />
        </Field>
        <Field label="Date of birth">
          <input type="date" value={fields.date_of_birth} onChange={e => set('date_of_birth', e.target.value)} className={inputClass} />
        </Field>
        <Field label="Sex">
          <select value={fields.sex} onChange={e => set('sex', e.target.value)} className={inputClass}>
            <option value="">—</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="other">Other</option>
          </select>
        </Field>
        <Field label="Weight" hint="kg">
          <input type="number" step="0.1" value={fields.weight_kg} onChange={e => set('weight_kg', e.target.value)} className={inputClass} placeholder="e.g. 72.5" />
        </Field>
        <Field label="Height" hint="cm">
          <input type="number" value={fields.height_cm} onChange={e => set('height_cm', e.target.value)} className={inputClass} placeholder="e.g. 178" />
        </Field>
        <Field label="Timezone">
          <input value={fields.timezone} onChange={e => set('timezone', e.target.value)} className={inputClass} placeholder="UTC" />
        </Field>
      </div>
      <SaveBar onSave={save} saving={loading} saved={saved} error={error} />
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Sports and methodology
// ---------------------------------------------------------------------------

const SPORTS_LIST = ['cycling', 'running', 'swimming', 'triathlon', 'mtb', 'strength']

function SportsSection({ athlete, methodologies, onSaved }) {
  const { request, loading, error } = useApi()
  const [saved, setSaved] = useState(false)

  const [activeSports, setActiveSports] = useState(() => {
    const v = athlete?.active_sports
    if (Array.isArray(v)) return v
    if (typeof v === 'string') try { return JSON.parse(v) } catch { return [] }
    return []
  })
  const [primarySport, setPrimary] = useState(athlete?.primary_sport ?? '')
  const [methodId,     setMethodId] = useState(athlete?.active_methodology_id ?? '')

  function toggleSport(s) {
    setActiveSports(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])
  }

  async function save() {
    const result = await request('PATCH', '/athlete', {
      active_sports: activeSports,
      primary_sport: primarySport || undefined,
      ...(methodId && { active_methodology_id: methodId }),
    })
    if (result) { setSaved(true); setTimeout(() => setSaved(false), 2500); onSaved?.() }
  }

  return (
    <Section title="Active sports & methodology">
      <Field label="Active sports">
        <div className="flex flex-wrap gap-2 mt-1">
          {SPORTS_LIST.map(s => (
            <button key={s} onClick={() => toggleSport(s)}
              className={`text-xs px-3 py-1.5 rounded-lg capitalize transition-colors ${activeSports.includes(s) ? 'bg-accent dark:bg-accent-dark text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}>
              {s}
            </button>
          ))}
        </div>
      </Field>

      <div className="grid grid-cols-2 gap-4 mt-4 mb-4">
        <Field label="Primary sport">
          <select value={primarySport} onChange={e => setPrimary(e.target.value)} className={inputClass}>
            <option value="">—</option>
            {SPORTS_LIST.map(s => <option key={s} value={s} className="capitalize">{s}</option>)}
          </select>
        </Field>
        <Field label="Methodology">
          <select value={methodId} onChange={e => setMethodId(e.target.value)} className={inputClass}>
            <option value="">—</option>
            {(methodologies ?? []).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </Field>
      </div>
      <SaveBar onSave={save} saving={loading} saved={saved} error={error} />
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Fitness anchors
// ---------------------------------------------------------------------------

function FitnessAnchorRow({ label, fieldKey, value, onChange, unit, testProtocol, lastTestDate }) {
  return (
    <div className="flex items-center gap-4 py-3 border-b border-gray-100 dark:border-gray-700 last:border-0">
      <div className="flex-1">
        <p className="text-sm font-medium text-gray-700 dark:text-gray-200">{label}</p>
        {lastTestDate && (
          <p className="text-xs text-gray-400">Last tested {lastTestDate}</p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="number"
          step="any"
          value={value ?? ''}
          onChange={e => onChange(fieldKey, e.target.value === '' ? null : Number(e.target.value))}
          className="w-24 text-sm bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-accent text-right"
        />
        <span className="text-xs text-gray-400 w-10">{unit}</span>
      </div>
    </div>
  )
}

function FitnessSection({ athlete, fieldTests, onSaved }) {
  const { request, loading, error } = useApi()
  const [saved, setSaved] = useState(false)
  const [anchors, setAnchors] = useState({
    ftp_watts:        athlete?.ftp_watts        ?? null,
    fthr_cycling:     athlete?.fthr_cycling     ?? null,
    fthr_running:     athlete?.fthr_running     ?? null,
    vdot:             athlete?.vdot             ?? null,
    css_per_100m_sec: athlete?.css_per_100m_sec ?? null,
    max_hr:           athlete?.max_hr           ?? null,
  })

  function set(k, v) { setAnchors(a => ({ ...a, [k]: v })) }

  // Find last test date per anchor from field tests
  function lastTest(type) {
    if (!fieldTests?.length) return null
    const match = [...fieldTests]
      .filter(t => t.test_type?.toLowerCase().includes(type.toLowerCase()))
      .sort((a, b) => new Date(b.test_date) - new Date(a.test_date))[0]
    if (!match) return null
    return new Date(match.test_date).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
  }

  async function save() {
    const patch = {}
    for (const [k, v] of Object.entries(anchors)) {
      if (v != null) patch[k] = v
    }
    const result = await request('PATCH', '/athlete', patch)
    if (result) { setSaved(true); setTimeout(() => setSaved(false), 2500); onSaved?.() }
  }

  return (
    <Section title="Current fitness anchors">
      <FitnessAnchorRow label="FTP"        fieldKey="ftp_watts"        value={anchors.ftp_watts}        onChange={set} unit="W"       lastTestDate={lastTest('ftp')} />
      <FitnessAnchorRow label="FTHR (cycling)" fieldKey="fthr_cycling" value={anchors.fthr_cycling}     onChange={set} unit="bpm"     lastTestDate={lastTest('fthr')} />
      <FitnessAnchorRow label="FTHR (running)" fieldKey="fthr_running" value={anchors.fthr_running}     onChange={set} unit="bpm"     lastTestDate={lastTest('fthr')} />
      <FitnessAnchorRow label="VDOT"       fieldKey="vdot"             value={anchors.vdot}             onChange={set} unit=""        lastTestDate={lastTest('vdot')} />
      <FitnessAnchorRow label="CSS"        fieldKey="css_per_100m_sec" value={anchors.css_per_100m_sec} onChange={set} unit="s/100m"  lastTestDate={lastTest('css')} />
      <FitnessAnchorRow label="Max HR"     fieldKey="max_hr"           value={anchors.max_hr}           onChange={set} unit="bpm"     lastTestDate={lastTest('max_hr')} />
      <div className="mt-4">
        <SaveBar onSave={save} saving={loading} saved={saved} error={error} />
      </div>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Equipment
// ---------------------------------------------------------------------------

function EquipmentSection() {
  const [power,   setPower]   = useState(() => localStorage.getItem('equip_power')   === 'true')
  const [trainer, setTrainer] = useState(() => localStorage.getItem('equip_trainer') === 'true')
  const [pool,    setPool]    = useState(() => localStorage.getItem('equip_pool')    === 'true')

  function toggle(key, val, setter) {
    setter(val)
    localStorage.setItem(key, String(val))
  }

  function CheckRow({ label, value, onToggle }) {
    return (
      <label className="flex items-center justify-between py-2 cursor-pointer">
        <span className="text-sm text-gray-700 dark:text-gray-200">{label}</span>
        <button role="switch" aria-checked={value} onClick={() => onToggle(!value)}
          className={`relative inline-flex w-10 h-5 rounded-full transition-colors ${value ? 'bg-accent dark:bg-accent-dark' : 'bg-gray-300 dark:bg-gray-600'}`}>
          <span className={`inline-block w-4 h-4 m-0.5 rounded-full bg-white shadow transition-transform ${value ? 'translate-x-5' : ''}`} />
        </button>
      </label>
    )
  }

  return (
    <Section title="Equipment">
      <CheckRow label="Power meter"    value={power}   onToggle={v => toggle('equip_power',   v, setPower)}   />
      <CheckRow label="Indoor trainer" value={trainer} onToggle={v => toggle('equip_trainer', v, setTrainer)} />
      <CheckRow label="Pool access"    value={pool}    onToggle={v => toggle('equip_pool',    v, setPool)}    />
      <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">Equipment settings are stored locally and used by the coaching engine.</p>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Onboarding progress
// ---------------------------------------------------------------------------

function OnboardingSection({ athlete }) {
  const stages = ['welcome', 'fitness_anchors', 'history', 'goals', 'methodology']
  const currentStage = athlete?.onboarding_stage ?? 'welcome'
  const stageIndex = stages.indexOf(currentStage)
  const complete = stageIndex === stages.length - 1 || athlete?.onboarding_complete

  const pct = complete ? 100 : Math.round(((stageIndex + 1) / stages.length) * 100)

  return (
    <Section title="Onboarding progress">
      <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1.5">
        <span>Stage {stageIndex + 1} of {stages.length}</span>
        <span>{pct}%</span>
      </div>
      <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden mb-3">
        <div className="h-full bg-accent dark:bg-accent-dark rounded-full" style={{ width: `${pct}%` }} />
      </div>
      {complete ? (
        <p className="text-sm text-green-600 dark:text-green-400">Onboarding complete</p>
      ) : (
        <button
          onClick={() => { /* open chat widget to /start */ }}
          className="text-sm px-4 py-2 rounded-xl bg-accent dark:bg-accent-dark text-white hover:opacity-90"
        >
          Continue onboarding with Coach Ri
        </button>
      )}
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Page assembly
// ---------------------------------------------------------------------------

export default function Profile() {
  const { athlete, loading, error, reload: reloadAthlete } = useAthlete()

  const { data: methodologiesRes } = useFetch('/methodologies')
  const { data: testsRes }         = useFetch('/fitness/tests?limit=20')

  const methodologies = Array.isArray(methodologiesRes) ? methodologiesRes : (methodologiesRes?.data ?? [])
  const fieldTests    = Array.isArray(testsRes) ? testsRes : (testsRes?.data ?? [])

  if (loading) {
    return (
      <main className="max-w-screen-md mx-auto px-4 py-8">
        <p className="text-gray-400">Loading profile…</p>
      </main>
    )
  }

  if (error || !athlete) {
    return (
      <main className="max-w-screen-md mx-auto px-4 py-8">
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-5">
          <p className="text-sm font-semibold text-red-700 dark:text-red-400 mb-1">Could not load profile</p>
          <p className="text-sm text-red-600 dark:text-red-300">
            {error ?? 'API did not return an athlete record. Make sure the API is running on port 3000 and the athlete record exists.'}
          </p>
          <p className="text-xs text-red-500 dark:text-red-400 mt-2 font-mono">
            GET /api/v1/athlete · X-API-Key: sk-local-kzS5FHuBZ6TNI214
          </p>
          <button
            onClick={reloadAthlete}
            className="mt-3 text-xs px-3 py-1.5 rounded-lg bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/60 transition-colors"
          >
            Retry
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className="max-w-screen-md mx-auto px-4 py-6">
      <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-6">Profile</h1>

      <PersonalSection    athlete={athlete} onSaved={reloadAthlete} />
      <SportsSection      athlete={athlete} methodologies={methodologies} onSaved={reloadAthlete} />
      <FitnessSection     athlete={athlete} fieldTests={fieldTests} onSaved={reloadAthlete} />
      <EquipmentSection />
      <OnboardingSection  athlete={athlete} />
    </main>
  )
}
