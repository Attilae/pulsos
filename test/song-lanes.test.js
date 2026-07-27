import test from 'node:test'
import assert from 'node:assert/strict'
import {
  snapshotBaseRouteIds, resolveSnapshotRoutes, resolveSnapshotLanes,
  snapshotLaneDisabledMap, clampMode,
} from '../lib/songLanes.js'
import { mergeDuplicateRoutes } from '../lib/snapshotPlayer.js'

const route = (id, extra = {}) => ({ id, name: id, type: 'tram', stops: [{ lat: 1, lon: 2 }], totalDist: 10, ...extra })
const CITY = [route('M1', { type: 'metro' }), route('4'), route('47'), route('9', { type: 'bus' }), route('unused')]

test('routeIds is honored verbatim, in its own order', () => {
  const { base, missingIds } = resolveSnapshotRoutes(CITY, { routeIds: ['47', 'M1', '4'] })
  assert.deepEqual(base.map(r => r.id), ['47', 'M1', '4'])
  assert.deepEqual(missingIds, [])
})

test('legacy snapshots recover their lanes from laneManifest', () => {
  const ids = snapshotBaseRouteIds({
    laneManifest: [
      { id: '4', kind: 'base' },
      { id: '4~dup~1', kind: 'duplicate', sourceId: '4' },
      { id: 'M1', kind: 'base' },
    ],
    duplicates: [{ id: '4~dup~1', sourceId: '4' }],
  })
  assert.deepEqual(ids, ['4', 'M1'], 'synthetic duplicate id must not become a base lane')
})

test('pre-laneManifest snapshots recover their lanes from muted keys', () => {
  const ids = snapshotBaseRouteIds({
    muted: { M1: false, 4: true, __drums__: false, 'm~1': true },
    merges: [{ id: 'm~1', sourceIds: ['M1'] }],
  })
  assert.ok(ids.includes('M1') && ids.includes('4'))
  assert.ok(!ids.includes('__drums__'), 'the drum pseudo-route is not a lane')
  assert.ok(!ids.includes('m~1'), 'a merge id is not a base lane')
})

// The precise shape of the original bug: these lanes are absent from
// laneManifest (which is built from visibleInstrumentRoutes) yet must still play.
test('merge sources and automation sources are lanes despite being absent from laneManifest', () => {
  const snap = {
    laneManifest: [{ id: 'm~1', kind: 'merge' }],
    merges: [{ id: 'm~1', sourceIds: ['4', '47'] }],
    automationCfg: { '4': { lane0: { sourceRouteId: '9', paramTarget: 'volume' } } },
  }
  const ids = snapshotBaseRouteIds(snap)
  for (const id of ['4', '47', '9']) assert.ok(ids.includes(id), `${id} must be resolved`)
  assert.ok(!ids.includes('m~1'))
})

test('missing ids are reported while the surviving lanes still resolve', () => {
  const { base, missingIds } = resolveSnapshotRoutes(CITY, { routeIds: ['4', 'GONE', '47'] })
  assert.deepEqual(base.map(r => r.id), ['4', '47'])
  assert.deepEqual(missingIds, ['GONE'])
})

test('a snapshot with no recoverable ids falls back to the whole route list', () => {
  const { base } = resolveSnapshotRoutes(CITY, {})
  assert.equal(base.length, CITY.length)
})

test('duplicate and merged lanes are reconstructed from the base routes', () => {
  const snap = {
    routeIds: ['4', '47'],
    duplicates: [{ id: '4~dup~1', sourceId: '4', name: '4 (2)' }],
    merges: [{ id: 'm~1', sourceIds: ['4', '47'], name: 'Merged' }],
  }
  const { lanes } = resolveSnapshotLanes(CITY, snap)
  assert.deepEqual(lanes.map(r => r.id), ['4', '47', '4~dup~1', 'm~1'])
  const dup = lanes.find(r => r.id === '4~dup~1')
  assert.equal(dup.isDuplicate, true)
  assert.deepEqual(dup.stops, CITY.find(r => r.id === '4').stops, 'clone carries source geometry')
  const merged = lanes.find(r => r.id === 'm~1')
  assert.equal(merged.isMerged, true)
  assert.deepEqual(merged.sourceRoutes.map(r => r.id), ['4', '47'])
})

test('descriptors whose sources are gone resolve to nothing rather than dangling', () => {
  const { lanes } = resolveSnapshotLanes(CITY, {
    routeIds: ['4'],
    duplicates: [{ id: 'x~dup~1', sourceId: 'GONE', name: 'orphan' }],
    merges: [{ id: 'm~1', sourceIds: ['GONE', 'ALSO_GONE'] }],
  })
  assert.deepEqual(lanes.map(r => r.id), ['4'])
})

// The Mixer and the Song Chainer must never disagree about the same snapshot.
test('resolveSnapshotLanes and mergeDuplicateRoutes agree', () => {
  const snap = {
    routeIds: ['4', '47', '9'],
    duplicates: [{ id: '4~dup~1', sourceId: '4', name: 'dup' }],
    merges: [{ id: 'm~1', sourceIds: ['47', '9'], name: 'merged' }],
    automationCfg: { '4': { lane0: { sourceRouteId: 'M1' } } },
  }
  assert.deepEqual(
    mergeDuplicateRoutes(CITY, snap).map(r => r.id),
    resolveSnapshotLanes(CITY, snap).lanes.map(r => r.id),
  )
})

test('the disabled map covers every lane, defaulting unmentioned ones to silent', () => {
  const lanes = [route('4'), route('47'), route('9')]
  const map = snapshotLaneDisabledMap(lanes, { muted: { '4': false, '47': true } })
  assert.deepEqual(map, { '4': false, '47': true, '9': true })
})

test('the drum pseudo-lane keeps its disabled flag even though it is not a route', () => {
  const map = snapshotLaneDisabledMap([route('4')], { muted: { '4': false, __drums__: false } })
  assert.equal(map.__drums__, false)
})

test('live mode is clamped away in cities with no feed', () => {
  assert.equal(clampMode('live', { liveWsUrl: null }), 'mock')
  assert.equal(clampMode('live', { liveWsUrl: 'ws://localhost:3005' }), 'live')
  assert.equal(clampMode(undefined, { liveWsUrl: 'ws://x' }), 'mock')
})
