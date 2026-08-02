import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildFrequencyMultipliers, buildServiceWeights, canonicalStopId,
  createStopSignalAccumulator, normalizeSignalMap,
} from '../scripts/lib/stopSignals.js'
import { generatePitchMap, noteToMidi, SCALES } from '../lib/mappings.js'

test('service weights distinguish daily, weekday, and exception-only services', () => {
  const calendar = [
    { service_id: 'daily', monday: '1', tuesday: '1', wednesday: '1', thursday: '1', friday: '1', saturday: '1', sunday: '1', start_date: '20260101', end_date: '20260107' },
    { service_id: 'weekday', monday: '1', tuesday: '1', wednesday: '1', thursday: '1', friday: '1', saturday: '0', sunday: '0', start_date: '20260101', end_date: '20260107' },
  ]
  const exceptions = [
    { service_id: 'special', date: '20260103', exception_type: '1' },
    { service_id: 'daily', date: '20260104', exception_type: '2' },
  ]
  const weights = buildServiceWeights(calendar, exceptions)
  assert.equal(weights.get('daily'), 6 / 7)
  assert.equal(weights.get('weekday'), 5 / 7)
  assert.equal(weights.get('special'), 1 / 7)
})

test('frequency templates expand to the correct number of runs', () => {
  const frequencies = buildFrequencyMultipliers([
    { trip_id: 't1', start_time: '06:00:00', end_time: '07:00:00', headway_secs: '600' },
    { trip_id: 't1', start_time: '17:00:00', end_time: '17:30:00', headway_secs: '900' },
  ])
  assert.equal(frequencies.get('t1'), 8)
})

test('stop signals aggregate platforms, count route transfers, and prefer ridership', () => {
  const stopMeta = {
    station: { name: 'Central', lat: 1, lon: 2, parentStation: null },
    north: { name: 'Central', lat: 1, lon: 2, parentStation: 'station' },
    south: { name: 'Central', lat: 1, lon: 2, parentStation: 'station' },
    local: { name: 'Local', lat: 1.1, lon: 2.1, parentStation: null },
  }
  assert.equal(canonicalStopId('north', stopMeta), 'station')
  const accumulator = createStopSignalAccumulator({
    stopMeta,
    tripToRoute: { t1: 'R1', t2: 'R2', t3: 'R1' },
    tripToService: {},
  })
  accumulator.addStopTime({ trip_id: 't1', stop_id: 'north' })
  accumulator.addStopTime({ trip_id: 't2', stop_id: 'south' })
  accumulator.addStopTime({ trip_id: 't3', stop_id: 'local' })
  const signals = accumulator.finalize(new Map([
    ['station', { ridership: 1000 }],
    ['local', { ridership: 10 }],
  ]))

  assert.equal(signals.get('station').departures, 2)
  assert.equal(signals.get('station').routes, 2)
  assert.equal(signals.get('station').source, 'ridership')
  assert.ok(signals.get('station').demand > signals.get('local').demand)
})

test('signal normalization is logarithmic and clips large outliers', () => {
  const normalized = normalizeSignalMap(new Map([['a', 1], ['b', 10], ['c', 1000000]]))
  assert.ok(normalized.get('b') > normalized.get('a'))
  assert.ok(normalized.get('c') <= 1)
})

test('demand contour maps more-used stops higher and stays deterministic', () => {
  const stops = [
    { id: 'low', lat: 47.4, lon: 8.6, signals: { demand: 0 } },
    { id: 'mid', lat: 47.3, lon: 8.5, signals: { demand: 0.5 } },
    { id: 'high', lat: 47.2, lon: 8.4, signals: { demand: 1 } },
  ]
  const opts = { contour: 'demand', variety: 0.4, routeId: 'R1' }
  const first = generatePitchMap(stops, 60, SCALES.major, 3, opts)
  const second = generatePitchMap(stops, 60, SCALES.major, 3, opts)
  assert.deepEqual(first, second)
  assert.ok(noteToMidi(first[0]) < noteToMidi(first[1]))
  assert.ok(noteToMidi(first[1]) < noteToMidi(first[2]))
})

test('demand contour falls back exactly to geographic for legacy route JSON', () => {
  const stops = [
    { id: 'a', lat: 47.2, lon: 8.4 },
    { id: 'b', lat: 47.5, lon: 8.7 },
  ]
  const demand = generatePitchMap(stops, 60, SCALES.minor, 3, { contour: 'demand', variety: 0, routeId: 'R' })
  const geographic = generatePitchMap(stops, 60, SCALES.minor, 3, { contour: 'geographic', variety: 0, routeId: 'R' })
  assert.deepEqual(demand, geographic)
})
