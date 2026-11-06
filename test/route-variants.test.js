import test from 'node:test'
import assert from 'node:assert/strict'
import { groupRouteVariants, createVariantTripSelector } from '../scripts/lib/routeVariants.js'

const route = (route_id, extra = {}) => ({
  route_id, agency_id: '04', route_type: '1', route_short_name: 'U1', ...extra,
})

test('timetable variants share stable line IDs without merging agencies, modes or unnamed routes', () => {
  const result = groupRouteVariants([
    route('old'), route('new'), route('other-agency', { agency_id: '03' }),
    route('replacement', { route_type: '3' }),
    route('unnamed-a', { route_short_name: '' }), route('unnamed-b', { route_short_name: '' }),
  ], 'vienna')
  assert.equal(result.rows.length, 5)
  assert.equal(result.routeIdMap.get('old'), result.routeIdMap.get('new'))
  assert.deepEqual(result.rows[0].sourceRouteIds, ['old', 'new'])
  const refreshed = groupRouteVariants([route('next-year')], 'vienna')
  assert.equal(refreshed.rows[0].route_id, result.rows[0].route_id)
})

test('canonical shape uses combined service supply, suppressing one-off diversions and cancelled trips', () => {
  const selector = createVariantTripSelector(new Map([
    ['event', 1 / 365], ['weekday', 5 / 7], ['weekend', 2 / 7], ['cancelled', 0],
  ]))
  const add = (trip_id, service_id, shape_id, direction_id = '0') =>
    selector.add({ trip_id, service_id, shape_id, direction_id }, 'line')
  add('a-event', 'event', 'diversion')
  add('c-daily', 'weekday', 'normal')
  add('b-weekend', 'weekend', 'normal')
  add('a-cancelled', 'cancelled', 'normal')
  add('reverse', 'weekday', 'return', '1')
  add('unknown', 'missing', 'unknown')
  assert.deepEqual(selector.finalize(), {
    line_0: { tripId: 'b-weekend', shapeId: 'normal', dir: 0 },
    line_1: { tripId: 'reverse', shapeId: 'return', dir: 1 },
  })
})

test('frequency templates count actual runs and tied shapes are deterministic across input ordering', () => {
  const rows = [
    { trip_id: 'one', service_id: 'daily', shape_id: 'z', direction_id: '0' },
    { trip_id: 'two', service_id: 'daily', shape_id: 'a', direction_id: '0' },
  ]
  for (const ordered of [rows, rows.toReversed()]) {
    const tied = createVariantTripSelector(new Map([['daily', 1]]))
    for (const r of ordered) tied.add(r, 'line')
    assert.equal(tied.finalize().line_0.shapeId, 'a')
    const weighted = createVariantTripSelector(new Map([['daily', 1]]), new Map([['one', 10]]))
    for (const r of ordered) weighted.add(r, 'line')
    assert.equal(weighted.finalize().line_0.shapeId, 'z')
  }
})
