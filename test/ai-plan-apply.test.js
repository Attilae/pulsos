import test from 'node:test'
import assert from 'node:assert/strict'
import { buildReplacementLaneState, withNewCompositionBaseline, sendsToClear, toneToSynthParams, trackSynthParams } from '../lib/ai/planApply.js'
import { validatePlan } from '../lib/ai/planContract.js'
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

test('new-composition baseline fills omitted lane settings and never overrides the model', () => {
  const planIn = {
    tracks: [{ routeId: 'a', speed: 0.5, arp: { enabled: true, style: 'down' } }, { routeId: 'b' }],
    fx: [],
  }
  const out = withNewCompositionBaseline(planIn)
  const [a, b] = out.tracks
  assert.equal(a.speed, 0.5, 'model value kept')
  assert.deepEqual(a.arp, { enabled: true, style: 'down' }, 'model object kept whole')
  assert.equal(b.speed, 1)
  assert.equal(b.arp.enabled, false)
  assert.equal(b.granular.enabled, false)
  assert.equal(b.sidechain.enabled, false)
  assert.deepEqual(b.drone, { enabled: false })
  assert.equal(b.noteChance, 1)
  assert.deepEqual(b.loopPattern, { play: 1, rest: 0, offset: 0 })
  assert.deepEqual(b.loopRegion, { startCell: 0, endCell: 64 })
  assert.deepEqual(out.drums, { enabled: false }, 'no drums block → drums off')
  assert.equal(out.clearSends, true)
  assert.equal(planIn.tracks[1].speed, undefined, 'input not mutated')
  b.loopRegion.startCell = 5
  assert.equal(withNewCompositionBaseline(planIn).tracks[1].loopRegion.startCell, 0, 'defaults are not shared')

  const withDrums = withNewCompositionBaseline({ tracks: [], drums: { enabled: true, patterns: {} } })
  assert.equal(withDrums.drums.enabled, true)
})

test('sendsToClear picks non-zero sends from the given lanes only', () => {
  const matrix = { 'a:reverb': 0.4, 'a:delay': 0, 'b:reverb': 0.2, '__drums__:delay': 0.3 }
  assert.deepEqual(sendsToClear(matrix, ['a', '__drums__']), [
    { routeId: 'a', busId: 'reverb' },
    { routeId: '__drums__', busId: 'delay' },
  ])
})

test('toneToSynthParams maps a plan tone onto the synth param block keys', () => {
  assert.deepEqual(toneToSynthParams(null), {})
  assert.deepEqual(toneToSynthParams({
    oscillator: 'fatsawtooth', harmonicity: 2, modulationIndex: 3,
    modEnvelope: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.08 },
  }), {
    oscillatorType: 'fatsawtooth', harmonicity: 2, modulationIndex: 3,
    modAttack: 0.001, modDecay: 0.12, modSustain: 0, modRelease: 0.08,
  })
  assert.deepEqual(
    trackSynthParams({ envelope: { attack: 0.01 }, tone: { oscillator: 'square' } }),
    { attack: 0.01, oscillatorType: 'square' },
  )
})

test('validatePlan keeps only the tone keys the instrument uses, and clamps them', () => {
  const routes = [{ id: 'A' }, { id: 'B' }, { id: 'C' }]
  const { plan, dropped } = validatePlan({ tracks: [
    { routeId: 'A', synthType: 'Sampler', samplerPreset: 'piano', tone: { oscillator: 'square' } },
    { routeId: 'B', synthType: 'Synth', tone: { oscillator: 'sawtooth', modulationIndex: 5 } },
    { routeId: 'C', tone: { oscillator: 'nope', harmonicity: 99, modulationIndex: 90 } },
  ] }, routes)
  assert.equal(plan.tracks[0].tone, undefined)
  assert.deepEqual(plan.tracks[1].tone, { oscillator: 'sawtooth' })
  assert.deepEqual(plan.tracks[2].tone, { harmonicity: 20, modulationIndex: 40 }, 'no synthType (an edit): valid keys kept, clamped')
  assert.ok(dropped.some(d => d.startsWith('tone.oscillator on Sampler lane "A"')))
  assert.ok(dropped.some(d => d.startsWith('tone.modulationIndex on Synth lane "B"')))
  assert.ok(dropped.includes('tone.oscillator "nope" on "C"'))
})
