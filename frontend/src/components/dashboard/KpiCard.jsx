import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

const STATUS_STYLES = {
  green: {
    label: 'text-green-700 dark:text-green-400',
    bg:    'bg-green-50 dark:bg-green-900/20',
    dot:   'bg-green-500',
  },
  amber: {
    label: 'text-amber-700 dark:text-amber-400',
    bg:    'bg-amber-50 dark:bg-amber-900/20',
    dot:   'bg-amber-500',
  },
  red: {
    label: 'text-red-700 dark:text-red-400',
    bg:    'bg-red-50 dark:bg-red-900/20',
    dot:   'bg-red-500',
  },
  blue: {
    label: 'text-blue-700 dark:text-blue-400',
    bg:    'bg-blue-50 dark:bg-blue-900/20',
    dot:   'bg-blue-500',
  },
}

/**
 * Props:
 *   label       string   — metric name e.g. "CTL"
 *   value       string   — display value e.g. "68.4"
 *   unit        string   — optional unit e.g. "W" or "bpm"
 *   delta       number   — change vs last period (positive = up)
 *   deltaLabel  string   — human label e.g. "+2.8 this week"
 *   status      string   — 'green' | 'amber' | 'red' | 'blue'
 *   statusLabel string   — e.g. "On track" | "Caution" | "High fatigue"
 */
export default function KpiCard({ label, value, unit, delta, deltaLabel, status = 'blue', statusLabel }) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.blue

  const DeltaIcon = delta == null
    ? null
    : delta > 0
    ? TrendingUp
    : delta < 0
    ? TrendingDown
    : Minus

  const deltaColor = delta == null
    ? ''
    : delta > 0 ? 'text-green-600 dark:text-green-400'
    : delta < 0 ? 'text-red-500 dark:text-red-400'
    : 'text-gray-400'

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex flex-col gap-2">
      <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">{label}</p>

      <div className="flex items-end gap-1">
        <span className="text-3xl font-bold text-gray-900 dark:text-gray-100 leading-none">{value ?? '—'}</span>
        {unit && <span className="text-sm text-gray-500 dark:text-gray-400 mb-0.5">{unit}</span>}
      </div>

      {(DeltaIcon || deltaLabel) && (
        <div className={`flex items-center gap-1 text-xs ${deltaColor}`}>
          {DeltaIcon && <DeltaIcon className="w-3.5 h-3.5" />}
          <span>{deltaLabel ?? (delta > 0 ? `+${delta}` : delta)}</span>
        </div>
      )}

      {statusLabel && (
        <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${style.label} ${style.bg} self-start`}>
          <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
          {statusLabel}
        </div>
      )}
    </div>
  )
}
