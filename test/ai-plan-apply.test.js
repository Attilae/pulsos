import test from 'node:test'
import assert from 'node:assert/strict'
import { buildReplacementLaneState } from '../lib/ai/planApply.js'
import { CITY_FACTS, factsForCity } from '../lib/shared/cityFacts.js'

test('AI replacement enables only planned lanes in plan order', () => {
  const routes = ['metro', 'tram', 'bus', 'rail'].map(id => ({ id }))
  const result = buildReplacementLaneState(routes, ['tram', 'metro'], { bus: false })

  assert.deepEqual(result.activeIds, ['tram', 'metro'])
  assert.deepEqual(result.skippedIds, [])
  assert.deepEqual(result.disabled, {
    metro: false,
    tram: false,
    bus: true,
    rail: true,
  })
})

test('AI replacement drops duplicate, unknown, and over-limit lanes deterministically', () => {
  const routes = ['a', 'b', 'c'].map(id => ({ id }))
  const result = buildReplacementLaneState(routes, ['b', 'missing', 'b', 'a', 'c'], {}, 2)

  assert.deepEqual(result.activeIds, ['b', 'a'])
  assert.deepEqual(result.skippedIds, ['missing', 'b', 'c'])
  assert.deepEqual(result.disabled, { a: false, b: false, c: true })
})

test('every registered city has multiple curated planning facts', () => {
  for (const cityId of ['budapest', 'helsinki', 'berlin', 'prague', 'newyork', 'zurich', 'warsaw']) {
    assert.ok(CITY_FACTS[cityId].length >= 3, cityId)
    assert.equal(factsForCity(cityId), CITY_FACTS[cityId])
  }
  assert.equal(factsForCity('unknown'), CITY_FACTS.budapest)
})
