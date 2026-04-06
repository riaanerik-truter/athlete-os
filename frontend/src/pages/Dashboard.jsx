import { useMemo, useState } from 'react'
import { useAthlete } from '../context/AthleteContext.jsx'
import { useFetch } from '../hooks/useApi.js'
import MorningForm from '../components/shared/MorningForm.jsx'
import { usePrefs } from '../hooks/usePrefs.js'
import WelcomeTour from '../components/shared/WelcomeTour.jsx'

import KpiCard          from '../components/dashboard/KpiCard.jsx'
import ReadinessCard    from '../components/dashboard/ReadinessCard.jsx'
import FitnessChart     from '../components/dashboard/FitnessChart.jsx'
import SessionList      from '../components/dashboard/SessionList.jsx'
import RacePrediction   from '../components/dashboard/RacePrediction.jsx'
import HealthMetrics    from '../components/dashboard/HealthMetrics.jsx'
import GoalProgress     from '../components/dashboard/GoalProgress.jsx'
import DiaryPanel       from '../components/dashboard/DiaryPanel.jsx'
import UsageSummary     from '../components/dashboard/UsageSummary.jsx'
import AbilityTracker   from '../components/dashboard/AbilityTracker.jsx'
import ZoneDistribution from '../components/dashboard/ZoneDistribution.jsx'

// ---------------------------------------------------------------------------
// KPI derivation helpers
// ---------------------------------------------------------------------------

function ctlStatus(ctl) {
  if (ctl == null) return 'blue'
  if (ctl >= 70)   return 'green'
  if (ctl >= 40)   return 'blue'
  return 'amber'
}

function tsbStatus(tsb) {
  if (tsb == null)  return 'blue'
  if (tsb >= 5)     return 'green'    // fresh
  if (tsb >= -10)   return 'blue'     // normal training
  if (tsb >= -25)   return 'amber'    // fatigued
  return 'red'                         // overreached
}

function tsbLabel(tsb) {
  if (tsb == null)  return null
  if (tsb >= 5)     return 'Fresh'
  if (tsb >= -10)   return 'Optimal'
  if (tsb >= -25)   return 'Fatigued'
  return 'High fatigue'
}

function readinessStatus(score) {
  if (score == null) return 'blue'
  if (score >= 80)   return 'green'
  if (score >= 65)   return 'blue'
  if (score >= 50)   return 'amber'
  return 'red'
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export default function Dashboard() {
  const { snapshot, loading: athleteLoading } = useAthlete()
  const { prefs } = usePrefs()
  const { data: periodsRes } = useFetch('/season')
  const { data: healthRes }  = useFetch('/health/daily?limit=2')
  const [morningFormOpen, setMorningFormOpen] = useState(false)

  const periods = Array.isArray(periodsRes)
    ? periodsRes
    : (periodsRes?.data ?? [])

  const healthEntries = Array.isArray(healthRes) ? healthRes : (healthRes?.data ?? [])
  const latestHealth  = healthEntries.sort((a, b) =>
    new Date(b.date ?? b.metric_date) - new Date(a.date ?? a.metric_date)
  )[0]

  // Compare CTL/ATL/TSB this week vs last snapshot
  const ctl      = snapshot?.ctl     ?? null
  const atl      = snapshot?.atl     ?? null
  const tsb      = snapshot?.tsb     ?? null
  const ftp      = snapshot?.ftp_current ?? null
  const readiness = snapshot?.readiness_score ?? null

  return (
    <main className="max-w-screen-xl mx-auto px-4 py-6 space-y-4">
      <WelcomeTour />
      <MorningForm open={morningFormOpen} onClose={() => setMorningFormOpen(false)} />

      {/* Row 1 — Four KPI cards */}
      <div data-tour="kpi-cards" className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <ReadinessCard
          score={readiness}
          hrvTrend={latestHealth?.hrv_trend ?? null}
          date={snapshot?.snapshot_date}
          onLogToday={() => setMorningFormOpen(true)}
        />

        <KpiCard
          label="CTL"
          value={ctl != null ? ctl.toFixed(1) : null}
          statusLabel={ctl != null ? (ctl >= 70 ? 'Building' : ctl >= 40 ? 'Base' : 'Low') : null}
          status={ctlStatus(ctl)}
          deltaLabel={snapshot?.ctl_delta != null
            ? `${snapshot.ctl_delta > 0 ? '+' : ''}${snapshot.ctl_delta.toFixed(1)} this week`
            : null}
          delta={snapshot?.ctl_delta ?? null}
        />

        <KpiCard
          label="TSB (Form)"
          value={tsb != null ? tsb.toFixed(1) : null}
          statusLabel={tsbLabel(tsb)}
          status={tsbStatus(tsb)}
          deltaLabel={snapshot?.tsb_delta != null
            ? `${snapshot.tsb_delta > 0 ? '+' : ''}${snapshot.tsb_delta.toFixed(1)}`
            : null}
          delta={snapshot?.tsb_delta ?? null}
        />

        <KpiCard
          label="FTP"
          value={ftp != null ? ftp : null}
          unit="W"
          statusLabel={ftp ? 'Current' : 'Not set'}
          status="blue"
          deltaLabel={snapshot?.ftp_delta != null
            ? `${snapshot.ftp_delta > 0 ? '+' : ''}${snapshot.ftp_delta}W`
            : null}
          delta={snapshot?.ftp_delta ?? null}
        />
      </div>

      {/* Row 2 — Ability Tracker (full width) */}
      <AbilityTracker />

      {/* Row 3 — Zone Distribution (full width) */}
      <ZoneDistribution />

      {/* Row 4 — Fitness chart (left) + This week (right) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="md:col-span-2">
          <FitnessChart periods={periods} weeksBack={prefs.chart_range} />
        </div>
        <div data-tour="session-list">
          <SessionList />
        </div>
      </div>

      {/* Row 5 — Race prediction (left) + Health (right) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div data-tour="race-prediction" className="md:col-span-2">
          <RacePrediction />
        </div>
        <div>
          <HealthMetrics />
        </div>
      </div>

      {/* Row 6 — Goals (full width) */}
      <GoalProgress />

      {/* Row 7 — Diary (left) + Usage (right) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <DiaryPanel />
        <UsageSummary />
      </div>

    </main>
  )
}
