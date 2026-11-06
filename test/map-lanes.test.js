import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildMapLanes, activeGeometryIds, laneForRouteClick, toggleFocus, reconcileFocus,
  sharedGeometryLanes, laneState, laneStops, visibleStopMarkers, stopInView, STOP_DETAIL_MIN_ZOOM,
} from '../lib/mapLanes.js'
import { routeLineStyle, fitTarget } from '../lib/mapVisualPolicy.js'

const U7 = { id: 'u7', name: 'U7', type: 'metro', color: '#3b82f6' }
const U8 = { id: 'u8', name: 'U8', type: 'metro', color: '#1f3a68' }
// Shapes as MixerTab's mergedRoutes builds them. The ids look parseable on
// purpose: the model must read sourceId/sourceIds, never the id.
const dup = { ...U7, id: 'u7~dup~abc', name: 'U7 copy', sourceId: 'u7', isDuplicate: true }
const merged = { ...U7, id: 'merge~xyz', name: 'U7+U8', isMerged: true, sourceIds: ['u7', 'u8'], sourceRoutes: [U7, U8] }

test('buildMapLanes resolves geometry from descriptors, not synthetic ids', () => {
  const lanes = buildMapLanes([U7, dup, merged])
  assert.deepEqual(lanes.map(l => [l.id, l.kind, l.geometryIds]), [
    ['u7', 'route', ['u7']],
    ['u7~dup~abc', 'duplicate', ['u7']],
    ['merge~xyz', 'merged', ['u7', 'u8']],
  ])
  // A duplicate with a misleading id still follows its sourceId.
  const odd = buildMapLanes([{ id: 'u8~dup~1', name: 'x', sourceId: 'u7', isDuplicate: true }])
  assert.deepEqual(odd[0].geometryIds, ['u7'])
})

test('a line is audible when any listed lane on it is audible', () => {
  const lanes = buildMapLanes([U7, dup, merged])
  // Base U7 off, its duplicate on: the U7 line still sounds.
  const ids = activeGeometryIds(lanes, { u7: true, 'merge~xyz': true }, new Set())
  assert.deepEqual([...ids], ['u7'])
  // Solo the merged lane: both of its sources draw as audible, nothing else.
  assert.deepEqual([...activeGeometryIds(lanes, {}, new Set(['merge~xyz']))].sort(), ['u7', 'u8'])
  assert.equal(activeGeometryIds(lanes, { u7: true, 'u7~dup~abc': true, 'merge~xyz': true }, new Set()).size, 0)
})

test('clicking a shared line keeps the focused lane, else picks the first lane on it', () => {
  const lanes = buildMapLanes([U7, dup, merged])
  assert.equal(laneForRouteClick('u7', lanes, null), 'u7')
  assert.equal(laneForRouteClick('u7', lanes, 'u7~dup~abc'), 'u7~dup~abc')
  assert.equal(laneForRouteClick('u8', lanes, 'u7~dup~abc'), 'merge~xyz')
  assert.equal(laneForRouteClick('u9', lanes, 'u7'), null)
})

test('focus toggles, survives disabling, and clears when the lane is removed', () => {
  assert.equal(toggleFocus(null, 'u7'), 'u7')
  assert.equal(toggleFocus('u7', 'u7'), null)
  assert.equal(toggleFocus('u7', 'u8'), 'u8')
  const lanes = buildMapLanes([U7, U8])
  assert.equal(reconcileFocus('u7', lanes), 'u7')
  assert.equal(reconcileFocus('u7', buildMapLanes([U8])), null)
  assert.equal(laneState(lanes[0], { u7: true }, new Set()), 'Off')
  assert.equal(laneState(lanes[0], {}, new Set(['u7'])), 'Solo')
  assert.equal(laneState(lanes[0], {}, new Set(['u8'])), 'Muted by solo')
  assert.equal(laneState(lanes[0], {}, new Set()), 'On')
  const all = buildMapLanes([U7, dup, U8])
  assert.deepEqual(sharedGeometryLanes(all[0], all).map(l => l.id), ['u7~dup~abc'])
})

const stopsRoute = (id, n, lat0 = 52.5) => ({
  id, stops: Array.from({ length: n }, (_, i) => ({ id: `${id}s${i}`, name: `Stop ${i}`, lat: lat0 + i * 0.001, lon: 13.4 })),
})

test('laneStops lists every source of a merged lane in order', () => {
  const a = stopsRoute('a', 3), b = stopsRoute('b', 2, 53)
  const byId = new Map([[a.id, a], [b.id, b]])
  const stops = laneStops({ geometryIds: ['a', 'b'] }, byId)
  assert.deepEqual(stops.map(s => s.id), ['as0', 'as1', 'as2', 'bs0', 'bs1'])
  assert.equal(new Set(stops.map(s => s.key)).size, 5)
  assert.ok(stops[2].last && stops[0].index === 0)
  assert.deepEqual(laneStops({ geometryIds: ['missing'] }, byId), [])
})

test('stop markers: none below zoom 13, viewport-filtered and capped above it', () => {
  const r = stopsRoute('a', 200)
  const stops = laneStops({ geometryIds: ['a'] }, new Map([['a', r]]))
  const everywhere = { south: 0, west: 0, north: 90, east: 90 }
  assert.deepEqual(visibleStopMarkers(stops, { zoom: STOP_DETAIL_MIN_ZOOM - 0.25, bounds: everywhere, cap: 80 }), [])
  const capped = visibleStopMarkers(stops, { zoom: 14, bounds: everywhere, cap: 24, selectedKey: stops[101].key })
  assert.equal(capped.length, 24)
  const keys = capped.map(s => s.key)
  for (const k of [stops[0].key, stops[199].key, stops[101].key]) assert.ok(keys.includes(k), k)
  // Stays in stop order.
  assert.deepEqual(capped.map(s => s.index), [...capped.map(s => s.index)].sort((x, y) => x - y))
  // Only stops inside the viewport.
  const window = { south: 52.5095, west: 13, north: 52.5205, east: 14 }
  const inView = visibleStopMarkers(stops, { zoom: 15, bounds: window, cap: 80 })
  assert.deepEqual(inView.map(s => s.index), [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20])
  assert.ok(stopInView(stops[15], window))
  assert.ok(!stopInView(stops[50], window))
})

test('focus styling: selected is 4px, other audible lines dim, off previews unchanged', () => {
  const navy = { id: 'n', color: '#1f3a68' }
  const sel = routeLineStyle(navy, { active: true, theme: 'dark', focus: 'selected' })
  assert.equal(sel.line.weight, 4)
  assert.equal(sel.line.opacity, 1)
  assert.equal(sel.line.dashArray, null)
  assert.equal(sel.casing.weight, 6)
  // A focused lane that is off stays visibly "off" (dashed) at full strength.
  assert.ok(routeLineStyle(navy, { active: false, focus: 'selected' }).line.dashArray)
  const other = routeLineStyle(navy, { active: true, focus: 'other' })
  assert.equal(other.line.opacity, 0.5)
  assert.equal(other.line.weight, 3)
  assert.deepEqual(routeLineStyle(navy, { active: false, focus: 'other' }), routeLineStyle(navy, { active: false }))
  // No focus: byte-identical to phase 1.
  assert.deepEqual(routeLineStyle(navy, { active: true, focus: null }), routeLineStyle(navy, { active: true }))
})

test('fitTarget frames lines by an explicit audibility predicate', () => {
  const a = stopsRoute('a', 2), b = stopsRoute('b', 2, 53)
  assert.equal(fitTarget([a, b], r => r.id === 'b', null).bounds.latMin, 53)
  assert.equal(fitTarget([a, b], () => false, null).kind, 'previews')
})
