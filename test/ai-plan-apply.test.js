import test from 'node:test'
import assert from 'node:assert/strict'
import { buildReplacementLaneState } from '../lib/ai/planApply.js'
import { CITY_FACTS, factsForCity, shuffledFactsForCity } from '../lib/shared/cityFacts.js'

const CITY_IDS = ['budapest', 'helsinki', 'berlin', 'prague', 'newyork', 'zurich', 'warsaw']

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

test('every registered city has a deep pool of unique planning facts', () => {
  for (const cityId of CITY_IDS) {
    const facts = CITY_FACTS[cityId]
    // The overlay rotates every 7s during a wait that can run 30s+, so a small
    // pool means the same lines every single time.
    assert.ok(facts.length >= 10, `${cityId} has only ${facts.length} facts`)
    assert.equal(new Set(facts).size, facts.length, `${cityId} has duplicate facts`)
    assert.ok(facts.every(f => typeof f === 'string' && f.trim().length > 20), cityId)
    assert.equal(factsForCity(cityId), CITY_FACTS[cityId])
  }
  assert.equal(factsForCity('unknown'), CITY_FACTS.budapest)
})

test('shuffled facts keep the whole pool and never lead with the avoided line', () => {
  for (const cityId of CITY_IDS) {
    const source = CITY_FACTS[cityId]
    for (let i = 0; i < 50; i++) {
      const avoid = source[i % source.length]
      const shuffled = shuffledFactsForCity(cityId, avoid)
      assert.notEqual(shuffled, source, 'must not hand back the frozen source array')
      assert.deepEqual([...shuffled].sort(), [...source].sort(), cityId)
      assert.notEqual(shuffled[0], avoid, cityId)
    }
  }
})
