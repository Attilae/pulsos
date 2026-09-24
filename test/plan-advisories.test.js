import test from 'node:test'
import assert from 'node:assert/strict'
import { planAdvisories } from '../lib/ai/planAdvisories.js'
import { validatePlan } from '../lib/ai/planContract.js'

const routes = ['A', 'B'].map(id => ({ id, type: 'metro' }))
const env = (attack, decay = 0.2, sustain = 0.5, release = 0.3) => ({ attack, decay, sustain, release })
const kick = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]

function advise(raw, options) {
  const { plan } = validatePlan(raw, routes)
  return planAdvisories(plan, options)
}
const one = (raw, pattern, options) => {
  const list = advise(raw, options)
  assert.equal(list.length, 1, `expected one advisory, got ${JSON.stringify(list)}`)
  assert.match(list[0], pattern)
}

test('a clean plan raises nothing', () => {
  assert.deepEqual(advise({ bpm: 120, tracks: [{ routeId: 'A', synthType: 'Synth', envelope: env(0.01) }] }), [])
  assert.deepEqual(planAdvisories(null), [])
})

test('an attack longer than the one-beat gate, unless the note is held', () => {
  one({ bpm: 120, tracks: [{ routeId: 'A', synthType: 'Synth', envelope: env(0.8) }] }, /0\.8 s attack .* one beat \(0\.5 s at 120 BPM\)/)
  assert.deepEqual(advise({ bpm: 60, tracks: [{ routeId: 'A', synthType: 'Synth', envelope: env(0.8) }] }), [], '0.8 s fits a 1 s beat')
  assert.deepEqual(advise({ bpm: 120, tracks: [{ routeId: 'A', synthType: 'Synth', envelope: env(0.8), legato: true }] }), [])
  assert.deepEqual(advise({ bpm: 120, harmony: { root: 'C', scaleType: 'major' }, tracks: [{ routeId: 'A', synthType: 'Synth', envelope: env(0.8), drone: { enabled: true } }] }), [])
  one({ tracks: [{ routeId: 'A', synthType: 'Synth', envelope: env(0.8) }] }, /at 90 BPM/, { bpm: 90 })
})

test('instrument-specific rules', () => {
  const pluck = advise({ tracks: [{ routeId: 'A', synthType: 'PluckSynth', envelope: env(0.01) }] })
  assert.equal(pluck.length, 2, 'hidden instrument + ignored envelope')
  assert.match(pluck[1], /ignores envelope/)
  const pluckOnly = advise({ tracks: [{ routeId: 'A', synthType: 'PluckSynth' }] })
  assert.equal(pluckOnly.length, 1)
  assert.match(pluckOnly[0], /picker does not offer/)
  one({ tracks: [{ routeId: 'A', synthType: 'FMSynth', envelope: env(0.005) }] }, /modulator attack/)
  assert.deepEqual(advise({ tracks: [{ routeId: 'A', synthType: 'FMSynth', envelope: env(0.005),
    tone: { modEnvelope: env(0.001, 0.12, 0, 0.08) } }] }), [])
  one({ tracks: [{ routeId: 'A', synthType: 'Sampler', samplerPreset: 'piano', legato: true }] }, /voices pile up/)
  one({ tracks: [{ routeId: 'A', synthType: 'NoiseSynth', octave: 1 }] }, /unpitched NoiseSynth, so octave has no pitch effect/)
  one({ tracks: [{ routeId: 'A', synthType: 'Drums', drumVoice: 'kick', scale: { root: 'C', scaleType: 'minor' } }] }, /fixed-pitch Drums/)
})

test('granular rules', () => {
  const g = (mix) => ({ enabled: true, mix, grainSize: 0.1, overlap: 0.05, playbackRate: 1, loopStart: 0, loopEnd: 1, jitter: 0, reverse: false, attack: 0.05, release: 0.4 })
  one({ tracks: [{ routeId: 'A', synthType: 'Sampler', samplerPreset: 'piano', granular: g(0.08) }] }, /treated as C4/)
  one({ tracks: [{ routeId: 'A', synthType: 'PolySynth', granular: g(0.6) }] }, /granular mix 0\.6/)
  one({ tracks: [{ routeId: 'A', synthType: 'PolySynth', label: 'Bass', granular: g(0.08) }] }, /keep the bass dry/)
})

test('new mode needs an instrument per lane; edit mode does not', () => {
  one({ tracks: [{ routeId: 'A', volume: -6 }] }, /no synthType/)
  assert.deepEqual(advise({ tracks: [{ routeId: 'A', volume: -6 }] }, { mode: 'edit' }), [])
})

test('a sidechain on a silent pad never ducks', () => {
  const base = { routeId: 'A', synthType: 'Synth', sidechain: { enabled: true, source: 'drums:clap', amountDb: -8, attack: 0.005, release: 0.2 } }
  one({ tracks: [base], drums: { enabled: true, patterns: [{ padId: 'kick', steps: kick }] } }, /drums:clap, but that pad has no steps/)
  assert.deepEqual(advise({ tracks: [{ ...base, sidechain: { ...base.sidechain, source: 'drums:kick' } }],
    drums: { enabled: true, patterns: [{ padId: 'kick', steps: kick }] } }), [])
})
