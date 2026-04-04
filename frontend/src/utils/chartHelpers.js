// Chart data transformation helpers — used by FitnessChart

/**
 * Transforms CTL/ATL/TSB history from GET /fitness/snapshots into Recharts-ready data.
 * Each entry: { week: 'Mar 24', ctl: 68.4, atl: 72.1, tsb: -3.7 }
 * Snapshots are weekly, so slice(-weeksBack) keeps the last N weekly data points.
 */
export function buildFitnessChartData(history = [], weeksBack = 12) {
  if (!history.length) return []

  const sorted = [...history].sort((a, b) => new Date(a.date) - new Date(b.date))
  const sliced = sorted.slice(-weeksBack)  // weekly snapshots — keep last N weeks

  // Deduplicate to one entry per ISO week using UTC date methods to avoid TZ drift.
  // snapshot_date arrives as 'YYYY-MM-DD'; new Date('YYYY-MM-DD') parses as UTC midnight.
  const weeks = {}
  for (const entry of sliced) {
    const date = new Date(entry.date)
    if (isNaN(date.getTime())) continue
    // Monday of the ISO week containing this date (UTC)
    const dayOfWeek = date.getUTCDay() === 0 ? 7 : date.getUTCDay() // treat Sunday as 7
    const monday = new Date(date)
    monday.setUTCDate(date.getUTCDate() - dayOfWeek + 1)
    const key = monday.toISOString().slice(0, 10)
    weeks[key] = entry
  }

  return Object.entries(weeks)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, entry]) => ({
      week:    new Date(weekStart + 'T00:00:00Z').toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
      ctl:     entry.ctl    != null ? +Number(entry.ctl).toFixed(1)  : null,
      atl:     entry.atl    != null ? +Number(entry.atl).toFixed(1)  : null,
      tsb:     entry.tsb    != null ? +Number(entry.tsb).toFixed(1)  : null,
      rawDate: weekStart,
    }))
}
