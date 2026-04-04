import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ReferenceLine,
} from 'recharts'
import { useFetch } from '../../hooks/useApi.js'
import { buildFitnessChartData } from '../../utils/chartHelpers.js'

// Custom tooltip showing exact values on hover
function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg px-3 py-2 text-xs">
      <p className="font-semibold text-gray-700 dark:text-gray-200 mb-1">{label}</p>
      {payload.map(p => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
          <span className="text-gray-600 dark:text-gray-300">{p.name}:</span>
          <span className="font-medium text-gray-900 dark:text-gray-100">
            {p.value != null ? p.value.toFixed(1) : '—'}
          </span>
        </div>
      ))}
    </div>
  )
}

const EMPTY_MSG_CLASS = 'flex items-center justify-center h-48 text-sm text-gray-400 dark:text-gray-500'

/**
 * Props:
 *   periods   array  — [{ name, start_date, period_type }] for vertical markers
 *   weeksBack number — how many weeks to show (default 12)
 */
export default function FitnessChart({ periods = [], weeksBack = 12 }) {
  const { data: raw, loading, error } = useFetch('/fitness/snapshots')

  if (loading) return <div className={EMPTY_MSG_CLASS}>Loading fitness data…</div>
  if (error)   return <div className={EMPTY_MSG_CLASS}>Could not load fitness data</div>

  // Normalize snapshot_date → date so buildFitnessChartData can use it
  const snaps = Array.isArray(raw) ? raw : (raw?.data ?? [])
  const history = snaps.map(s => ({ ...s, date: s.snapshot_date }))
  const chartData = buildFitnessChartData(history, weeksBack)

  if (!chartData.length) {
    return <div className={EMPTY_MSG_CLASS}>No fitness data yet — complete some sessions to see trends</div>
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Fitness Trend</h2>
        <span className="text-xs text-gray-400">{weeksBack} weeks</span>
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" className="dark:stroke-gray-700" />

          <XAxis
            dataKey="week"
            tick={{ fontSize: 11, fill: '#9CA3AF' }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 11, fill: '#9CA3AF' }}
            tickLine={false}
            axisLine={false}
          />

          <Tooltip content={<ChartTooltip />} />
          <Legend
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
          />

          {/* Period boundary markers */}
          {periods.map((p, i) => {
            const date = new Date(p.start_date)
            const weekLabel = date.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })
            return (
              <ReferenceLine
                key={i}
                x={weekLabel}
                stroke="#9CA3AF"
                strokeDasharray="4 3"
                label={{ value: p.name ?? p.period_type, position: 'top', fontSize: 10, fill: '#6B7280' }}
              />
            )
          })}

          <Line
            type="monotone"
            dataKey="ctl"
            name="CTL"
            stroke="#3B82F6"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="atl"
            name="ATL"
            stroke="#F97316"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="tsb"
            name="TSB"
            stroke="#22C55E"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
