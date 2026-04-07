import { useState, useMemo } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Cell,
} from 'recharts'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useFetch } from '../../hooks/useApi.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SPORTS = ['cycling', 'mtb', 'running', 'swimming']

const SPORT_LABELS = {
  cycling:  'Cycling',
  mtb:      'MTB',
  running:  'Running',
  swimming: 'Swimming',
}

// Zone model definitions: id, label, availability, zones array
const ZONE_MODELS = [
  {
    id: 'fthr',
    label: 'HR / FTHR',
    availableFor: null, // always available
    zones: [
      { key: 'Z1',  label: 'Z1',  color: '#60A5FA', group: 'easy' },
      { key: 'Z2',  label: 'Z2',  color: '#34D399', group: 'easy' },
      { key: 'Z3',  label: 'Z3',  color: '#FBBF24', group: 'moderate' },
      { key: 'Z4',  label: 'Z4',  color: '#F97316', group: 'moderate' },
      { key: 'Z5a', label: 'Z5a', color: '#EF4444', group: 'hard' },
      { key: 'Z5b', label: 'Z5b', color: '#DC2626', group: 'hard' },
      { key: 'Z5c', label: 'Z5c', color: '#991B1B', group: 'hard' },
    ],
    groups: [
      { key: 'easy',     label: 'Easy (Z1-Z2)',     target: 70 },
      { key: 'moderate', label: 'Moderate (Z3-Z4)', target: 30 },
      { key: 'hard',     label: 'Hard (Z5+)',        target: 0  },
    ],
    methodNote: 'Friel base target: 70% easy / 30% moderate / 0% hard. Build target: 80% / 0% / 20%.',
  },
  {
    id: 'maxhr',
    label: 'HR / Max HR',
    availableFor: null,
    zones: [
      { key: 'Z1',  label: '<75%',  color: '#60A5FA', group: 'easy' },
      { key: 'Z2',  label: '75-86%',color: '#34D399', group: 'easy' },
      { key: 'Z3',  label: '87-93%',color: '#FBBF24', group: 'moderate' },
      { key: 'Z4',  label: '94-99%',color: '#F97316', group: 'moderate' },
      { key: 'Z5a', label: '≥100%', color: '#EF4444', group: 'hard' },
      { key: 'Z5b', label: 'Z5b',   color: '#DC2626', group: 'hard' },
      { key: 'Z5c', label: 'Z5c',   color: '#991B1B', group: 'hard' },
    ],
    groups: [
      { key: 'easy',     label: 'Easy (<75%)',      target: 75 },
      { key: 'moderate', label: 'Moderate (75-87%)', target: 20 },
      { key: 'hard',     label: 'Hard (>87%)',       target: 5  },
    ],
    methodNote: '3-zone model: easy < 75% HRmax, moderate 75–87%, hard > 87%.',
  },
  {
    id: 'ftp',
    label: 'Power / FTP',
    availableFor: ['cycling', 'mtb'],
    // Keys match Garmin's pZ1-pZ6 power zone export in zone_distribution JSONB
    zones: [
      { key: 'pZ1', label: 'Z1 Active Recovery', color: '#60A5FA', group: 'endurance' },
      { key: 'pZ2', label: 'Z2 Endurance',        color: '#34D399', group: 'endurance' },
      { key: 'pZ3', label: 'Z3 Tempo',            color: '#FBBF24', group: 'tempo' },
      { key: 'pZ4', label: 'Z4 Threshold',        color: '#F97316', group: 'tempo' },
      { key: 'pZ5', label: 'Z5 VO2max',           color: '#EF4444', group: 'highintensity' },
      { key: 'pZ6', label: 'Z6 Anaerobic',        color: '#991B1B', group: 'highintensity' },
    ],
    groups: [
      { key: 'endurance',     label: 'Endurance (Z1-Z2)', target: 70 },
      { key: 'tempo',         label: 'Tempo (Z3-Z4)',      target: 20 },
      { key: 'highintensity', label: 'High intensity (Z5+)', target: 10 },
    ],
    methodNote: 'Coggan power zones anchored to FTP. Polarised target: 80% endurance / 0% tempo / 20% high intensity.',
  },
  {
    id: 'vdot',
    label: 'Pace / VDOT',
    availableFor: ['running'],
    zones: [
      { key: 'E', label: 'E Easy',    color: '#60A5FA', group: 'easy' },
      { key: 'M', label: 'M Marathon',color: '#34D399', group: 'quality' },
      { key: 'T', label: 'T Threshold',color: '#FBBF24', group: 'quality' },
      { key: 'I', label: 'I Interval', color: '#EF4444', group: 'hard' },
      { key: 'R', label: 'R Rep',      color: '#991B1B', group: 'hard' },
    ],
    groups: [
      { key: 'easy',    label: 'Easy (E)',    target: 80 },
      { key: 'quality', label: 'Quality (M/T)', target: 15 },
      { key: 'hard',    label: 'Hard (I/R)',  target: 5  },
    ],
    methodNote: 'Daniels VDOT pace zones. Target distribution: 80% easy / 15% quality / 5% hard.',
  },
  {
    id: 'css',
    label: 'Swim / CSS',
    availableFor: ['swimming'],
    zones: [
      { key: 'Z1',  label: 'Z1 Recovery',  color: '#60A5FA', group: 'easy' },
      { key: 'Z2',  label: 'Z2 Aerobic',   color: '#34D399', group: 'easy' },
      { key: 'Z3',  label: 'Z3 Tempo',     color: '#FBBF24', group: 'moderate' },
      { key: 'Z4',  label: 'Z4 Threshold', color: '#F97316', group: 'hard' },
      { key: 'Z5a', label: 'Z5a VO2max',   color: '#EF4444', group: 'hard' },
      { key: 'Z5b', label: 'Z5b Max',      color: '#991B1B', group: 'hard' },
    ],
    groups: [
      { key: 'easy',     label: 'Easy (Z1-Z2)',     target: 65 },
      { key: 'moderate', label: 'Moderate (Z3)',     target: 25 },
      { key: 'hard',     label: 'Hard (Z4-Z5)',      target: 10 },
    ],
    methodNote: 'CSS (critical swim speed) pace zones. Target: 65% easy / 25% moderate / 10% hard.',
  },
]

const PERIODS = ['Week', 'Month', 'Quarter', 'Year']

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function isoDate(d) {
  return d.toISOString().slice(0, 10)
}

function getWeekRange(offsetWeeks = 0) {
  const today = new Date()
  const dow   = today.getDay()
  const monday = new Date(today)
  monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1) + offsetWeeks * 7)
  monday.setHours(0, 0, 0, 0)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  return { from: isoDate(monday), to: isoDate(sunday), label: `Week of ${monday.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })}` }
}

function getPeriodRange(period, weekOffset = 0) {
  const now = new Date()
  if (period === 'Week') {
    return getWeekRange(weekOffset)
  }
  if (period === 'Month') {
    const from = new Date(now.getFullYear(), now.getMonth(), 1)
    const to   = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    return { from: isoDate(from), to: isoDate(to), label: now.toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' }) }
  }
  if (period === 'Quarter') {
    const q    = Math.floor(now.getMonth() / 3)
    const from = new Date(now.getFullYear(), q * 3, 1)
    const to   = new Date(now.getFullYear(), q * 3 + 3, 0)
    const qNames = ['Q1', 'Q2', 'Q3', 'Q4']
    return { from: isoDate(from), to: isoDate(to), label: `${qNames[q]} ${now.getFullYear()}` }
  }
  // Year
  const from = new Date(now.getFullYear(), 0, 1)
  const to   = new Date(now.getFullYear(), 11, 31)
  return { from: isoDate(from), to: isoDate(to), label: String(now.getFullYear()) }
}

function secsToHrs(secs) {
  return Math.round((secs / 3600) * 10) / 10
}

// ---------------------------------------------------------------------------
// Custom tooltip
// ---------------------------------------------------------------------------

function ZoneTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const secs   = payload[0]?.value ?? 0
  const total  = payload[0]?.payload?.totalSec ?? 1
  const pct    = total > 0 ? Math.round(secs / total * 100) : 0
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow px-3 py-2 text-xs">
      <p className="font-semibold text-gray-700 dark:text-gray-200 mb-0.5">{label}</p>
      <p className="text-gray-600 dark:text-gray-300">{secsToHrs(secs)} hrs ({pct}%)</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Filter button
// ---------------------------------------------------------------------------

function FilterBtn({ active, disabled, onClick, children }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
        disabled
          ? 'opacity-30 cursor-not-allowed bg-gray-100 dark:bg-gray-700 text-gray-400'
          : active
          ? 'bg-blue-600 text-white dark:bg-blue-500'
          : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
      }`}
    >
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// ZoneDistribution
// ---------------------------------------------------------------------------

export default function ZoneDistribution() {
  const [selectedSports, setSelectedSports] = useState(['cycling', 'mtb', 'running', 'swimming'])
  const [zoneModel, setZoneModel]           = useState('fthr')
  const [period, setPeriod]                 = useState('Month')
  const [weekOffset, setWeekOffset]         = useState(0)

  const { from, to, label: periodLabel } = useMemo(
    () => getPeriodRange(period, weekOffset),
    [period, weekOffset]
  )

  // When multiple sports selected, force fthr model
  const multiSport = selectedSports.length > 1
  const effectiveModel = multiSport && ['ftp', 'vdot', 'css'].includes(zoneModel) ? 'fthr' : zoneModel

  const modelDef = ZONE_MODELS.find(m => m.id === effectiveModel) ?? ZONE_MODELS[0]

  // Build query string
  const sportsParam = selectedSports.join(',')
  const query       = `/fitness/zone-distribution?from=${from}&to=${to}&sports=${sportsParam}`
  const { data, loading, error } = useFetch(query)

  // Build chart data from API response
  const chartData = useMemo(() => {
    if (!data?.zones) return []
    const zones = data.zones
    const totalSec = modelDef.zones.reduce((s, z) => s + (zones[z.key] ?? 0), 0)
    return modelDef.zones.map(z => ({
      zone:     z.label,
      secs:     zones[z.key] ?? 0,
      color:    z.color,
      group:    z.group,
      totalSec,
    }))
  }, [data, modelDef])

  // Summary group totals
  const groupTotals = useMemo(() => {
    if (!chartData.length) return {}
    const totals = {}
    for (const bar of chartData) {
      totals[bar.group] = (totals[bar.group] ?? 0) + bar.secs
    }
    return totals
  }, [chartData])

  const totalZoneSec = useMemo(
    () => Object.values(groupTotals).reduce((a, b) => a + b, 0),
    [groupTotals]
  )

  // Sport toggle — at least one must remain selected
  function toggleSport(sport) {
    setSelectedSports(prev => {
      if (prev.includes(sport)) {
        if (prev.length === 1) return prev // can't deselect last
        return prev.filter(s => s !== sport)
      }
      return [...prev, sport]
    })
  }

  // Zone model availability
  function isModelAvailable(model) {
    if (multiSport && model.availableFor !== null) return false
    if (model.availableFor === null) return true
    return selectedSports.every(s => model.availableFor.includes(s))
  }

  const hasData      = (data?.sessions_with_zones ?? 0) > 0
  const hasSessions  = (data?.total_sessions ?? 0) > 0

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">Zone Distribution</h2>

      {/* Filter rows */}
      <div className="space-y-2 mb-4">
        {/* Sport filter */}
        <div className="flex flex-wrap gap-1.5">
          {SPORTS.map(sport => (
            <FilterBtn
              key={sport}
              active={selectedSports.includes(sport)}
              onClick={() => toggleSport(sport)}
            >
              {SPORT_LABELS[sport]}
            </FilterBtn>
          ))}
        </div>

        {/* Zone model filter */}
        <div className="flex flex-wrap gap-1.5">
          {ZONE_MODELS.map(model => {
            const available = isModelAvailable(model)
            const active    = effectiveModel === model.id
            return (
              <FilterBtn
                key={model.id}
                active={active}
                disabled={!available}
                onClick={() => available && setZoneModel(model.id)}
              >
                {model.label}
              </FilterBtn>
            )
          })}
          {multiSport && (
            <span className="text-xs text-gray-400 dark:text-gray-500 self-center ml-1">
              Multi-sport: HR/FTHR only
            </span>
          )}
        </div>

        {/* Period filter */}
        <div className="flex flex-wrap items-center gap-1.5">
          {PERIODS.map(p => (
            <FilterBtn
              key={p}
              active={period === p}
              onClick={() => { setPeriod(p); setWeekOffset(0) }}
            >
              {p}
            </FilterBtn>
          ))}

          {/* Week navigation */}
          {period === 'Week' && (
            <div className="flex items-center gap-1 ml-2">
              <button
                onClick={() => setWeekOffset(w => w - 1)}
                className="p-0.5 rounded text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                aria-label="Previous week"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-xs text-gray-600 dark:text-gray-300 min-w-[120px] text-center">
                {periodLabel}
              </span>
              <button
                onClick={() => setWeekOffset(w => Math.min(0, w + 1))}
                disabled={weekOffset === 0}
                className="p-0.5 rounded text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                aria-label="Next week"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {period !== 'Week' && periodLabel && (
            <span className="text-xs text-gray-400 dark:text-gray-500 ml-1">{periodLabel}</span>
          )}
        </div>
      </div>

      {/* Chart */}
      {loading && (
        <div className="flex items-center justify-center h-44">
          <p className="text-sm text-gray-400">Loading…</p>
        </div>
      )}

      {!loading && error && (
        <div className="flex items-center justify-center h-44">
          <p className="text-sm text-red-500">Could not load zone data</p>
        </div>
      )}

      {!loading && !error && !hasSessions && (
        <div className="flex items-center justify-center h-44">
          <p className="text-sm text-gray-400 dark:text-gray-500">No sessions in this period</p>
        </div>
      )}

      {!loading && !error && hasSessions && !hasData && (
        <div className="flex flex-col items-center justify-center h-44 gap-1">
          <p className="text-sm text-gray-400 dark:text-gray-500">
            {data.total_sessions} session{data.total_sessions > 1 ? 's' : ''} found — no zone data yet
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500">
            Zone distribution is populated when sessions include HR or power data
          </p>
        </div>
      )}

      {!loading && !error && hasData && (
        <>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData} margin={{ top: 16, right: 4, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" className="dark:stroke-gray-700" />
              <XAxis
                dataKey="zone"
                tick={{ fontSize: 11, fill: '#9CA3AF' }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tickFormatter={v => `${secsToHrs(v)}h`}
                tick={{ fontSize: 10, fill: '#9CA3AF' }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip content={<ZoneTooltip />} />
              <Bar dataKey="secs" radius={[3, 3, 0, 0]} label={{
                position: 'top',
                formatter: v => v > 0 ? `${secsToHrs(v)}h` : '',
                fontSize: 10,
                fill: '#6B7280',
              }}>
                {chartData.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>

          {/* Summary row */}
          <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-700">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {modelDef.groups.map(g => {
                const secs = groupTotals[g.key] ?? 0
                const pct  = totalZoneSec > 0 ? Math.round(secs / totalZoneSec * 100) : 0
                const diff = pct - g.target
                const onTarget = Math.abs(diff) <= 5

                return (
                  <div key={g.key} className="text-center">
                    <p className="text-xs text-gray-500 dark:text-gray-400">{g.label}</p>
                    <p className="text-lg font-bold text-gray-800 dark:text-gray-100 leading-tight">
                      {pct}%
                    </p>
                    <p className="text-xs text-gray-400 dark:text-gray-500">{secsToHrs(secs)} hrs</p>
                    {g.target > 0 && (
                      <p className={`text-xs mt-0.5 ${
                        onTarget
                          ? 'text-green-600 dark:text-green-400'
                          : diff > 5
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-blue-600 dark:text-blue-400'
                      }`}>
                        target {g.target}%
                        {!onTarget && ` (${diff > 0 ? '+' : ''}${diff}%)`}
                      </p>
                    )}
                  </div>
                )
              })}

              {/* Methodology note */}
              <div className="sm:col-span-1 col-span-2 sm:col-start-auto">
                <p className="text-xs text-gray-400 dark:text-gray-500 leading-relaxed">
                  {modelDef.methodNote}
                </p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
