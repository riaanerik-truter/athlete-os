import { useFetch } from '../../hooks/useApi.js'

// Simple inline SVG sparkline from an array of numbers
function Sparkline({ data = [], color = '#3B82F6', width = 60, height = 20 }) {
  if (data.length < 2) return null
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width
    const y = height - ((v - min) / range) * (height - 2) - 1
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-14 h-5 shrink-0">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}

function trendArrow(data = []) {
  if (data.length < 2) return null
  const recent = data.slice(-3)
  const avg = n => n.reduce((a, b) => a + b, 0) / n.length
  const diff = avg(recent.slice(-2)) - avg(recent.slice(0, Math.max(1, recent.length - 2)))
  if (Math.abs(diff) < 0.5) return { icon: '→', color: 'text-gray-400' }
  return diff > 0
    ? { icon: '↑', color: 'text-green-600 dark:text-green-400' }
    : { icon: '↓', color: 'text-red-500 dark:text-red-400' }
}

function MetricRow({ label, value, unit, sparkData, sparkColor, arrow }) {
  const trend = arrow ?? trendArrow(sparkData)
  return (
    <div className="flex items-center gap-3 py-2 border-b border-gray-100 dark:border-gray-700 last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
        <div className="flex items-baseline gap-1">
          <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">
            {value ?? '—'}
          </span>
          {unit && value != null && (
            <span className="text-xs text-gray-400">{unit}</span>
          )}
          {trend && value != null && (
            <span className={`text-xs font-medium ${trend.color}`}>{trend.icon}</span>
          )}
        </div>
      </div>
      {sparkData?.length >= 2 && (
        <Sparkline data={sparkData} color={sparkColor} />
      )}
    </div>
  )
}

function avg(arr) {
  if (!arr?.length) return null
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

function last(arr) {
  if (!arr?.length) return null
  return arr[arr.length - 1]
}

export default function HealthMetrics() {
  // Last 14 days of health data — use limit param (supported since API fix)
  const { data: res, loading, error } = useFetch('/health/daily?limit=14')

  const entries = Array.isArray(res) ? res : (res?.data ?? [])
  const sorted  = [...entries].sort((a, b) => new Date(a.date ?? a.metric_date) - new Date(b.date ?? b.metric_date))

  // Extract per-metric arrays — field names match daily_metrics table columns
  const hrv         = sorted.map(e => e.hrv_nightly_avg).filter(v => v != null)
  const restingHr   = sorted.map(e => e.resting_hr).filter(v => v != null)
  const bodyBattery = sorted.map(e => e.body_battery_morning).filter(v => v != null)
  const sleep       = sorted.map(e => e.sleep_duration_hrs).filter(v => v != null)
  const sleepScore  = sorted.map(e => e.sleep_score).filter(v => v != null)
  const stress      = sorted.map(e => e.stress_avg).filter(v => v != null)

  const latestEntry = sorted[sorted.length - 1]

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">Health & Recovery</h2>

      {loading && <p className="text-sm text-gray-400 py-4 text-center">Loading…</p>}
      {error   && <p className="text-sm text-red-500 py-4 text-center">Could not load health data</p>}

      {!loading && !error && entries.length === 0 && (
        <p className="text-sm text-gray-400 dark:text-gray-500 py-2">
          No health data yet — log today's metrics with "Log today".
        </p>
      )}

      {!loading && !error && entries.length > 0 && (
        <div>
          <MetricRow
            label="HRV (nightly)"
            value={last(hrv) != null ? Math.round(last(hrv)) : null}
            unit="ms"
            sparkData={hrv}
            sparkColor="#3B82F6"
          />
          <MetricRow
            label="Resting HR"
            value={last(restingHr) != null ? Math.round(last(restingHr)) : null}
            unit="bpm"
            sparkData={restingHr}
            sparkColor="#F97316"
            // For resting HR, down is good
            arrow={restingHr.length >= 2
              ? trendArrow([...restingHr].map(v => -v))  // invert so down = good
              : null}
          />
          <MetricRow
            label="Body battery"
            value={last(bodyBattery) != null ? Math.round(last(bodyBattery)) : null}
            unit=""
            sparkData={bodyBattery}
            sparkColor="#22C55E"
          />
          <MetricRow
            label="Sleep"
            value={last(sleep) != null ? last(sleep).toFixed(1) : null}
            unit="hrs"
            sparkData={sleep}
            sparkColor="#8B5CF6"
          />
          {sleepScore.length > 0 && (
            <MetricRow
              label="Sleep score"
              value={last(sleepScore) != null ? Math.round(last(sleepScore)) : null}
              unit="/100"
              sparkData={sleepScore}
              sparkColor="#8B5CF6"
            />
          )}
          {stress.length > 0 && (
            <MetricRow
              label="Stress"
              value={last(stress) != null ? Math.round(last(stress)) : null}
              unit=""
              sparkData={stress}
              sparkColor="#EF4444"
              arrow={stress.length >= 2
                ? trendArrow([...stress].map(v => -v))  // invert: lower stress is better
                : null}
            />
          )}
        </div>
      )}
    </div>
  )
}
