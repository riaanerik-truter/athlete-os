// Chart data transformation helpers — used by FitnessChart
// Implemented in step 5

/**
 * Transforms CTL/ATL history from GET /fitness/ctlatl into Recharts-ready data.
 * Each entry: { week: 'Mar 24', ctl: 68.4, atl: 72.1, tsb: -3.7 }
 */
export function buildFitnessChartData(history = [], weeksBack = 12) {
  if (!history.length) return []

  const sorted = [...history].sort((a, b) => new Date(a.date) - new Date(b.date))
  const sliced = sorted.slice(-weeksBack * 7)  // daily entries, keep last N weeks

  // Aggregate to weekly (last entry per week)
  const weeks = {}
  for (const entry of sliced) {
    const date = new Date(entry.date)
    if (isNaN(date.getTime())) continue
    const monday = new Date(date)
    monday.setDate(date.getDate() - date.getDay() + 1)
    const key = monday.toISOString().slice(0, 10)
    weeks[key] = entry
  }

  return Object.entries(weeks).map(([weekStart, entry]) => ({
    week:    new Date(weekStart).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' }),
    ctl:     entry.ctl    != null ? +Number(entry.ctl).toFixed(1)  : null,
    atl:     entry.atl    != null ? +Number(entry.atl).toFixed(1)  : null,
    tsb:     entry.tsb    != null ? +Number(entry.tsb).toFixed(1)  : null,
    rawDate: weekStart,
  }))
}
