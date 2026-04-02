// Implemented in step 2 (shared components)

export function safeDate(value) {
  if (!value) return null
  const d = new Date(value)
  return isNaN(d.getTime()) ? null : d
}

export function formatDuration(seconds) {
  if (seconds == null) return '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

export function formatDate(iso) {
  const d = safeDate(iso)
  if (!d) return '—'
  return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function formatNumber(n, decimals = 1) {
  if (n == null) return '—'
  return Number(n).toFixed(decimals)
}

export function formatPace(secPer100m) {
  if (secPer100m == null) return '—'
  const m = Math.floor(secPer100m / 60)
  const s = Math.round(secPer100m % 60)
  return `${m}:${String(s).padStart(2, '0')}/100m`
}

export function formatWkg(watts, weightKg) {
  if (!watts || !weightKg) return '—'
  return `${(watts / weightKg).toFixed(2)} W/kg`
}

export function daysUntil(isoDate) {
  const d = safeDate(isoDate)
  if (!d) return null
  const diff = d - new Date()
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)))
}
