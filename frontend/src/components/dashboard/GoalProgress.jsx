import { useFetch } from '../../hooks/useApi.js'
import { daysUntil } from '../../utils/formatters.js'

const PRIORITY_STYLE = {
  A: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
  B: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400',
  C: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
}

const STATUS_BAR = {
  on_track:    'bg-green-500',
  at_risk:     'bg-amber-500',
  behind:      'bg-red-500',
  complete:    'bg-gray-400',
}

function GoalCard({ goal }) {
  const days    = goal.target_date ? daysUntil(goal.target_date) : null
  const priority = (goal.priority ?? 'C').toUpperCase()
  const pStyle   = PRIORITY_STYLE[priority] ?? PRIORITY_STYLE.C

  // Progress: either days-based (event goals) or value-based (metric goals)
  let pct = 0
  let progressLabel = null

  if (goal.current_value != null && goal.target_value != null && goal.target_value > 0) {
    pct = Math.min(100, (goal.current_value / goal.target_value) * 100)
    progressLabel = `${goal.current_value} / ${goal.target_value}${goal.unit ? ' ' + goal.unit : ''}`
  } else if (goal.target_date) {
    // Time-based: invert days remaining into progress
    const totalDays = goal.start_date
      ? Math.max(1, (new Date(goal.target_date) - new Date(goal.start_date)) / (1000 * 60 * 60 * 24))
      : 365
    const elapsed = totalDays - (days ?? 0)
    pct = Math.min(100, Math.max(0, (elapsed / totalDays) * 100))
    progressLabel = days != null ? `${days} days` : goal.target_date
  }

  const barColor = STATUS_BAR[goal.status] ?? 'bg-accent dark:bg-accent-dark'

  return (
    <div className="flex items-start gap-3 py-3 border-b border-gray-100 dark:border-gray-700 last:border-0">
      {/* Priority badge */}
      <span className={`mt-0.5 w-6 h-6 shrink-0 rounded-md flex items-center justify-center text-xs font-bold ${pStyle}`}>
        {priority}
      </span>

      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{goal.title}</p>
          {progressLabel && (
            <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">{progressLabel}</span>
          )}
        </div>

        <div className="mt-1.5 h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${barColor}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  )
}

export default function GoalProgress() {
  const { data: res, loading, error } = useFetch('/goals')
  const goals = (Array.isArray(res) ? res : (res?.data ?? []))
    .filter(g => g.status !== 'complete' && g.status !== 'cancelled')
    .sort((a, b) => {
      const order = { A: 0, B: 1, C: 2 }
      return (order[(a.priority ?? 'C').toUpperCase()] ?? 2) - (order[(b.priority ?? 'C').toUpperCase()] ?? 2)
    })

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">Goals</h2>

      {loading && <p className="text-sm text-gray-400 py-4 text-center">Loading…</p>}
      {error   && <p className="text-sm text-red-500 py-4 text-center">Could not load goals</p>}

      {!loading && !error && goals.length === 0 && (
        <p className="text-sm text-gray-400 dark:text-gray-500 py-2">No active goals — add goals in Profile.</p>
      )}

      {!loading && !error && goals.map(g => (
        <GoalCard key={g.id} goal={g} />
      ))}
    </div>
  )
}
