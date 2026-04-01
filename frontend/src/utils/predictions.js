// Race prediction calculator — implemented in step 7
// Friel endurance performance estimation model.

function getSustainableFraction(eventDurationHrs) {
  // Longer events = lower fraction of FTP sustainable
  if (eventDurationHrs <= 1)  return 1.05
  if (eventDurationHrs <= 2)  return 0.95
  if (eventDurationHrs <= 4)  return 0.85
  if (eventDurationHrs <= 8)  return 0.75
  if (eventDurationHrs <= 12) return 0.68
  return 0.62
}

function estimateBaseDuration(event) {
  // Rough base time from distance assuming 25km/h average on flat terrain
  return (event.distance_km ?? 100) / 25
}

function calculateConfidence({ ctl, ftpWatts, weightKg, hasLongRideData }) {
  let score = 0
  if (ctl > 50) score++
  if (ftpWatts > 0) score++
  if (weightKg > 0) score++
  if (hasLongRideData) score++
  if (score >= 4) return 'high'
  if (score >= 2) return 'moderate'
  return 'low'
}

function buildAssumptions({ ctl, ftpWatts, weightKg, event }) {
  return [
    `Event: ${event.distance_km}km, ${event.elevation_m}m elevation`,
    `Current CTL: ${ctl?.toFixed(1) ?? '—'}`,
    `Current FTP: ${ftpWatts ?? '—'}W (${ftpWatts && weightKg ? (ftpWatts / weightKg).toFixed(2) : '—'} W/kg at ${weightKg ?? '?'}kg)`,
    `Course demands: ~65–75% FTP sustained`,
  ]
}

export function predictRaceTime({ ctl, ftpWatts, weightKg = 75, event, hasLongRideData = false }) {
  if (!ctl || !ftpWatts) {
    return { low_hrs: null, high_hrs: null, confidence: 'low', assumptions: buildAssumptions({ ctl, ftpWatts, weightKg, event }) }
  }

  const eventDurationHrs   = estimateBaseDuration(event)
  const sustainableFraction = getSustainableFraction(eventDurationHrs)
  const sustainableWatts    = ftpWatts * sustainableFraction
  const ctlModifier         = Math.min(1.0, ctl / 80)
  const climbingCost        = (event.elevation_m ?? 0) * 0.000083

  const baseTime  = event.distance_km / (sustainableWatts * ctlModifier * 0.015)
  const totalTime = baseTime + climbingCost

  const confidence = calculateConfidence({ ctl, ftpWatts, weightKg, hasLongRideData })

  return {
    low_hrs:     +(totalTime * 0.92).toFixed(1),
    high_hrs:    +(totalTime * 1.12).toFixed(1),
    confidence,
    assumptions: buildAssumptions({ ctl, ftpWatts, weightKg, event }),
  }
}

export function projectCtl(currentCtl, plannedSessions) {
  let ctl = currentCtl ?? 0
  for (const session of plannedSessions) {
    ctl = ctl + ((session.target_tss ?? 0) - ctl) / 42
  }
  return +ctl.toFixed(1)
}
