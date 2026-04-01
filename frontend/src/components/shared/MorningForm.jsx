import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { useApi, useFetch } from '../../hooks/useApi.js'

const TODAY = new Date().toISOString().slice(0, 10)

function SliderField({ label, name, value, onChange, min = 1, max = 10, required }) {
  return (
    <div>
      <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
        <span>{label}{required && <span className="text-red-500 ml-0.5">*</span>}</span>
        <span className="font-medium text-gray-700 dark:text-gray-300">{value ?? '—'} / {max}</span>
      </div>
      <input
        type="range" min={min} max={max} step="1"
        value={value ?? min}
        onChange={e => onChange(name, Number(e.target.value))}
        className="w-full accent-accent"
      />
      <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
        <span>{min}</span><span>{max}</span>
      </div>
    </div>
  )
}

function NumberField({ label, name, value, onChange, unit, placeholder, required }) {
  return (
    <div>
      <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
        {unit && <span className="text-gray-400 ml-1">({unit})</span>}
      </label>
      <input
        type="number"
        value={value ?? ''}
        onChange={e => onChange(name, e.target.value === '' ? null : Number(e.target.value))}
        placeholder={placeholder}
        className="w-full text-sm bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-gray-800 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-accent"
      />
    </div>
  )
}

export default function MorningForm({ open, onClose }) {
  const { request, loading, error } = useApi()
  const { data: existing } = useFetch(`/health/daily?date=${TODAY}&limit=1`, { skip: !open })

  const [fields, setFields] = useState({
    hrv_nightly:        null,
    resting_hr:         null,
    sleep_duration_hrs: null,
    wellness_score:     5,
    sleep_quality:      null,
    soreness_score:     null,
    motivation_score:   null,
    stress_life:        null,
  })
  const [saved, setSaved] = useState(false)

  // Pre-fill if record exists for today
  useEffect(() => {
    if (!open) { setSaved(false); return }
    const rows = Array.isArray(existing) ? existing : (existing?.data ?? [])
    const todayRow = rows.find(r => (r.metric_date ?? r.date ?? '').slice(0, 10) === TODAY)
    if (todayRow) {
      setFields({
        hrv_nightly:        todayRow.hrv_nightly        ?? null,
        resting_hr:         todayRow.resting_hr         ?? null,
        sleep_duration_hrs: todayRow.sleep_duration_hrs ?? null,
        wellness_score:     todayRow.wellness_score     ?? 5,
        sleep_quality:      todayRow.sleep_quality      ?? null,
        soreness_score:     todayRow.soreness_score     ?? null,
        motivation_score:   todayRow.motivation_score   ?? null,
        stress_life:        todayRow.stress_life        ?? null,
      })
    }
  }, [existing, open])

  function set(name, value) {
    setFields(f => ({ ...f, [name]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const mandatory = ['hrv_nightly', 'resting_hr', 'sleep_duration_hrs', 'wellness_score']
    if (mandatory.some(k => fields[k] == null)) return

    // Strip nulls before sending
    const payload = { metric_date: TODAY }
    for (const [k, v] of Object.entries(fields)) {
      if (v != null) payload[k] = v
    }

    const result = await request('POST', '/health/daily', payload)
    if (result) {
      setSaved(true)
      setTimeout(onClose, 1200)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md bg-white dark:bg-gray-800 rounded-2xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">Morning check-in</h2>
            <p className="text-xs text-gray-400 mt-0.5">{TODAY}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-5 space-y-4 max-h-[70vh] overflow-y-auto">

          {saved && (
            <div className="py-2 text-center text-sm text-green-600 dark:text-green-400 font-medium">
              ✓ Saved
            </div>
          )}

          {error && (
            <p className="text-xs text-red-500">{error}</p>
          )}

          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Required</p>

          <div className="grid grid-cols-2 gap-3">
            <NumberField label="HRV nightly" name="hrv_nightly" value={fields.hrv_nightly} onChange={set} unit="ms" placeholder="e.g. 62" required />
            <NumberField label="Resting HR" name="resting_hr" value={fields.resting_hr} onChange={set} unit="bpm" placeholder="e.g. 48" required />
          </div>

          <NumberField label="Sleep duration" name="sleep_duration_hrs" value={fields.sleep_duration_hrs} onChange={set} unit="hrs" placeholder="e.g. 7.5" required />

          <SliderField label="Wellness" name="wellness_score" value={fields.wellness_score} onChange={set} required />

          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide pt-2">Optional</p>

          <SliderField label="Sleep quality" name="sleep_quality" value={fields.sleep_quality ?? 5} onChange={set} />
          <SliderField label="Soreness" name="soreness_score" value={fields.soreness_score ?? 1} onChange={set} />
          <SliderField label="Motivation" name="motivation_score" value={fields.motivation_score ?? 5} onChange={set} />
          <SliderField label="Life stress" name="stress_life" value={fields.stress_life ?? 1} onChange={set} />

          <button
            type="submit"
            disabled={loading || ['hrv_nightly','resting_hr','sleep_duration_hrs','wellness_score'].some(k => fields[k] == null)}
            className="w-full py-2.5 rounded-xl bg-accent dark:bg-accent-dark text-white font-medium text-sm hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {loading ? 'Saving…' : 'Save check-in'}
          </button>
        </form>
      </div>
    </div>
  )
}
