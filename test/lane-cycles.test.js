import test from 'node:test'
import assert from 'node:assert/strict'

import {
  UNITS_PER_BAR, DRUM_LOOP_UNITS,
  laneLoopUnits, cycleFromUnits, suggestBarOptions, buildLoopBricks,
  describeSnapshotLoops, formatBars,
} from '../lib/laneCycles.js'

// SPEED_OPTIONS in components/DawView.jsx
const SPEEDS = [0.25, 0.5, 1, 1.5, 2, 3, 4]

const bars = (n) => n * UNITS_PER_BAR

// ── laneLoopUnits ───────────────────────────────────────────────────────────

test('laneLoopUnits: no region is the full 4-bar grid', () => {
  assert.equal(laneLoopUnits(undefined), bars(4))
  assert.equal(laneLoopUnits(null, 1), bars(4))
})

test('laneLoopUnits: cells map to bars at 16 cells per bar', () => {
  assert.equal(laneLoopUnits({ startCell: 0, endCell: 16 }), bars(1))
  assert.equal(laneLoopUnits({ startCell: 0, endCell: 14 }), bars(7 / 8))
  assert.equal(laneLoopUnits({ startCell: 8, endCell: 40 }), bars(2))
})

test('laneLoopUnits: every speed option yields an exact integer', () => {
  for (const speed of SPEEDS) {
    for (const endCell of [1, 5, 14, 16, 33, 64]) {
      const units = laneLoopUnits({ startCell: 0, endCell }, speed)
      assert.ok(Number.isInteger(units), `speed ${speed} cells ${endCell} → ${units}`)
      // Exact against the float formula the engine uses.
      assert.ok(Math.abs(units / UNITS_PER_BAR - (endCell / 16 / speed)) < 1e-9)
    }
  }
})

test('laneLoopUnits: clamps out-of-range and inverted regions like the engine', () => {
  assert.equal(laneLoopUnits({ startCell: -20, endCell: 999 }), bars(4))
  // endCell <= startCell is bumped to startCell + 1 (one cell)
  assert.equal(laneLoopUnits({ startCell: 32, endCell: 4 }), 1 * 12)
  assert.equal(laneLoopUnits({ startCell: 0, endCell: 16 }, 0), bars(1), 'speed 0 falls back to 1x')
  assert.equal(laneLoopUnits({ startCell: 0, endCell: 16 }, NaN), bars(1))
})

// ── cycleFromUnits ──────────────────────────────────────────────────────────

test('cycleFromUnits: the reported 7/8 polyrhythm realigns at 7 bars', () => {
  const oneBar   = laneLoopUnits({ startCell: 0, endCell: 16 })
  const sevenEighths = laneLoopUnits({ startCell: 0, endCell: 14 })
  assert.deepEqual(cycleFromUnits([oneBar, sevenEighths]), {
    cycleUnits: bars(7), suggestedBars: 7, unbounded: false,
  })
})

test('cycleFromUnits: a 4-bar lane against 7/8 needs 28 bars', () => {
  assert.equal(cycleFromUnits([bars(4), bars(7 / 8)]).suggestedBars, 28)
})

test('cycleFromUnits: identical loops suggest their own length', () => {
  assert.equal(cycleFromUnits([bars(2), bars(2), bars(2)]).suggestedBars, 2)
  assert.equal(cycleFromUnits([bars(1)]).suggestedBars, 1)
})

test('cycleFromUnits: sub-bar loops that divide a bar suggest one bar', () => {
  assert.equal(cycleFromUnits([bars(1 / 2), bars(1 / 4)]).suggestedBars, 1)
})

test('cycleFromUnits: speed multipliers participate', () => {
  // 4 bars at 1.5x = 8/3 bars, against a plain 1-bar lane → 8 bars.
  const fast = laneLoopUnits({ startCell: 0, endCell: 64 }, 1.5)
  assert.equal(cycleFromUnits([fast, bars(1)]).suggestedBars, 8)
})

test('cycleFromUnits: bails out instead of suggesting an absurd cycle', () => {
  // 5 cells vs 7 cells vs 11 cells vs 13 cells — coprime, thousands of bars.
  const units = [5, 7, 11, 13].map(c => laneLoopUnits({ startCell: 0, endCell: c }))
  const out = cycleFromUnits(units)
  assert.equal(out.unbounded, true)
  assert.equal(out.suggestedBars, null)
})

test('cycleFromUnits: respects an explicit maxBars', () => {
  const units = [bars(1), bars(7 / 8)]
  assert.equal(cycleFromUnits(units, { maxBars: 6 }).unbounded, true)
  assert.equal(cycleFromUnits(units, { maxBars: 7 }).suggestedBars, 7)
})

test('cycleFromUnits: nothing to measure', () => {
  assert.equal(cycleFromUnits([]), null)
  assert.equal(cycleFromUnits(undefined), null)
  assert.equal(cycleFromUnits([0, -4, 1.5]), null)
})

// ── suggestBarOptions ───────────────────────────────────────────────────────

test('suggestBarOptions: cycle and its multiples, capped at the bars input max', () => {
  assert.deepEqual(suggestBarOptions(7), [7, 14, 28])
  assert.deepEqual(suggestBarOptions(28), [28, 56])
  assert.deepEqual(suggestBarOptions(64), [64])
  assert.deepEqual(suggestBarOptions(null), [])
  assert.deepEqual(suggestBarOptions(0), [])
})

// ── buildLoopBricks ─────────────────────────────────────────────────────────

test('buildLoopBricks: an exact fit has no partial brick', () => {
  const b = buildLoopBricks(bars(1), 7)
  assert.equal(b.fullCount, 7)
  assert.equal(b.remainderUnits, 0)
  assert.equal(b.aligned, true)
  assert.equal(b.truncated, false)
})

test('buildLoopBricks: 7 bars over a 2-bar loop is 3 full plus a half', () => {
  const b = buildLoopBricks(bars(2), 7)
  assert.equal(b.fullCount, 3)
  assert.equal(b.remainderUnits, bars(1))
  assert.equal(b.aligned, false)
  assert.ok(Math.abs(b.widthPct - (2 / 7) * 100) < 1e-9)
  assert.ok(Math.abs(b.partialPct - (1 / 7) * 100) < 1e-9)
})

test('buildLoopBricks: a loop longer than the part never completes', () => {
  const b = buildLoopBricks(bars(4), 2)
  assert.equal(b.fullCount, 0)
  assert.equal(b.truncated, true)
  assert.equal(b.widthPct, 100)
  assert.equal(b.remainderUnits, bars(2))
})

test('buildLoopBricks: collapses rather than emitting thousands of bricks', () => {
  const sixteenth = laneLoopUnits({ startCell: 0, endCell: 1 })   // 1/16 bar
  assert.equal(buildLoopBricks(sixteenth, 64).collapsed, true)
  assert.equal(buildLoopBricks(bars(1), 64, { maxBricks: 64 }).collapsed, false)
})

// ── describeSnapshotLoops ───────────────────────────────────────────────────

const ROUTES = [
  { id: 'r1', name: 'M6',  color: '#ff0000' },
  { id: 'r2', name: 'T4',  color: '#00ff00' },
  { id: 'r3', name: 'B9',  color: '#0000ff' },
]

const snap = (state) => ({
  schemaVersion: 3,
  state: { routeIds: ['r1', 'r2', 'r3'], muted: { r1: false, r2: false, r3: false }, ...state },
})

test('describeSnapshotLoops: reads loop regions and speeds per lane', () => {
  const out = describeSnapshotLoops(snap({
    trackLoopRegions: { r1: { startCell: 0, endCell: 16 }, r2: { startCell: 0, endCell: 14 } },
    trackSpeeds: { r3: 2 },
  }), ROUTES)

  assert.deepEqual(out.lanes.map(l => l.id), ['r1', 'r2', 'r3'])
  assert.deepEqual(out.lanes.map(l => l.loopBars), [1, 7 / 8, 2])
  assert.deepEqual(out.lanes.map(l => l.name), ['M6', 'T4', 'B9'])
  assert.equal(out.lanes[0].color, '#ff0000')
  assert.equal(out.suggestedBars, 14)
})

test('describeSnapshotLoops: disabled lanes are not drawn', () => {
  const out = describeSnapshotLoops(snap({ muted: { r1: false, r2: true, r3: true } }), ROUTES)
  assert.deepEqual(out.lanes.map(l => l.id), ['r1'])
})

test('describeSnapshotLoops: lanes the snapshot says nothing about default to silent', () => {
  const out = describeSnapshotLoops(snap({ muted: { r1: false } }), ROUTES)
  assert.deepEqual(out.lanes.map(l => l.id), ['r1'])
})

test('describeSnapshotLoops: a solo set wins over the disabled map', () => {
  const out = describeSnapshotLoops(snap({ soloRoutes: ['r3'] }), ROUTES)
  assert.deepEqual(out.lanes.map(l => l.id), ['r3'])
})

test('describeSnapshotLoops: lane labels override route names and colours', () => {
  const out = describeSnapshotLoops(snap({
    trackLabels: { r1: { text: 'Bass', color: '#8b5cf6' } },
  }), ROUTES)
  assert.equal(out.lanes[0].name, 'Bass')
  assert.equal(out.lanes[0].color, '#8b5cf6')
})

test('describeSnapshotLoops: the drum lane is a fixed one bar', () => {
  const out = describeSnapshotLoops(snap({
    muted: { r1: false, r2: true, r3: true },
    drumPattern: { patterns: {} },
  }), ROUTES)
  const drums = out.lanes.find(l => l.id === '__drums__')
  assert.ok(drums)
  assert.equal(drums.loopUnits, DRUM_LOOP_UNITS)
  assert.equal(drums.loopBars, 1)
})

test('describeSnapshotLoops: drums drop out when muted or when anything is soloed', () => {
  const withDrums = (extra) => describeSnapshotLoops(
    snap({ drumPattern: { patterns: {} }, ...extra }), ROUTES,
  ).lanes.some(l => l.id === '__drums__')

  assert.equal(withDrums({}), true)
  assert.equal(withDrums({ drumsMuted: true }), false)
  assert.equal(withDrums({ muted: { r1: false, __drums__: true } }), false)
  assert.equal(withDrums({ soloRoutes: ['r1'] }), false)
})

test('describeSnapshotLoops: merge-consumed and automation-source lanes are excluded', () => {
  const merged = describeSnapshotLoops(snap({
    merges: [{ id: 'm1', sourceIds: ['r1', 'r2'], name: 'Chords' }],
    muted: { r1: false, r2: false, r3: false, m1: false },
  }), ROUTES)
  assert.deepEqual(merged.lanes.map(l => l.id), ['r3', 'm1'])

  const automated = describeSnapshotLoops(snap({
    automationCfg: { r3: { a1: { sourceRouteId: 'r1', paramTarget: 'volume' } } },
  }), ROUTES)
  assert.deepEqual(automated.lanes.map(l => l.id), ['r2', 'r3'])
})

test('describeSnapshotLoops: duplicate lanes carry their own loop region', () => {
  const out = describeSnapshotLoops(snap({
    duplicates: [{ id: 'r1~dup~1', sourceId: 'r1', name: 'M6 (2)' }],
    muted: { r1: false, r2: true, r3: true, 'r1~dup~1': false },
    trackLoopRegions: { 'r1~dup~1': { startCell: 0, endCell: 8 } },
  }), ROUTES)
  assert.deepEqual(out.lanes.map(l => l.id), ['r1', 'r1~dup~1'])
  assert.equal(out.lanes[1].loopBars, 0.5)
})

test('describeSnapshotLoops: honours the free-plan active-lane cap', () => {
  const state = {
    laneManifest: [{ id: 'r1', kind: 'base' }, { id: 'r2', kind: 'base' }, { id: 'r3', kind: 'base' }],
  }
  const all = describeSnapshotLoops(snap(state), ROUTES, { activeLaneLimit: null })
  assert.equal(all.lanes.length, 3)

  const capped = describeSnapshotLoops(snap(state), ROUTES, { activeLaneLimit: 2 })
  assert.deepEqual(capped.lanes.map(l => l.id), ['r1', 'r2'])
})

test('describeSnapshotLoops: reports lanes missing from the loaded city', () => {
  const out = describeSnapshotLoops(snap({}), [ROUTES[0]])
  assert.deepEqual(out.lanes.map(l => l.id), ['r1'])
  assert.deepEqual(out.missingIds, ['r2', 'r3'])
})

test('describeSnapshotLoops: a pre-v3 snapshot reports unknown lanes, not every route', () => {
  const out = describeSnapshotLoops({ state: { bpm: 120 } }, ROUTES)
  assert.equal(out.unknownLanes, true)
  assert.deepEqual(out.lanes, [])
})

test('describeSnapshotLoops: no snapshot at all', () => {
  assert.deepEqual(describeSnapshotLoops(null, ROUTES).lanes, [])
})

test('describeSnapshotLoops: accepts a bare state object as well as a wrapped song', () => {
  const wrapped = describeSnapshotLoops(snap({}), ROUTES)
  const bare    = describeSnapshotLoops(snap({}).state, ROUTES)
  assert.deepEqual(bare.lanes.map(l => l.id), wrapped.lanes.map(l => l.id))
})

// ── formatBars ──────────────────────────────────────────────────────────────

test('formatBars: fractions stay fractions', () => {
  assert.equal(formatBars(1), '1')
  assert.equal(formatBars(4), '4')
  assert.equal(formatBars(0.875), '7/8')
  assert.equal(formatBars(0.5), '1/2')
  assert.equal(formatBars(3.5), '3 1/2')
  assert.equal(formatBars(8 / 3), '2 2/3')
  assert.equal(formatBars(0), '—')
})
