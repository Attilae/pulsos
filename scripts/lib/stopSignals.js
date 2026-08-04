// Pure helpers for turning GTFS service supply and optional passenger counts
// into compact, city-normalized stop signals. Kept outside the browser bundle:
// preprocess_lines.js bakes the result into lines.<city>.json.

const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

function gtfsDate(value) {
  const s = String(value ?? '').replace(/-/g, '')
  if (!/^\d{8}$/.test(s)) return null
  const d = new Date(Date.UTC(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8))))
  return Number.isNaN(d.getTime()) ? null : d
}

function dateKey(date) {
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`
}

function eachDate(start, end, fn) {
  for (let t = start.getTime(); t <= end.getTime(); t += 86400000) fn(new Date(t))
}

function baseActive(row, date) {
  if (!row) return false
  const start = gtfsDate(row.start_date)
  const end = gtfsDate(row.end_date)
  if (!start || !end || date < start || date > end) return false
  return String(row[DAY_KEYS[date.getUTCDay()]] ?? '0') === '1'
}

/**
 * Average service-day weight per service_id over the feed's declared date
 * range. A daily service is 1, weekday-only is about 5/7, and one-off service
 * is a small fraction. This prevents Sunday/seasonal trips from counting like
 * everyday trips while remaining deterministic across preprocessing runs.
 */
export function buildServiceWeights(calendarRows = [], calendarDateRows = []) {
  const calendarByService = new Map(calendarRows.map(row => [String(row.service_id), row]))
  const dates = []
  for (const row of calendarRows) {
    const start = gtfsDate(row.start_date)
    const end = gtfsDate(row.end_date)
    if (start) dates.push(start)
    if (end) dates.push(end)
  }
  for (const row of calendarDateRows) {
    const date = gtfsDate(row.date)
    if (date) dates.push(date)
  }
  if (!dates.length) return new Map()

  const start = new Date(Math.min(...dates.map(d => d.getTime())))
  const end = new Date(Math.max(...dates.map(d => d.getTime())))
  const totalDays = Math.max(1, Math.round((end - start) / 86400000) + 1)
  const activeDays = new Map()

  for (const [serviceId, row] of calendarByService) {
    let count = 0
    eachDate(start, end, date => { if (baseActive(row, date)) count++ })
    activeDays.set(serviceId, count)
  }

  // Exceptions replace the base state for that service/date. De-duplicate rows
  // defensively because a few feeds repeat calendar_dates records.
  const seen = new Set()
  for (const row of calendarDateRows) {
    const serviceId = String(row.service_id)
    const date = gtfsDate(row.date)
    if (!date) continue
    const key = `${serviceId}:${dateKey(date)}`
    if (seen.has(key)) continue
    seen.add(key)
    const wasActive = baseActive(calendarByService.get(serviceId), date)
    const isActive = String(row.exception_type) === '1'
    const delta = Number(isActive) - Number(wasActive)
    activeDays.set(serviceId, Math.max(0, (activeDays.get(serviceId) ?? 0) + delta))
  }

  return new Map([...activeDays].map(([id, count]) => [id, count / totalDays]))
}

function gtfsSeconds(value) {
  const parts = String(value ?? '').split(':').map(Number)
  if (parts.length !== 3 || parts.some(n => !Number.isFinite(n))) return null
  return parts[0] * 3600 + parts[1] * 60 + parts[2]
}

/** Expand frequency-based template trips into their approximate run count. */
export function buildFrequencyMultipliers(rows = []) {
  const out = new Map()
  for (const row of rows) {
    const start = gtfsSeconds(row.start_time)
    const end = gtfsSeconds(row.end_time)
    const headway = Number(row.headway_secs)
    if (start == null || end == null || !(headway > 0) || end <= start) continue
    const runs = Math.max(1, Math.ceil((end - start) / headway))
    const id = String(row.trip_id)
    out.set(id, (out.get(id) ?? 0) + runs)
  }
  return out
}

export function canonicalStopId(stopId, stopMeta) {
  let current = String(stopId ?? '')
  const seen = new Set()
  while (current && !seen.has(current)) {
    seen.add(current)
    const parent = stopMeta[current]?.parentStation
    if (!parent || !stopMeta[parent]) break
    current = parent
  }
  return current
}

function percentile(sorted, p) {
  if (!sorted.length) return 0
  const idx = (sorted.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

/** Log + percentile normalization keeps major hubs from flattening every stop. */
export function normalizeSignalMap(raw) {
  const finite = [...raw.values()].filter(v => Number.isFinite(v) && v >= 0).map(v => Math.log1p(v)).sort((a, b) => a - b)
  if (!finite.length) return new Map()
  const low = percentile(finite, 0.05)
  const high = percentile(finite, 0.95)
  const span = high - low
  return new Map([...raw].map(([id, value]) => {
    if (!Number.isFinite(value) || value < 0) return [id, null]
    if (!(span > 1e-9)) return [id, value > 0 ? 0.5 : 0]
    return [id, Math.max(0, Math.min(1, (Math.log1p(value) - low) / span))]
  }))
}

const round = (value, places = 3) => Number(value.toFixed(places))

/**
 * Streaming accumulator: call addStopTime() for every included GTFS stop_time,
 * then finalize() once optional ridership data has been loaded.
 */
export function createStopSignalAccumulator({
  stopMeta,
  tripToRoute,
  tripToService = {},
  serviceWeights = new Map(),
  frequencyMultipliers = new Map(),
}) {
  const stats = new Map()

  function addStopTime(row) {
    const tripId = String(row.trip_id)
    const routeId = tripToRoute[tripId]
    if (!routeId) return
    const stopId = canonicalStopId(row.stop_id, stopMeta)
    if (!stopId) return
    const serviceId = tripToService[tripId]
    const serviceWeight = serviceWeights.size ? (serviceWeights.get(serviceId) ?? 0) : 1
    const runMultiplier = frequencyMultipliers.get(tripId) ?? 1
    const weight = serviceWeight * runMultiplier
    let entry = stats.get(stopId)
    if (!entry) {
      entry = { departures: 0, routes: new Set() }
      stats.set(stopId, entry)
    }
    entry.departures += weight
    entry.routes.add(routeId)
  }

  function finalize(ridershipByStop = new Map()) {
    const departuresRaw = new Map([...stats].map(([id, s]) => [id, s.departures]))
    // "Transfer centrality" is the number of additional routes reachable at
    // the station. One route means no transfer; a hub grows logarithmically.
    const centralityRaw = new Map([...stats].map(([id, s]) => [id, Math.max(0, s.routes.size - 1)]))
    const ridershipRaw = new Map([...ridershipByStop].map(([id, value]) => [
      canonicalStopId(id, stopMeta),
      typeof value === 'number' ? value : value?.ridership,
    ]))
    const departuresNorm = normalizeSignalMap(departuresRaw)
    const centralityNorm = normalizeSignalMap(centralityRaw)
    const ridershipNorm = normalizeSignalMap(ridershipRaw)
    const out = new Map()

    for (const [id, s] of stats) {
      const ridership = ridershipRaw.get(id)
      const hasRidership = Number.isFinite(ridership) && ridership >= 0
      const scheduleDemand = 0.65 * (departuresNorm.get(id) ?? 0) + 0.35 * (centralityNorm.get(id) ?? 0)
      out.set(id, {
        departures: round(s.departures, 2),
        routes: s.routes.size,
        centrality: round(centralityNorm.get(id) ?? 0),
        demand: round(hasRidership ? (ridershipNorm.get(id) ?? scheduleDemand) : scheduleDemand),
        source: hasRidership ? 'ridership' : 'schedule',
        ...(hasRidership ? { ridership: round(ridership, 2) } : {}),
      })
    }
    return out
  }

  return { addStopTime, finalize }
}
