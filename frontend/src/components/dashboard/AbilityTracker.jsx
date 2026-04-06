import { useState, useEffect } from 'react'
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts'
import { TrendingUp, TrendingDown, Minus, Info, X, ChevronRight } from 'lucide-react'
import { useFetch } from '../../hooks/useApi.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TREND_CONFIG = {
  improving: { label: 'Improving', color: 'text-green-700 dark:text-green-400', bg: 'bg-green-50 dark:bg-green-900/20', Icon: TrendingUp },
  stable:    { label: 'Stable',    color: 'text-gray-600 dark:text-gray-400',   bg: 'bg-gray-50  dark:bg-gray-700/30',  Icon: Minus       },
  declining: { label: 'Declining', color: 'text-red-600  dark:text-red-400',    bg: 'bg-red-50   dark:bg-red-900/20',   Icon: TrendingDown },
}

const WEIGHT_BADGE = {
  high: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
  med:  'bg-gray-100 dark:bg-gray-700    text-gray-600 dark:text-gray-300',
  low:  'bg-gray-50  dark:bg-gray-800    text-gray-400 dark:text-gray-500',
}

function scoreColor(score) {
  if (score == null) return 'bg-gray-200 dark:bg-gray-600'
  if (score >= 70) return 'bg-green-500'
  if (score >= 50) return 'bg-amber-400'
  return 'bg-red-400'
}

function scoreTextColor(score) {
  if (score == null) return 'text-gray-400'
  if (score >= 70) return 'text-green-600 dark:text-green-400'
  if (score >= 50) return 'text-amber-600 dark:text-amber-400'
  return 'text-red-500 dark:text-red-400'
}

function MetricTrendArrow({ trend }) {
  if (trend === 'up')   return <TrendingUp   className="w-3.5 h-3.5 text-green-500 shrink-0" />
  if (trend === 'down') return <TrendingDown className="w-3.5 h-3.5 text-red-400   shrink-0" />
  return <Minus className="w-3.5 h-3.5 text-gray-400 shrink-0" />
}

function isCountMetric(key) {
  return key.endsWith('_count') || key.endsWith('_min') || key.endsWith('_hrs')
}

function formatVal(value, decimals, unit) {
  if (value == null) return '—'
  const str = Number(value).toFixed(decimals)
  return unit ? `${str} ${unit}` : str
}

// ---------------------------------------------------------------------------
// Block-note tooltip
// ---------------------------------------------------------------------------

function BlockNoteTooltip({ blockNotes, periodType }) {
  const [visible, setVisible] = useState(false)
  const note = blockNotes?.[periodType?.toLowerCase()] ?? blockNotes?.default ?? null
  if (!note) return null

  return (
    <div className="relative inline-flex items-center">
      <button
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        onFocus={() => setVisible(true)}
        onBlur={() => setVisible(false)}
        aria-label="Block context"
        className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
      >
        <Info className="w-3.5 h-3.5" />
      </button>
      {visible && (
        <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-50 w-64 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3 text-left">
          {periodType && (
            <p className="text-xs font-semibold text-blue-600 dark:text-blue-400 mb-1 capitalize">
              {periodType} block
            </p>
          )}
          <p className="text-xs text-gray-600 dark:text-gray-300">{note}</p>
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-white dark:border-t-gray-800" />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Detail modal
// ---------------------------------------------------------------------------

function DetailModal({ ability, metric, onClose }) {
  // Build chart data from history
  const chartData = (ability.history ?? []).map(h => ({
    week:        h.weekLabel,
    score:       h.score,
    [metric.key]: h.metrics?.[metric.key] ?? null,
  }))

  const useBar = isCountMetric(metric.key)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      <div className="relative z-10 w-full max-w-2xl bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-gray-100 dark:border-gray-700">
          <div>
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-0.5">{ability.name}</p>
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{metric.label}</h3>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors mt-0.5"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Metric 7-week chart */}
          <div>
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">7-week trend — {metric.label}</p>
            <ResponsiveContainer width="100%" height={140}>
              {useBar ? (
                <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                  <XAxis dataKey="week" tick={{ fontSize: 10, fill: '#9CA3AF' }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#9CA3AF' }} tickLine={false} axisLine={false} />
                  <Tooltip formatter={(v) => [v != null ? `${v}${metric.unit ? ' ' + metric.unit : ''}` : '—', metric.label]} />
                  <Bar dataKey={metric.key} fill="#3B82F6" radius={[3, 3, 0, 0]} />
                </BarChart>
              ) : (
                <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                  <XAxis dataKey="week" tick={{ fontSize: 10, fill: '#9CA3AF' }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#9CA3AF' }} tickLine={false} axisLine={false} />
                  <Tooltip formatter={(v) => [v != null ? `${v}${metric.unit ? ' ' + metric.unit : ''}` : '—', metric.label]} />
                  <Line
                    type="monotone"
                    dataKey={metric.key}
                    stroke="#3B82F6"
                    strokeWidth={2}
                    dot={{ r: 3, fill: '#3B82F6' }}
                    connectNulls
                  />
                </LineChart>
              )}
            </ResponsiveContainer>
          </div>

          {/* Ability score breakdown */}
          <div>
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
              {ability.name} — score breakdown
            </p>
            <div className="space-y-2">
              {(ability.metrics ?? []).map(m => (
                <div key={m.key}>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className={`text-xs ${m.key === metric.key ? 'font-semibold text-gray-900 dark:text-gray-100' : 'text-gray-600 dark:text-gray-300'}`}>
                      {m.label}
                    </span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {m.normalizedScore != null ? `${m.normalizedScore}/100` : '—'}
                    </span>
                  </div>
                  <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${scoreColor(m.normalizedScore)}`}
                      style={{ width: `${m.normalizedScore ?? 0}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Ability card
// ---------------------------------------------------------------------------

function AbilityCard({ ability, periodType, onMetricClick }) {
  const tCfg  = TREND_CONFIG[ability.trend] ?? TREND_CONFIG.stable
  const TIcon = tCfg.Icon

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex flex-col gap-3">
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 leading-tight">{ability.name}</p>
          <p className="text-xs text-gray-400 dark:text-gray-500">{ability.subLabel}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${tCfg.color} ${tCfg.bg}`}>
            <TIcon className="w-3 h-3" />
            {tCfg.label}
          </span>
          <BlockNoteTooltip blockNotes={ability.blockNotes} periodType={periodType} />
        </div>
      </div>

      {/* Score */}
      <div className="flex items-end gap-2">
        <span className={`text-4xl font-bold leading-none ${scoreTextColor(ability.score)}`}>
          {ability.score ?? '—'}
        </span>
        <span className="text-sm text-gray-400 mb-1">/100</span>
      </div>

      {/* Progress bar */}
      <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${scoreColor(ability.score)}`}
          style={{ width: `${ability.score ?? 0}%` }}
        />
      </div>

      {/* Metric rows */}
      <div className="space-y-1.5 mt-1">
        {(ability.metrics ?? []).map(m => (
          <button
            key={m.key}
            onClick={() => onMetricClick(ability, m)}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors group text-left"
          >
            <span className={`text-xs px-1.5 py-0.5 rounded font-medium shrink-0 ${WEIGHT_BADGE[m.weight]}`}>
              {m.weight}
            </span>
            <span className="text-xs text-gray-600 dark:text-gray-300 flex-1 truncate">{m.label}</span>
            <span className="text-xs font-medium text-gray-700 dark:text-gray-200 shrink-0">
              {formatVal(m.value, m.decimals, m.unit)}
            </span>
            <MetricTrendArrow trend={m.trend} />
            <ChevronRight className="w-3 h-3 text-gray-300 dark:text-gray-600 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// AbilityTracker
// ---------------------------------------------------------------------------

export default function AbilityTracker() {
  const { data: raw, loading, error } = useFetch('/fitness/abilities')
  const { data: periodRaw } = useFetch('/periods/current')

  const [modal, setModal] = useState(null) // { ability, metric }

  const abilities   = raw?.abilities ?? []
  const periodType  = periodRaw?.period_type ?? periodRaw?.type ?? null

  // Close modal on Escape key
  useEffect(() => {
    if (!modal) return
    const handler = e => { if (e.key === 'Escape') setModal(null) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [modal])

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">Ability Tracker</h2>
        <p className="text-sm text-gray-400 text-center py-6">Loading ability data…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">Ability Tracker</h2>
        <p className="text-sm text-red-500 text-center py-6">Could not load ability data</p>
      </div>
    )
  }

  return (
    <>
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Ability Tracker</h2>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
              Friel six-ability model — click any metric row for the 7-week trend
            </p>
          </div>
          {periodType && (
            <span className="text-xs px-2 py-1 rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 font-medium capitalize">
              {periodType} block
            </span>
          )}
        </div>

        {abilities.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">
            No ability data yet — complete some sessions to see scores
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {abilities.map(a => (
              <AbilityCard
                key={a.key}
                ability={a}
                periodType={periodType}
                onMetricClick={(ability, metric) => setModal({ ability, metric })}
              />
            ))}
          </div>
        )}
      </div>

      {modal && (
        <DetailModal
          ability={modal.ability}
          metric={modal.metric}
          onClose={() => setModal(null)}
        />
      )}
    </>
  )
}
