import { useFetch } from '../../hooks/useApi.js'
import { formatDuration } from '../../utils/formatters.js'

const TODAY = new Date().toISOString().slice(0, 10)

function getStartOfWeek() {
  const d = new Date()
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)  // Monday
  d.setDate(diff)
  return d.toISOString().slice(0, 10)
}

function getEndOfWeek() {
  const d = new Date()
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? 0 : 7)   // Sunday
  d.setDate(diff)
  return d.toISOString().slice(0, 10)
}

function sessionStatus(session) {
  if (session.completed_session_id) return 'done'
  if (session.scheduled_date === TODAY)  return 'today'
  if (session.scheduled_date < TODAY)    return 'missed'
  return 'upcoming'
}

const STATUS_ICON = {
  done:     { icon: '✅', label: 'Completed' },
  today:    { icon: '⏳', label: 'Today'     },
  missed:   { icon: '❌', label: 'Missed'    },
  upcoming: { icon: '○',  label: 'Upcoming'  },
}

const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function dayAbbr(isoDate) {
  if (!isoDate) return ''
  return DAY_ABBR[new Date(isoDate).getDay()]
}

export default function SessionList() {
  const weekStart = getStartOfWeek()
  const weekEnd   = getEndOfWeek()

  const { data: sessionsRes, loading, error } = useFetch(
    `/sessions/planned?from=${weekStart}&to=${weekEnd}&limit=10`
  )
  const { data: weekData } = useFetch('/weeks/current')

  const sessions = Array.isArray(sessionsRes)
    ? sessionsRes
    : (sessionsRes?.data ?? [])

  // Volume bar
  const plannedHrs = weekData?.planned_volume_hrs ?? 0
  const actualHrs  = weekData?.actual_volume_hrs  ?? 0
  const compliance = weekData?.compliance_pct      ?? null
  const volPct     = plannedHrs > 0 ? Math.min(100, (actualHrs / plannedHrs) * 100) : 0

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">This Week</h2>

      {loading && <p className="text-sm text-gray-400 py-4 text-center">Loading…</p>}
      {error   && <p className="text-sm text-red-500 py-4 text-center">Could not load sessions</p>}

      {!loading && !error && (
        <>
          {sessions.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500 py-2">No sessions planned this week</p>
          ) : (
            <ul className="space-y-2">
              {sessions.map(s => {
                const st = sessionStatus(s)
                const isToday = st === 'today'
                return (
                  <li
                    key={s.id}
                    className={`flex items-center gap-3 px-2 py-1.5 rounded-lg transition-colors ${
                      isToday
                        ? 'bg-blue-50 dark:bg-blue-900/20 ring-1 ring-accent/30'
                        : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                    }`}
                  >
                    <span className="text-base leading-none w-5 shrink-0 text-center">
                      {STATUS_ICON[st].icon}
                    </span>
                    <span className="text-xs font-medium text-gray-400 dark:text-gray-500 w-7 shrink-0">
                      {dayAbbr(s.scheduled_date)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm truncate ${isToday ? 'font-semibold text-gray-900 dark:text-gray-100' : 'text-gray-700 dark:text-gray-300'}`}>
                        {s.title ?? s.session_type_code ?? 'Session'}
                      </p>
                      {s.target_duration_min && (
                        <p className="text-xs text-gray-400 dark:text-gray-500">{s.target_duration_min}min</p>
                      )}
                    </div>
                    {s.sport && (
                      <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0 capitalize">{s.sport}</span>
                    )}
                  </li>
                )
              })}
            </ul>
          )}

          {/* Volume progress bar */}
          {plannedHrs > 0 && (
            <div className="mt-1 pt-3 border-t border-gray-100 dark:border-gray-700">
              <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1.5">
                <span>
                  {actualHrs.toFixed(1)} / {plannedHrs.toFixed(1)} hrs
                </span>
                {compliance != null && (
                  <span className={compliance >= 80 ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}>
                    {compliance}% compliance
                  </span>
                )}
              </div>
              <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent dark:bg-accent-dark rounded-full transition-all"
                  style={{ width: `${volPct}%` }}
                />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
