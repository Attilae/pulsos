import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  HEIGHT_SPAN, SCENE_RADIUS, CURVE_STEPS, buildListeningLines, curvePoint, sampleCurve, makeProjector,
  pitchMapToMidi, orbitPose, decay, bloomFor, exposureFor, ORBIT_PERIOD_S, frameLines,
} from '../lib/listeningScene.js'

const route = (id, stops, extra = {}) => ({
  id, color: '#ff0000', totalDist: stops.at(-1).dist, ...extra,
  stops: stops.map((s, i) => ({ id: `${id}-${i}`, ...s })),
})

const a = route('a', [
  { lat: 47.50, lon: 19.00, dist: 0 },
  { lat: 47.51, lon: 19.01, dist: 1000 },
  { lat: 47.52, lon: 19.02, dist: 2000 },
])
const b = route('b', [
  { lat: 47.49, lon: 19.03, dist: 0 },
  { lat: 47.50, lon: 19.05, dist: 3000 },
])

test('projection fits the mix in the scene radius, north is -z', () => {
  const p = makeProjector([a, b])
  const [, zNorth] = p(47.52, 19.02)
  const [, zSouth] = p(47.49, 19.02)
  assert.ok(zNorth < zSouth)
  for (const r of [a, b]) for (const s of r.stops) {
    const [x, z] = p(s.lat, s.lon)
    assert.ok(Math.abs(x) <= SCENE_RADIUS + 1e-6 && Math.abs(z) <= SCENE_RADIUS + 1e-6)
  }
  assert.equal(makeProjector([]), null)
})

test('heights share one pitch scale across the mix', () => {
  const pitches = { a: ['C3', 'C4', 'C5'], b: ['C3', 'G3'] }
  const lines = buildListeningLines([a, b], r => pitchMapToMidi(pitches[r.id]))
  const [la, lb] = lines
  assert.equal(la.stops[0].y, 0)                             // lowest note → ground
  assert.equal(la.stops[2].y, HEIGHT_SPAN)                   // highest note → full span
  assert.equal(lb.stops[0].y, la.stops[0].y)                 // same note, same height on another line
  assert.ok(lb.stops[1].y > lb.stops[0].y && lb.stops[1].y < la.stops[1].y)
})

test('missing pitch falls back to demand', () => {
  const r = route('d', [{ lat: 1, lon: 1, dist: 0, signals: { demand: 0 } }, { lat: 1.01, lon: 1.01, dist: 10, signals: { demand: 1 } }])
  const [line] = buildListeningLines([r], () => null)
  assert.ok(line.stops[1].y > line.stops[0].y)
})

test('unparseable notes are NaN, not middle C', () => {
  assert.deepEqual(pitchMapToMidi(['C4', '?', null]).map(Number.isFinite), [true, false, false])
})

test('the curve passes through every stop and heads sit on it', () => {
  const [line] = buildListeningLines([a], r => pitchMapToMidi(['C3', 'E4', 'C3']))
  const curve = sampleCurve(line.stops)
  assert.equal(curve.length / 3, (line.stops.length - 1) * CURVE_STEPS + 1)
  line.stops.forEach((s, i) => {
    const k = i * CURVE_STEPS * 3
    assert.deepEqual([curve[k], curve[k + 1], curve[k + 2]].map(v => +v.toFixed(3)), [s.x, s.y, s.z].map(v => +Math.fround(v).toFixed(3)))
  })
  const mid = curvePoint(line, curve, 0.5)
  const s1 = line.stops[1]
  assert.ok(Math.abs(mid[0] - s1.x) < 1e-3 && Math.abs(mid[1] - s1.y) < 1e-3)
  assert.ok(curvePoint(line, curve, 1)[0] - line.stops[2].x < 1e-3)
})

test('orbit is slow and bounded', () => {
  const p0 = orbitPose(0), p1 = orbitPose(ORBIT_PERIOD_S)
  assert.ok(Math.abs(p1.azimuth - p0.azimuth - Math.PI * 2) < 1e-9)
  for (let t = 0; t < 2000; t += 13) {
    const p = orbitPose(t)
    assert.ok(p.elevation >= 0.12 && p.elevation <= 1.35)
    assert.ok(p.distance > SCENE_RADIUS)
  }
})

test('blooms decay, never flash', () => {
  assert.ok(Math.abs(decay(1, 1.8, 1.8) - Math.exp(-1)) < 1e-12)
  assert.equal(decay(1, -1, 1), 1)
  assert.ok(bloomFor(0) >= 0.45 && bloomFor(1) === 1)
  assert.ok(exposureFor(0) === 0.8 && exposureFor(10) <= 1.2 + 1e-9)
})

test('framing covers the given lines only', () => {
  const lines = buildListeningLines([a, b], () => null)
  const all = frameLines(lines)
  const one = frameLines([lines[0]])
  assert.ok(one.r < all.r)
  for (const s of lines[0].stops) assert.ok(Math.hypot(s.x - one.x, s.z - one.z) <= one.r + 1e-9)
  assert.equal(frameLines([]), null)
})
