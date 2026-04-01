import { useFetch } from '../../hooks/useApi.js'

const CALL_TYPE_LABELS = {
  coach_response:   'Coach messages',
  intent_classify:  'Intent classify',
  summarise:        'Summaries',
  instruction:      'Instructions',
  discovery:        'Discovery',
  embedding:        'Embeddings',
}

const CALL_TYPE_COLORS = {
  coach_response:   '#3B82F6',
  intent_classify:  '#8B5CF6',
  summarise:        '#F97316',
  instruction:      '#22C55E',
  discovery:        '#EC4899',
  embedding:        '#6B7280',
}

function CostBar({ label, cost, maxCost, color }) {
  const pct = maxCost > 0 ? (cost / maxCost) * 100 : 0
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-500 dark:text-gray-400 w-32 shrink-0 truncate">{label}</span>
      <div className="flex-1 h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <span className="text-xs text-gray-500 dark:text-gray-400 w-12 text-right shrink-0">
        ${cost.toFixed(3)}
      </span>
    </div>
  )
}

export default function UsageSummary() {
  const { data: usage, loading, error } = useFetch('/usage')

  const thisMonth = usage?.this_month ?? usage
  const totalCost = thisMonth?.total_cost_usd ?? 0
  const byCallType = thisMonth?.by_call_type ?? usage?.by_call_type ?? {}

  // Predicted monthly: simple linear projection from current day of month
  const dayOfMonth = new Date().getDate()
  const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate()
  const predicted = dayOfMonth > 0 ? (totalCost / dayOfMonth) * daysInMonth : 0

  const callTypeEntries = Object.entries(byCallType)
    .filter(([, v]) => v > 0)
    .sort(([, a], [, b]) => b - a)
  const maxCost = callTypeEntries[0]?.[1] ?? 1

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">API Usage</h2>

      {loading && <p className="text-sm text-gray-400 py-4 text-center">Loading…</p>}
      {error   && <p className="text-sm text-red-500 py-4 text-center">Could not load usage data</p>}

      {!loading && !error && (
        <>
          {/* Summary line */}
          <div className="flex items-baseline gap-4 mb-3">
            <div>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">${totalCost.toFixed(2)}</p>
              <p className="text-xs text-gray-400">this month</p>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-600 dark:text-gray-300">~${predicted.toFixed(2)}</p>
              <p className="text-xs text-gray-400">predicted</p>
            </div>
          </div>

          {/* Breakdown bars */}
          {callTypeEntries.length > 0 ? (
            <div className="space-y-2">
              {callTypeEntries.map(([key, cost]) => (
                <CostBar
                  key={key}
                  label={CALL_TYPE_LABELS[key] ?? key}
                  cost={cost}
                  maxCost={maxCost}
                  color={CALL_TYPE_COLORS[key] ?? '#6B7280'}
                />
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-400 dark:text-gray-500">No AI calls logged yet.</p>
          )}
        </>
      )}
    </div>
  )
}
