import { useMemo } from 'react'
import { useFetch } from '../../hooks/useApi.js'
import { useAthlete } from '../../context/AthleteContext.jsx'
import { predictRaceTime, projectCtl } from '../../utils/predictions.js'
import { daysUntil } from '../../utils/formatters.js'
import InfoTooltip from '../shared/InfoTooltip.jsx'

const CONF_LABEL = { low: 'Low confidence', moderate: 'Moderate confidence', high: 'High confidence' }
const CONF_COLOR = { low: 'text-red-500', moderate: 'text-amber-500', high: 'text-green-600 dark:text-green-400' }

function TimeRange({ low, high, conf }) {
  if (low == null || high == null) return <span className="text-gray-400">—</span>
  return (
    <div className="flex flex-col items-center">
      <span className="text-2xl font-bold text-gray-900 dark:text-gray-100">
        {low}–{high}
      </span>
      <span className="text-xs text-gray-500 dark:text-gray-400">hours</span>
      {conf && (
        <span className={`text-xs mt-0.5 ${CONF_COLOR[conf] ?? 'text-gray-400'}`}>
          {CONF_LABEL[conf]}
        </span>
      )}
    </div>
  )
}

export default function RacePrediction() {
  const { snapshot } = useAthlete()
  const { data: goalsRes } = useFetch('/goals')
  const { data: sessionsRes } = useFetch('/sessions/planned?limit=50')

  const goals    = Array.isArray(goalsRes) ? goalsRes : (goalsRes?.data ?? [])
  const sessions = Array.isArray(sessionsRes) ? sessionsRes : (sessionsRes?.data ?? [])

  // Find the A-priority event goal
  const aGoal = useMemo(
    () => goals.find(g => (g.priority === 'A' || g.goal_type === 'a_event') && g.target_date),
    [goals]
  )

  const event = useMemo(() => {
    if (!aGoal) return null
    return {
      distance_km:  aGoal.target_distance_km ?? 230,
      elevation_m:  aGoal.target_elevation_m ?? 2540,
    }
  }, [aGoal])

  const ctl       = snapshot?.ctl ?? null
  const ftpWatts  = snapshot?.ftp_current ?? null
  const weightKg  = null  // not in snapshot; athlete profile needed

  const currentPrediction = useMemo(() => {
    if (!event || !ctl || !ftpWatts) return null
    return predictRaceTime({ ctl, ftpWatts, weightKg: weightKg ?? 75, event })
  }, [ctl, ftpWatts, weightKg, event])

  const planPrediction = useMemo(() => {
    if (!event || !ctl || !ftpWatts) return null
    const projected = projectCtl(ctl, sessions)
    return predictRaceTime({ ctl: projected, ftpWatts, weightKg: weightKg ?? 75, event })
  }, [ctl, ftpWatts, weightKg, event, sessions])

  const days    = aGoal ? daysUntil(aGoal.target_date) : null
  const maxDays = 365
  const barPct  = days != null ? Math.max(0, 100 - (days / maxDays) * 100) : 0

  if (!aGoal) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">Race Prediction</h2>
        <p className="text-sm text-gray-400 dark:text-gray-500">Add an A-priority race goal to see a prediction.</p>
      </div>
    )
  }

  const assumptions = currentPrediction?.assumptions ?? []
  const improvements = [
    !weightKg && 'Weight (currently using 75kg estimate)',
    'Recent long ride data (>3hrs)',
    'Previous event history',
  ].filter(Boolean)

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Race Prediction</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{aGoal.title}</p>
        </div>
        <InfoTooltip
          title="Prediction assumptions"
          assumptions={assumptions}
          improvements={improvements}
          note="Friel endurance performance estimation. Not a guarantee — individual response to race conditions varies significantly."
        />
      </div>

      {/* Two-column predictions */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="flex flex-col items-center bg-gray-50 dark:bg-gray-700/50 rounded-lg py-3 px-2 gap-1">
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Current fitness</span>
          <TimeRange
            low={currentPrediction?.low_hrs}
            high={currentPrediction?.high_hrs}
            conf={currentPrediction?.confidence}
          />
        </div>
        <div className="flex flex-col items-center bg-gray-50 dark:bg-gray-700/50 rounded-lg py-3 px-2 gap-1">
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400">If plan continues</span>
          <TimeRange
            low={planPrediction?.low_hrs}
            high={planPrediction?.high_hrs}
            conf={planPrediction?.confidence}
          />
        </div>
      </div>

      {/* Countdown bar */}
      {days != null && (
        <div>
          <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1.5">
            <span>{aGoal.target_date}</span>
            <span className="font-medium">{days} days to go</span>
          </div>
          <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-accent dark:bg-accent-dark rounded-full transition-all"
              style={{ width: `${barPct}%` }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
