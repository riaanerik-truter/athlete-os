// Readiness score card with SVG colour ring and HRV indicator

const RADIUS = 40
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

function scoreToStatus(score) {
  if (score == null) return { label: 'No data', color: '#6B7280', textColor: 'text-gray-500' }
  if (score >= 80)  return { label: 'Excellent', color: '#22C55E', textColor: 'text-green-600 dark:text-green-400' }
  if (score >= 65)  return { label: 'Good',      color: '#3B82F6', textColor: 'text-blue-600 dark:text-blue-400'  }
  if (score >= 50)  return { label: 'Moderate',  color: '#F59E0B', textColor: 'text-amber-600 dark:text-amber-400' }
  return                    { label: 'Low',       color: '#EF4444', textColor: 'text-red-600 dark:text-red-400'    }
}

function scoreToHrvStatus(trend) {
  if (!trend) return null
  if (trend === 'up')     return { label: 'HRV trending up',   color: 'text-green-600 dark:text-green-400' }
  if (trend === 'stable') return { label: 'HRV stable',        color: 'text-blue-500' }
  return                         { label: 'HRV trending down',  color: 'text-amber-600 dark:text-amber-400' }
}

/**
 * Props:
 *   score      number   — 0-100 readiness score
 *   hrvTrend   string   — 'up' | 'down' | 'stable' (optional)
 *   date       string   — ISO date string (optional)
 *   onLogToday function — opens morning form (optional)
 */
export default function ReadinessCard({ score, hrvTrend, date, onLogToday }) {
  const status     = scoreToStatus(score)
  const hrvStatus  = scoreToHrvStatus(hrvTrend)
  const dashFilled = score != null ? (score / 100) * CIRCUMFERENCE : 0
  const dashGap    = CIRCUMFERENCE - dashFilled

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex flex-col gap-2">
      <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Readiness</p>

      <div className="flex items-center gap-4">
        {/* Ring */}
        <div className="relative shrink-0">
          <svg width="96" height="96" viewBox="0 0 96 96">
            {/* Track */}
            <circle
              cx="48" cy="48" r={RADIUS}
              fill="none"
              stroke="currentColor"
              strokeWidth="8"
              className="text-gray-100 dark:text-gray-700"
            />
            {/* Fill */}
            <circle
              cx="48" cy="48" r={RADIUS}
              fill="none"
              stroke={status.color}
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={`${dashFilled} ${dashGap}`}
              strokeDashoffset={CIRCUMFERENCE / 4}
              transform="rotate(-90 48 48)"
              style={{ transition: 'stroke-dasharray 0.6s ease' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-bold text-gray-900 dark:text-gray-100 leading-none">
              {score != null ? score : '—'}
            </span>
            <span className="text-xs text-gray-400">/100</span>
          </div>
        </div>

        {/* Labels */}
        <div className="flex flex-col gap-1.5">
          <span className={`text-sm font-semibold ${status.textColor}`}>{status.label}</span>
          {date && (
            <span className="text-xs text-gray-400 dark:text-gray-500">
              {new Date(date).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })}
            </span>
          )}
          {hrvStatus && (
            <span className={`text-xs ${hrvStatus.color}`}>{hrvStatus.label}</span>
          )}
          {onLogToday && (
            <button
              onClick={onLogToday}
              className="mt-1 text-xs text-accent dark:text-accent-dark hover:underline"
            >
              Log today
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
