import {
  normalizeDelay,
  normalizeUncertainty,
  normalizeOccupancy,
  normalizeSpeed,
  normalizeCongestion,
  normalizeDwellDeviation,
  normalizeDelayDelta,
  normalizeStopLat,
  normalizeStopSequence,
  normalizeBearingSin,
  normalizeBearingCos,
  normalizeLongitude,
  cumulativePolylineDistance,
  projectPointOntoPolyline,
} from './mappings.js'

// Automation source registry. Ordered roughly from most jittery to most
// deterministic, so users can match source character to destination character.
export const AUTOMATION_SOURCES = [
  { id: 'arrival.delay',   label: 'Arrival Delay',  unit: 's',    description: 'Lateness of arrivals at each stop' },
  { id: 'delay.delta',     label: 'Delay Change',   unit: 's',    description: 'Stop-to-stop change in delay (very noisy)' },
  { id: 'dwell.deviation', label: 'Dwell Deviation', unit: 's',   description: 'Extra dwell time vs. schedule' },
  { id: 'uncertainty',     label: 'Uncertainty',    unit: 's',    description: 'Prediction confidence (high = chaotic)' },
  { id: 'occupancy',       label: 'Occupancy',      unit: '%',    description: 'Vehicle crowding level' },
  { id: 'speed',           label: 'Speed',          unit: 'km/h', description: 'Vehicle speed approaching stop' },
  { id: 'congestion',      label: 'Congestion',     unit: '',     description: 'Traffic congestion level' },
  { id: 'bearing.sin',     label: 'Bearing E/W',    unit: '',     description: 'East/west travel component' },
  { id: 'bearing.cos',     label: 'Bearing N/S',    unit: '',     description: 'North/south travel component' },
  { id: 'stop.lat',        label: 'Latitude',       unit: '°',    description: 'Geographic position (south→north = 0→1)' },
  { id: 'longitude',       label: 'Longitude',      unit: '°',    description: 'East-west position (Buda=0, Pest=1)' },
  { id: 'stop.sequence',   label: 'Stop Progress',  unit: '',     description: 'Journey progress (first→last stop)' },
  { id: 'route.progress',  label: 'Route Progress', unit: '',     description: 'Vehicle position projected along the route shape' },
]

const STATIC_ONLY_SOURCES = new Set(['stop.sequence', 'route.progress', 'stop.lat', 'longitude'])

// Reads GTFS data at each stop and calls onValue(normalizedValue 0–1).
// mode 'live':   value updates from real-time GTFS-RT events
// mode 'static': value pre-computed from static route/stop geometry
export class AutomationTrack {
  constructor() {
    this._source  = 'arrival.delay'
    this._mode    = 'live'
    this._onValue = null   // callback (value: 0–1) => void, set by engine

    // stopId → { value: 0–1, stopIdx, isStatic }
    this._curve = new Map()
    this._prevDelayByStop = {}

    // Precomputed polyline shapes for linear referencing (route.progress).
    // Each entry: { coords, cumulative, total }
    this._shapes = []
    this._totalDist = 0
  }

  get source() { return this._source }
  get mode()   { return this._mode }

  setSource(sourceId) { this._source = sourceId }

  // Caller provides a callback; engine sets this up per-lane with the right target wiring.
  setTarget(callback) { this._onValue = callback }

  setMode(mode) { this._mode = mode }

  // Build a static baseline from the route's stop list (from lines.json).
  // stops: [{ id, lat, lng, dist, ... }], totalDist: total route length in metres
  buildStaticCurve(stops, totalDist) {
    this._totalDist = totalDist ?? 0
    this._curve.clear()
    stops.forEach((s, i) => {
      const value = this._staticValue(s, i, stops.length)
      this._curve.set(s.id, { value, stopIdx: i, isStatic: true })
    })
  }

  // Cache route polyline(s) for linear referencing. polylines: [{ coords: [[lat,lng], ...] }]
  setRouteShape(polylines) {
    this._shapes = (polylines ?? [])
      .filter(p => p?.coords?.length >= 2)
      .map(p => {
        const { cumulative, total } = cumulativePolylineDistance(p.coords)
        return { coords: p.coords, cumulative, total }
      })
  }

  _projectVehicle(lat, lng) {
    if (lat == null || lng == null || !this._shapes.length) return null
    let best = null
    for (const s of this._shapes) {
      const r = projectPointOntoPolyline(lat, lng, s.coords, s.cumulative, s.total)
      if (r && (!best || r.perpDist < best.perpDist)) best = r
    }
    return best
  }

  _staticValue(stop, idx, total) {
    switch (this._source) {
      case 'stop.lat':       return normalizeStopLat(stop.lat ?? 47.49)
      case 'longitude':      return normalizeLongitude(stop.lng ?? 19.07)
      case 'stop.sequence':  return normalizeStopSequence(idx, total)
      case 'route.progress': return this._totalDist > 0 ? (stop.dist ?? 0) / this._totalDist : idx / Math.max(1, total - 1)
      default:               return 0.5   // neutral placeholder for live-only sources
    }
  }

  // Continuous in-transit position updates (between stops). Only used by sources
  // whose value depends on lat/lng without needing a stop event (currently
  // route.progress). No-op for others.
  onVehiclePosition(lat, lng) {
    if (this._mode !== 'live') return
    if (this._source !== 'route.progress') return
    const r = this._projectVehicle(lat, lng)
    if (!r) return
    if (this._onValue) this._onValue(r.progress)
  }

  // Called from the engine on each live or mock stop event.
  // data: { delay, uncertainty, occupancyPct, speed, congestion, departureDelay,
  //         lat, lng, bearing, stopIdx }
  onStopEvent(stopId, data) {
    let value
    if (this._mode === 'live') {
      value = this._liveValue(stopId, data)
      if (value === null) value = this._curve.get(stopId)?.value ?? 0.5
    } else {
      value = this._curve.get(stopId)?.value ?? 0.5
    }

    const existing = this._curve.get(stopId)
    this._curve.set(stopId, { value, stopIdx: existing?.stopIdx ?? data.stopIdx, isStatic: this._mode === 'static' })

    if (this._onValue) this._onValue(value)
  }

  // Called from engine when a full StopTimeUpdate array arrives for a trip.
  onTripUpdate(updates) {
    if (this._mode !== 'live') return
    if (!updates?.length) return

    for (const u of updates) {
      const value = this._liveValueFromUpdate(u)
      if (value !== null) {
        const existing = this._curve.get(u.stopId)
        this._curve.set(u.stopId, { value, stopIdx: existing?.stopIdx, isStatic: false })
      }
    }
    const first = this._liveValueFromUpdate(updates[0])
    if (first !== null && this._onValue) this._onValue(first)
  }

  _liveValueFromUpdate({ arrivalDelay, departureDelay, uncertainty, stopId }) {
    switch (this._source) {
      case 'arrival.delay':   return normalizeDelay(arrivalDelay ?? 0)
      case 'uncertainty':     return normalizeUncertainty(uncertainty ?? 0)
      case 'dwell.deviation': return normalizeDwellDeviation((departureDelay ?? 0) - (arrivalDelay ?? 0))
      case 'delay.delta': {
        const prev = this._prevDelayByStop[stopId] ?? 0
        const delta = (arrivalDelay ?? 0) - prev
        this._prevDelayByStop[stopId] = arrivalDelay ?? 0
        return normalizeDelayDelta(delta)
      }
      default: return null
    }
  }

  _liveValue(stopId, data) {
    switch (this._source) {
      case 'arrival.delay':   return normalizeDelay(data.delay ?? 0)
      case 'uncertainty':     return normalizeUncertainty(data.uncertainty ?? 0)
      case 'occupancy':       return normalizeOccupancy(data.occupancyPct ?? 0)
      case 'speed':           return normalizeSpeed(data.speed ?? 0)
      case 'congestion':      return normalizeCongestion(data.congestion ?? 0)
      case 'dwell.deviation': return normalizeDwellDeviation((data.departureDelay ?? 0) - (data.delay ?? 0))
      case 'delay.delta': {
        const prev = this._prevDelayByStop[stopId] ?? 0
        const delta = (data.delay ?? 0) - prev
        this._prevDelayByStop[stopId] = data.delay ?? 0
        return normalizeDelayDelta(delta)
      }
      case 'stop.lat':       return normalizeStopLat(data.lat ?? 47.49)
      case 'longitude':      return normalizeLongitude(data.lng)
      case 'bearing.sin':    return normalizeBearingSin(data.bearing)
      case 'bearing.cos':    return normalizeBearingCos(data.bearing)
      case 'route.progress': {
        const r = this._projectVehicle(data.lat, data.lng)
        return r ? r.progress : null
      }
      case 'stop.sequence':  return null   // static-only
      default:               return null
    }
  }

  // Return curve as array sorted by stopIdx for UI rendering.
  getCurve() {
    return [...this._curve.entries()]
      .map(([stopId, v]) => ({ stopId, ...v }))
      .sort((a, b) => (a.stopIdx ?? 0) - (b.stopIdx ?? 0))
  }

  dispose() {
    this._curve.clear()
    this._shapes = []
    this._onValue = null
  }
}

export { STATIC_ONLY_SOURCES }
