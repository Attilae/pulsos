import test from 'node:test'
import assert from 'node:assert/strict'
import { validatePlan } from '../lib/ai/planContract.js'
import { planAdvisories } from '../lib/ai/planAdvisories.js'
import { applyPlanToSnapshot, defaultSnapshot, describeSnapshot } from '../lib/ai/planSnapshot.js'
import { trackSynthParams } from '../lib/ai/planApply.js'
import { SYNTH_DEFAULTS, polyVoiceOf, polyTargetActive } from '../lib/soundSpecs.js'

const route = (id, type = 'tram') => ({ id, name: id, type, stops: [{}, {}] })
const CITY = [route('M1', 'metro'), route('4')]
const env = (attack, decay = 0.2, sustain = 0.5, release = 1) => ({ attack, decay, sustain, release })
const validated = (raw) => validatePlan(raw, CITY)
const advise = (raw, options) => planAdvisories(validated(raw).plan, options)

test('polyVoiceOf falls back to the Basic voice', () => {
  assert.equal(polyVoiceOf({ voice: 'FMSynth' }), 'FMSynth')
  assert.equal(polyVoiceOf({ voice: 'DuoSynth' }), 'Synth')
  assert.equal(polyVoiceOf(null), 'Synth')
})

test('validatePlan keeps tone.voice on PolySynth only', () => {
  const ok = validated({ tracks: [{ routeId: 'M1', synthType: 'PolySynth', tone: { voice: 'FMSynth', harmonicity: 2 } }] })
  assert.deepEqual(ok.plan.tracks[0].tone, { voice: 'FMSynth', harmonicity: 2 })

  const onSynth = validated({ tracks: [{ routeId: 'M1', synthType: 'Synth', tone: { voice: 'FMSynth' } }] })
  assert.equal(onSynth.plan.tracks[0].tone, undefined)
  assert.ok(onSynth.dropped.some(d => /tone\.voice on Synth/.test(d)))

  const unknown = validated({ tracks: [{ routeId: 'M1', synthType: 'PolySynth', tone: { voice: 'MetalSynth' } }] })
  assert.ok(unknown.dropped.some(d => /tone\.voice "MetalSynth"/.test(d)))
})

test('the voice reaches the lane params, and an edit only applies it to a PolySynth lane', () => {
  const t = { synthType: 'PolySynth', tone: { voice: 'AMSynth', harmonicity: 1.5 } }
  assert.deepEqual(trackSynthParams(t), { voice: 'AMSynth', harmonicity: 1.5 })
  assert.deepEqual(trackSynthParams({ tone: { voice: 'AMSynth' } }, 'Synth'), {})
})

test('an FM pad is stored, described with its voice, and Basic-voice leftovers are not reported', () => {
  const raw = { tracks: [
    { routeId: 'M1', synthType: 'PolySynth', envelope: env(0.5),
      tone: { voice: 'FMSynth', harmonicity: 2, modEnvelope: env(0.3, 0.2, 0.6, 1.5) } },
  ] }
  const { snapshot } = applyPlanToSnapshot(defaultSnapshot('budapest'), validated(raw).plan)
  assert.deepEqual(snapshot.trackADSRs.M1, {
    ...SYNTH_DEFAULTS.PolySynth, ...env(0.5), voice: 'FMSynth', harmonicity: 2,
    modAttack: 0.3, modDecay: 0.2, modSustain: 0.6, modRelease: 1.5,
  })
  const lane = describeSnapshot(snapshot, CITY, { detail: true }).lanes.find(l => l.routeId === 'M1')
  assert.deepEqual(lane.tone, { voice: 'FMSynth', harmonicity: 2, modEnvelope: { attack: 0.3, decay: 0.2, sustain: 0.6, release: 1.5 } })

  // Switched back to Basic: the FM settings are kept in the lane but do nothing.
  snapshot.trackADSRs.M1 = { ...snapshot.trackADSRs.M1, voice: 'Synth' }
  const basic = describeSnapshot(snapshot, CITY, { detail: true }).lanes.find(l => l.routeId === 'M1')
  assert.equal(basic.tone, undefined)
})

test('advisories: FM/AM keys on the wrong voice, and the FM voice\'s late modulator', () => {
  const [basic] = advise({ tracks: [{ routeId: 'M1', synthType: 'PolySynth', envelope: env(0.3), tone: { harmonicity: 2 } }] })
  assert.match(basic, /Basic voice, so tone\.harmonicity does nothing.*tone\.voice/)

  const [am] = advise({ tracks: [{ routeId: 'M1', synthType: 'PolySynth', envelope: env(0.3), tone: { voice: 'AMSynth', modulationIndex: 5 } }] })
  assert.match(am, /AM voice, so tone\.modulationIndex does nothing/)

  const [fm] = advise({ tracks: [{ routeId: 'M1', synthType: 'PolySynth', envelope: env(0.01), tone: { voice: 'FMSynth' } }] })
  assert.match(fm, /PolySynth on its FM voice with a fast attack/)
  assert.deepEqual(advise({ tracks: [{ routeId: 'M1', synthType: 'PolySynth', envelope: env(0.01),
    tone: { voice: 'FMSynth', modEnvelope: env(0.001, 0.12, 0, 0.08) } }] }), [])

  // An edit that names no voice keeps the lane's own, which isn't known here.
  assert.deepEqual(advise({ tracks: [{ routeId: 'M1', synthType: 'PolySynth', envelope: env(0.3), tone: { harmonicity: 2 } }] }, { mode: 'edit' }), [])
})

test('PolySynth automation targets follow the voice', () => {
  assert.equal(polyTargetActive('synth.harmonicity', 'PolySynth', { voice: 'Synth' }), false)
  assert.equal(polyTargetActive('synth.harmonicity', 'PolySynth', { voice: 'AMSynth' }), true)
  assert.equal(polyTargetActive('synth.modulationIndex', 'PolySynth', { voice: 'AMSynth' }), false)
  assert.equal(polyTargetActive('synth.modulationIndex', 'PolySynth', { voice: 'FMSynth' }), true)
  assert.equal(polyTargetActive('synth.attack', 'PolySynth', {}), true)
  assert.equal(polyTargetActive('synth.harmonicity', 'FMSynth', {}), true, 'other instruments are unaffected')
})
