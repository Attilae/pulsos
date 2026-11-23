import test from 'node:test'
import assert from 'node:assert/strict'
import { euclid, snapLevel, patternFromStops, DRUM_GEN_MODES } from '../lib/drumGen.js'
import { SOURCE_STEPS, STEPS, STEP_LEVELS } from '../lib/drumSpecs.js'

// Drum patterns from a line (lib/drumGen.js): distance, euclidean and stop roles.

const str = bits => bits.map(b => (b ? 'x' : '.')).join('')
const hits = pattern => pattern.reduce((n, v) => n + (v > 0 ? 1 : 0), 0)
const barHits = (pattern, b) => hits(pattern.slice(b * STEPS, (b + 1) * STEPS))

// The original generator, copied verbatim, to pin `distance` mode to it.
function legacyPatternFromRoute(route) {
  const pattern = new Array(SOURCE_STEPS).fill(0)
  const stops = Array.from({ length: SOURCE_STEPS }, () => [])
  if (!route?.stops?.length || !route.totalDist) return { pattern, stops }
  for (const stop of route.stops) {
    const idx = Math.min(SOURCE_STEPS - 1, Math.floor((stop.dist / route.totalDist) * SOURCE_STEPS))
    pattern[idx] = 1
    stops[idx].push(stop.name ?? '')
  }
  return { pattern, stops }
}

// A 20-stop line, bunched downtown (first half) and spread out in the suburbs.
function makeRoute({ signals = true } = {}) {
  const dists = [0, 120, 260, 380, 500, 640, 780, 900, 1050, 1200,
    1600, 2100, 2700, 3300, 4000, 4800, 5600, 6500, 7400, 8000]
  const stops = dists.map((dist, i) => ({
    id: `s${i}`, name: `Stop ${i}`, dist,
    ...(signals ? {
      signals: {
        demand: i < 10 ? 0.9 - i * 0.05 : 0.1 + (i % 3) * 0.05,
        centrality: i === 3 || i === 7 || i === 14 ? 0.95 : 0.4 + (i % 4) * 0.05,
        routes: i === 3 || i === 7 || i === 12 ? 3 : 1,
      },
    } : {}),
  }))
  return { id: 'route-42', name: '42', stops, totalDist: 8000 }
}

test('euclid: classic rhythms and even spacing', () => {
  assert.equal(str(euclid(3, 8)), 'x..x..x.') // tresillo
  assert.equal(hits(euclid(5, 8).map(Number)), 5)
  assert.equal(str(euclid(4, 16)), 'x...x...x...x...')
  assert.equal(str(euclid(3, 8, 1)), '.x..x..x')
  assert.equal(str(euclid(0, 8)), '........')
  assert.equal(str(euclid(9, 8)), 'xxxxxxxx')
  assert.deepEqual(euclid(3, 0), [])
  for (let n = 1; n <= 16; n++) {
    for (let k = 1; k <= n; k++) {
      const on = euclid(k, n).flatMap((v, i) => (v ? [i] : []))
      assert.equal(on.length, k)
      const gaps = on.map((p, i) => ((on[(i + 1) % k] - p + n) % n) || n)
      assert.ok(Math.max(...gaps) - Math.min(...gaps) <= 1, `E(${k},${n}) uneven`)
    }
  }
})

test('snapLevel: nearest clickable step level', () => {
  assert.equal(snapLevel(1), 1)
  assert.equal(snapLevel(0.8), 0.7)
  assert.equal(snapLevel(0.9), 1)
  assert.equal(snapLevel(0.45), 0.4)
  assert.equal(snapLevel(0.1), 0.4)
})

test('distance mode is byte-identical to the original generator', () => {
  for (const route of [makeRoute(), makeRoute({ signals: false }), { stops: [], totalDist: 0 }, null]) {
    assert.deepEqual(patternFromStops(route, { mode: 'distance' }), legacyPatternFromRoute(route))
  }
  // Unknown or missing mode falls back to distance.
  assert.deepEqual(patternFromStops(makeRoute()), legacyPatternFromRoute(makeRoute()))
  assert.deepEqual(patternFromStops(makeRoute(), { mode: 'nope' }), legacyPatternFromRoute(makeRoute()))
})

test('every mode returns a 64-slot pattern of clickable levels with a stop list per slot', () => {
  const route = makeRoute()
  for (const mode of DRUM_GEN_MODES) {
    for (const padId of ['kick', 'snare', 'hat', 'rim', 'ride', 'clap']) {
      const { pattern, stops } = patternFromStops(route, { mode, padId })
      assert.equal(pattern.length, SOURCE_STEPS)
      assert.equal(stops.length, SOURCE_STEPS)
      pattern.forEach((v, i) => {
        assert.ok(STEP_LEVELS.includes(v), `${mode}/${padId} slot ${i} = ${v}`)
        if (v > 0) assert.ok(stops[i].length > 0, `${mode}/${padId} slot ${i} hit with no stop`)
      })
    }
  }
})

test('euclid keeps each bar\'s density but spreads it evenly, rotated per route', () => {
  const route = makeRoute()
  const dist = patternFromStops(route, { mode: 'distance' }).pattern
  const even = patternFromStops(route, { mode: 'euclid' })
  for (let b = 0; b < SOURCE_STEPS / STEPS; b++) {
    assert.equal(barHits(even.pattern, b), barHits(dist, b), `bar ${b}`)
  }
  // Every stop is still represented exactly once.
  assert.equal(even.stops.flat().length, route.stops.length)
  // Busy downtown stops are louder than quiet suburban ones.
  assert.ok(even.pattern.slice(0, STEPS).includes(1))
  assert.ok(even.pattern.slice(3 * STEPS).every(v => v < 1))
  // Deterministic, and another route id rotates the same density differently.
  assert.deepEqual(patternFromStops(route, { mode: 'euclid' }), even)
  const other = patternFromStops({ ...route, id: 'route-7' }, { mode: 'euclid' })
  assert.notDeepEqual(other.pattern, even.pattern)
})

test('roles: kick on hubs and terminals on the beat, snare/clap on the backbeat', () => {
  const route = makeRoute()
  const kick = patternFromStops(route, { mode: 'roles', padId: 'kick' })
  kick.pattern.forEach((v, i) => { if (v) assert.equal(i % 4, 0, `kick off-beat at ${i}`) })
  const kickStops = kick.stops.flat()
  for (const name of ['Stop 0', 'Stop 19', 'Stop 3', 'Stop 7', 'Stop 14']) assert.ok(kickStops.includes(name), name)
  assert.ok(!kickStops.includes('Stop 5'))

  for (const padId of ['snare', 'clap']) {
    const p = patternFromStops(route, { mode: 'roles', padId })
    p.pattern.forEach((v, i) => { if (v) assert.ok([4, 12].includes(i % STEPS), `${padId} at ${i}`) })
    // Transfers come from signals.routes: stops 3, 7, 12.
    assert.deepEqual([...p.stops.flat()].sort(), ['Stop 12', 'Stop 3', 'Stop 7'])
  }
})

test('roles: hats on every stop, ride on 8ths, rim ghosts on quiet stops', () => {
  const route = makeRoute()
  const hat = patternFromStops(route, { mode: 'roles', padId: 'hat' })
  assert.equal(hat.stops.flat().length, route.stops.length)
  assert.ok(hat.pattern.includes(1) && hat.pattern.includes(0.4), 'hat velocity follows demand')

  const ride = patternFromStops(route, { mode: 'roles', padId: 'ride' })
  ride.pattern.forEach((v, i) => { if (v) assert.equal(i % 2, 0) })

  const rim = patternFromStops(route, { mode: 'roles', padId: 'rim' })
  assert.ok(hits(rim.pattern) > 0)
  rim.pattern.forEach(v => assert.ok(v === 0 || v === 0.4))
  assert.ok(rim.stops.flat().every(n => Number(n.split(' ')[1]) >= 10), 'only quiet suburban stops')
})

test('roles falls back to distance on lines without signals', () => {
  const route = makeRoute({ signals: false })
  for (const padId of ['kick', 'snare', 'rim']) {
    assert.deepEqual(patternFromStops(route, { mode: 'roles', padId }), legacyPatternFromRoute(route))
  }
})

test('roles with flat centrality: only terminals are kick hubs, transfers still from routes', () => {
  const route = makeRoute()
  route.stops = route.stops.map(s => ({ ...s, signals: { ...s.signals, centrality: 0.5 } }))
  const kick = patternFromStops(route, { mode: 'roles', padId: 'kick' })
  assert.deepEqual(kick.stops.flat().sort(), ['Stop 0', 'Stop 19'])
})
