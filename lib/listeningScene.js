// Pure geometry and timing for the Listening view (components/ListeningView.jsx):
// the mix drawn as luminous threads in a dark void, each stop raised to the
// height of the note it plays, seen from a camera that orbits very slowly.
//
// Nothing here touches three.js, React or the DOM, so it is testable in Node
// (test/listening-scene.test.js). The view turns these arrays into buffers.

import { noteToMidi } from './mappings.js'

export const SCENE_RADIUS = 100          // the mix's horizontal extent, in scene units
export const HEIGHT_SPAN  = 46           // lowest → highest note in the mix
export const CURVE_STEPS  = 10           // curve samples per stop-to-stop segment
export const ORBIT_PERIOD_S = 360        // one slow revolution
export const GLOW_TAU_S   = 1.8          // a stop's bloom decays with this time constant
export const LEVEL_TAU_S  = 1.4          // loudness → light smoothing

const M_PER_DEG_LAT = 110540
const M_PER_DEG_LON = 111320

/**
 * Local planar projection centred on the mix. Returns a projector to scene
 * x/z (north is −z) scaled so the mix fits SCENE_RADIUS, or null with no stops.
 */
export function makeProjector(routes) {
  let latMin = Infinity, latMax = -Infinity, lonMin = Infinity, lonMax = -Infinity
  for (const r of routes ?? []) {
    for (const s of r?.stops ?? []) {
      if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon)) continue
      if (s.lat < latMin) latMin = s.lat
      if (s.lat > latMax) latMax = s.lat
      if (s.lon < lonMin) lonMin = s.lon
      if (s.lon > lonMax) lonMax = s.lon
    }
  }
  if (!Number.isFinite(latMin)) return null
  const lat0 = (latMin + latMax) / 2
  const lon0 = (lonMin + lonMax) / 2
  const kx = Math.cos(lat0 * Math.PI / 180) * M_PER_DEG_LON
  const halfW = ((lonMax - lonMin) * kx) / 2
  const halfH = ((latMax - latMin) * M_PER_DEG_LAT) / 2
  const scale = SCENE_RADIUS / Math.max(halfW, halfH, 200)
  return (lat, lon) => [(lon - lon0) * kx * scale, -(lat - lat0) * M_PER_DEG_LAT * scale]
}

/** MIDI numbers for a pitch map (note names), NaN where unparseable. */
export function pitchMapToMidi(pitchMap) {
  return (pitchMap ?? []).map(n => {
    if (typeof n !== 'number' && !(typeof n === 'string' && /^[A-G]#?-?\d+$/.test(n))) return NaN
    const m = typeof n === 'number' ? n : noteToMidi(n)
    return Number.isFinite(m) ? m : NaN
  })
}

/**
 * The lines the view draws, one per base route used by a lane in the mix.
 * `pitchOf(route)` → MIDI per stop (or null → demand stands in for pitch).
 * Heights share one scale across the whole mix, so a bass line sits low and a
 * lead high: the mix reads as one score in space.
 *
 * → [{ id, color, stops: [{ id, x, y, z, dist }], totalDist }]
 */
export function buildListeningLines(routes, pitchOf) {
  const project = makeProjector(routes)
  if (!project) return []
  const raw = []
  let lo = Infinity, hi = -Infinity
  for (const route of routes) {
    const stops = (route?.stops ?? []).filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lon))
    if (stops.length < 2) continue
    let midi = pitchOf?.(route) ?? null
    if (!midi || midi.length !== route.stops.length || midi.every(m => !Number.isFinite(m))) {
      // No pitch: use demand on a two-octave span, like the default contour.
      midi = route.stops.map(s => 48 + 24 * (s.signals?.demand ?? 0.5))
    }
    const byId = new Map(route.stops.map((s, i) => [s.id, midi[i]]))
    const pts = stops.map(s => {
      const [x, z] = project(s.lat, s.lon)
      const m = byId.get(s.id)
      if (Number.isFinite(m)) { lo = Math.min(lo, m); hi = Math.max(hi, m) }
      return { id: s.id, x, z, midi: m, dist: s.dist ?? 0 }
    })
    raw.push({ id: route.id, color: route.color, stops: pts, totalDist: route.totalDist || pts.at(-1).dist || 1 })
  }
  const span = Math.max(hi - lo, 1)
  const base = Number.isFinite(lo) ? lo : 60
  for (const line of raw) {
    for (const s of line.stops) {
      s.y = Number.isFinite(s.midi) ? ((s.midi - base) / span) * HEIGHT_SPAN : HEIGHT_SPAN / 2
      delete s.midi
    }
  }
  return raw
}

// Centripetal-ish Catmull-Rom between p1 and p2 (uniform, which is fine at
// these sample counts and never overshoots wildly because heights are bounded).
function cr(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
}

/**
 * A smooth curve through a line's stops, CURVE_STEPS samples per segment, as
 * a flat [x,y,z, x,y,z, …] array. Sample k*steps is exactly stop k, which is
 * what lets curvePoint() put a head on the same curve the line is drawn with.
 */
export function sampleCurve(stops, steps = CURVE_STEPS) {
  const n = stops.length
  if (n === 0) return new Float32Array(0)
  if (n === 1) return Float32Array.of(stops[0].x, stops[0].y, stops[0].z)
  const out = new Float32Array(((n - 1) * steps + 1) * 3)
  let o = 0
  for (let i = 0; i < n - 1; i++) {
    const p0 = stops[Math.max(0, i - 1)], p1 = stops[i], p2 = stops[i + 1], p3 = stops[Math.min(n - 1, i + 2)]
    for (let k = 0; k < steps; k++) {
      const t = k / steps
      out[o++] = cr(p0.x, p1.x, p2.x, p3.x, t)
      out[o++] = cr(p0.y, p1.y, p2.y, p3.y, t)
      out[o++] = cr(p0.z, p1.z, p2.z, p3.z, t)
    }
  }
  const last = stops[n - 1]
  out[o++] = last.x; out[o++] = last.y; out[o++] = last.z
  return out
}

/**
 * Where `frac` (0..1 of the line by distance, as lib/mapPlayhead.js reports it)
 * falls on the sampled curve: the stop segment by distance, then linear between
 * that segment's samples. → [x, y, z] or null.
 */
export function curvePoint(line, curve, frac, steps = CURVE_STEPS, out = [0, 0, 0]) {
  const stops = line.stops
  if (!stops.length || !curve.length) return null
  const target = Math.max(0, Math.min(1, frac)) * line.totalDist
  let i = 0
  while (i < stops.length - 2 && stops[i + 1].dist < target) i++
  const a = stops[i].dist, b = stops[Math.min(i + 1, stops.length - 1)].dist
  const t = b > a ? Math.max(0, Math.min(1, (target - a) / (b - a))) : 0
  const f = Math.min((i + t) * steps, curve.length / 3 - 1)
  const k = Math.floor(f), u = f - k
  const k2 = Math.min(k + 1, curve.length / 3 - 1)
  for (let c = 0; c < 3; c++) out[c] = curve[k * 3 + c] + (curve[k2 * 3 + c] - curve[k * 3 + c]) * u
  return out
}

/**
 * What the camera frames: the box around the given lines' stops (normally the
 * audible ones, so disabled lines far out of town don't shrink the mix).
 * → { x, z, r } centre and radius in scene units, or null with nothing to frame.
 */
export function frameLines(lines) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
  for (const line of lines ?? []) {
    for (const s of line?.stops ?? []) {
      if (s.x < x0) x0 = s.x
      if (s.x > x1) x1 = s.x
      if (s.z < z0) z0 = s.z
      if (s.z > z1) z1 = s.z
    }
  }
  if (!Number.isFinite(x0)) return null
  return { x: (x0 + x1) / 2, z: (z0 + z1) / 2, r: Math.max(12, Math.hypot(x1 - x0, z1 - z0) / 2) }
}

/** Slow, non-repeating drift in −1..1: incommensurate sines, nothing visibly loops. */
export function wobble(t) {
  return Math.sin(t) * 0.5 + Math.sin(t * 1.618 + 1.3) * 0.3 + Math.sin(t * 2.71 + 4.1) * 0.2
}

/**
 * Camera pose at time `t` (s): one revolution per ORBIT_PERIOD_S, elevation and
 * distance breathing on minute-scale drifts. `user` offsets come from dragging.
 * → { azimuth, elevation, distance } (radians, radians, scene units)
 */
export function orbitPose(t, user = { azimuth: 0, elevation: 0, zoom: 1 }) {
  const azimuth = (t / ORBIT_PERIOD_S) * Math.PI * 2 + user.azimuth
  const elevation = Math.max(0.12, Math.min(1.35, 0.5 + 0.12 * wobble(t / 47) + user.elevation))
  const distance = SCENE_RADIUS * 2.15 * (1 + 0.06 * wobble(t / 61 + 7)) * user.zoom
  return { azimuth, elevation, distance }
}

/** Exponential decay over `dt` seconds. */
export function decay(value, dt, tau) {
  return value * Math.exp(-Math.max(0, dt) / tau)
}

/** A note's bloom strength from its velocity (0..1): never invisible, never blinding. */
export function bloomFor(velocity) {
  const v = Number.isFinite(velocity) ? Math.max(0, Math.min(1, velocity)) : 0.8
  return 0.45 + 0.55 * v
}

/** Smoothed loudness → light multiplier, a gentle 0.8…1.2 so nothing flashes. */
export function exposureFor(level) {
  const l = Math.max(0, Math.min(1, level * 5))
  return 0.8 + 0.4 * Math.sqrt(l)
}
