import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'

// The Resonator's pure vocabulary and its path through the AI/MCP plan contract.
// The plan vocabulary only offers the Resonator once released
// (NEXT_PUBLIC_RESONATOR_ENABLED), and modules read that at import time — so the
// flag is set before the dynamic imports below (node --test runs every file in
// its own process), and the flag-off behaviour is checked in a child process.
process.env.NEXT_PUBLIC_RESONATOR_ENABLED = 'true'

const specs = await import('../lib/resonatorSpecs.js')
const { SYNTH_DEFAULTS, toneToSynthParams, PICKER_SYNTH_TYPES } = await import('../lib/soundSpecs.js')
const { validatePlan, buildComposerGuide, SYNTH_TYPES: PLAN_SYNTH_TYPES } = await import('../lib/ai/planContract.js')
const { PLAN_INPUT_SCHEMA } = await import('../lib/ai/planSchema.js')
const { trackSynthParams, withNewCompositionBaseline } = await import('../lib/ai/planApply.js')
const { applyPlanToSnapshot, defaultSnapshot, describeSnapshot } = await import('../lib/ai/planSnapshot.js')
const { planAdvisories } = await import('../lib/ai/planAdvisories.js')
const { SOUND_RECIPES, soundRecipeTrack } = await import('../lib/ai/soundPolicy.js')
const { buildSnapshot, applySnapshot } = await import('../lib/songState.js')

const route = (id, type = 'metro') => ({ id, name: id, type, stops: [{ lat: 1, lon: 2 }], totalDist: 10 })
const CITY = [route('M1'), route('M2'), route('4', 'tram')]

const TONE = { resonatorModel: 'sympathetic', structure: 0.7, brightness: 0.3, damping: 0.85, position: 0.5, resonatorVoices: 3 }

function roundTrip(snapshot, routes) {
  const state = {}
  const setters = new Proxy({}, {
    get: (_t, name) => (value) => {
      const key = String(name).slice(3)
      state[key[0].toLowerCase() + key.slice(1)] = value
    },
  })
  const base = snapshot.routeIds.map(id => routes.find(r => r.id === id)).filter(Boolean)
  applySnapshot(snapshot, setters, null, base)
  return buildSnapshot({ ...state, cityId: snapshot.cityId, routeIds: snapshot.routeIds, laneManifest: snapshot.laneManifest })
}

test('normalization fills defaults, clamps, and rejects junk from imported songs', () => {
  assert.deepEqual(specs.normalizeResonatorParams(undefined), specs.RESONATOR_DEFAULTS)
  assert.deepEqual(specs.normalizeResonatorParams({
    resonatorModel: 'fm', resonatorStructure: NaN, resonatorBrightness: 7, resonatorDamping: -1,
    resonatorPosition: '0.25', resonatorVoices: 9, attack: 0.3,
  }), {
    ...specs.RESONATOR_DEFAULTS,
    resonatorBrightness: 1, resonatorDamping: 0, resonatorPosition: 0.25,
  })
  assert.equal(specs.normalizeResonatorParams({ resonatorVoices: 3.4 }).resonatorVoices, 3)
  assert.deepEqual(specs.RESONATOR_MODELS.map(m => m.index), [0, 1, 2])
  assert.deepEqual(SYNTH_DEFAULTS.Resonator, specs.RESONATOR_DEFAULTS)
})

test('automation targets are the four timbre params, 0..1, and each is a real lane param key', () => {
  const targets = specs.RESONATOR_AUTOMATION_TARGETS
  assert.deepEqual(targets.map(t => t.id), ['synth.resonatorStructure', 'synth.resonatorBrightness', 'synth.resonatorDamping', 'synth.resonatorPosition'])
  for (const t of targets) {
    assert.equal(t.min, 0)
    assert.equal(t.max, 1)
    assert.equal(t.curve, undefined, 'linear, like the knobs')
    const key = t.id.slice('synth.'.length)
    assert.ok(specs.RESONATOR_PARAM_KEYS.includes(key), key)
    // The engine applies an automated value through set({ [key]: v }), which normalizes.
    assert.equal(specs.normalizeResonatorParams({ [key]: 0.123 })[key], 0.123)
  }
})

test('tone ↔ params mapping round-trips and never leaks onto other instruments', () => {
  const params = toneToSynthParams(TONE, 'Resonator')
  assert.deepEqual(params, {
    resonatorModel: 'sympathetic', resonatorStructure: 0.7, resonatorBrightness: 0.3,
    resonatorDamping: 0.85, resonatorPosition: 0.5, resonatorVoices: 3,
  })
  assert.deepEqual(specs.resonatorParamsToTone(params), TONE)
  assert.deepEqual(toneToSynthParams(TONE, 'Synth'), {})
  assert.deepEqual(toneToSynthParams({ resonance: 0.9, damping: 0.4 }, 'PluckSynth'), { resonance: 0.9 })
  // Envelope keys are inert on the Resonator and aren't written into its params.
  assert.deepEqual(trackSynthParams({ envelope: { attack: 1 }, tone: { damping: 0.2 } }, 'Resonator'), { resonatorDamping: 0.2 })
})

test('released: the plan vocabulary, schema and guide offer the Resonator', () => {
  assert.ok(PLAN_SYNTH_TYPES.includes('Resonator'))
  assert.ok(PICKER_SYNTH_TYPES.includes('Resonator'))
  const { plan, dropped } = validatePlan({ tracks: [{ routeId: 'M1', synthType: 'Resonator', tone: TONE }] }, CITY)
  assert.deepEqual(dropped, [])
  assert.deepEqual(plan.tracks[0].tone, TONE)
  assert.ok(PLAN_INPUT_SCHEMA.safeParse({ tracks: [{ routeId: 'M1', synthType: 'Resonator', tone: TONE }] }).success)
  const guide = buildComposerGuide({ routes: CITY })
  assert.match(guide, /Resonator: a physical-modelling resonator/)
  assert.match(guide, /HIGHER RINGS LONGER/)
})

test('invalid resonator tone values are clamped or reported', () => {
  const { plan, dropped } = validatePlan({ tracks: [{
    routeId: 'M1', synthType: 'Resonator',
    tone: { resonatorModel: 'fm', structure: 2, damping: -1, resonatorVoices: 8, oscillator: 'sine' },
  }] }, CITY)
  assert.deepEqual(plan.tracks[0].tone, { structure: 1, damping: 0 })
  assert.equal(dropped.length, 3)
  assert.ok(dropped.some(d => d.includes('resonatorModel')))
  assert.ok(dropped.some(d => d.includes('resonatorVoices')))
  assert.ok(dropped.some(d => d.includes('tone.oscillator on Resonator')))
})

test('both apply paths write the same Resonator lane params (new and edit)', () => {
  const { plan } = validatePlan({ tracks: [{ routeId: 'M1', synthType: 'Resonator', tone: TONE, envelope: { attack: 0.5, decay: 0.1, sustain: 1, release: 1 } }] }, CITY)
  const { snapshot } = applyPlanToSnapshot(defaultSnapshot('budapest'), withNewCompositionBaseline(plan))
  // MixerTab.applyAIPlan: handleSynthType resets to SYNTH_DEFAULTS, then handleADSR
  // merges trackSynthParams(track, synthType).
  const mixerTab = { ...SYNTH_DEFAULTS.Resonator, ...trackSynthParams(plan.tracks[0], 'Resonator') }
  assert.equal(snapshot.trackSynthTypes.M1, 'Resonator')
  assert.deepEqual(snapshot.trackADSRs.M1, mixerTab)
  assert.equal(snapshot.trackADSRs.M1.attack, undefined)

  // An edit that omits synthType keeps the lane's instrument and filters by it.
  const edit = validatePlan({ tracks: [{ routeId: 'M1', tone: { damping: 0.2, oscillator: 'square' } }] }, CITY).plan
  const edited = applyPlanToSnapshot(snapshot, edit).snapshot
  assert.equal(edited.trackADSRs.M1.resonatorDamping, 0.2)
  assert.equal(edited.trackADSRs.M1.oscillatorType, undefined)
  assert.equal(edited.trackADSRs.M1.resonatorModel, 'sympathetic')
})

test('a Resonator song survives the DAW load → save round trip unchanged', () => {
  const { plan } = validatePlan({ bpm: 90, tracks: [
    { routeId: 'M1', synthType: 'Resonator', tone: TONE },
    { routeId: 'M2', synthType: 'Synth' },
  ] }, CITY)
  const { snapshot } = applyPlanToSnapshot(defaultSnapshot('budapest'), plan)
  assert.deepEqual(roundTrip(snapshot, CITY), snapshot)
})

test('an edit prompt describes the Resonator patch, not an envelope', () => {
  const { plan } = validatePlan({ tracks: [{ routeId: 'M1', synthType: 'Resonator', tone: TONE }] }, CITY)
  const { snapshot } = applyPlanToSnapshot(defaultSnapshot('budapest'), plan)
  const lane = describeSnapshot(snapshot, CITY, { detail: true }).lanes.find(l => l.routeId === 'M1')
  assert.equal(lane.synthType, 'Resonator')
  assert.deepEqual(lane.tone, TONE)
  assert.equal(lane.envelope, undefined)
})

test('advisories flag inert settings and the voice budget, and stay quiet on a clean lane', () => {
  const clean = validatePlan({ tracks: [{ routeId: 'M1', synthType: 'Resonator', tone: { damping: 0.6 } }] }, CITY).plan
  assert.deepEqual(planAdvisories(clean), [])
  const noisy = validatePlan({ tracks: [{
    routeId: 'M1', synthType: 'Resonator', legato: true, glide: 0.2, noteLength: '2n',
    envelope: { attack: 1, decay: 0.1, sustain: 1, release: 1 },
    granular: { enabled: true, mix: 0.5 },
  }] }, CITY).plan
  const [msg, ...rest] = planAdvisories(noisy)
  assert.equal(rest.length, 0, 'one consolidated advisory, not the generic envelope/granular ones')
  for (const word of ['envelope', 'noteLength', 'legato', 'glide', 'granular']) assert.ok(msg.includes(word), word)
  const heavy = validatePlan({ tracks: ['M1', 'M2', '4'].map(routeId => ({ routeId, synthType: 'Resonator', tone: { resonatorVoices: 4 } })) }, CITY).plan
  heavy.tracks.push(...heavy.tracks.map(t => ({ ...t, routeId: `${t.routeId}b` })))
  assert.ok(planAdvisories(heavy).some(a => a.includes('24 Resonator voices')))
})

test('the Resonator sound recipe validates untouched and raises no advisory', () => {
  const r = SOUND_RECIPES.find(s => s.synthType === 'Resonator')
  assert.ok(r)
  const track = soundRecipeTrack(r, 'M1')
  const { plan, dropped } = validatePlan({ tracks: [track] }, CITY)
  assert.deepEqual(dropped, [])
  assert.deepEqual(plan.tracks[0].tone, track.tone)
  assert.deepEqual(planAdvisories(plan), [])
})

test('unreleased: plans cannot pick the Resonator, but an edit to an existing Resonator lane still applies', () => {
  const script = `
    const { validatePlan, SYNTH_TYPES } = await import('./lib/ai/planContract.js')
    const { PICKER_SYNTH_TYPES, SYNTH_TYPES: ALL, TONE_SUPPORT } = await import('./lib/soundSpecs.js')
    const { SOUND_RECIPES } = await import('./lib/ai/soundPolicy.js')
    const { plan, dropped } = validatePlan({ tracks: [{ routeId: 'M1', synthType: 'Resonator', tone: { damping: 0.3 } }] }, [{ id: 'M1', type: 'metro' }])
    console.log(JSON.stringify({
      plan: SYNTH_TYPES.includes('Resonator'), picker: PICKER_SYNTH_TYPES.includes('Resonator'),
      buildable: ALL.includes('Resonator') && !!TONE_SUPPORT.Resonator,
      recipe: SOUND_RECIPES.some(r => r.synthType === 'Resonator'),
      track: plan.tracks[0], dropped,
    }))`
  const env = { ...process.env }
  delete env.NEXT_PUBLIC_RESONATOR_ENABLED
  const out = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: new URL('..', import.meta.url), env,
  }).toString())
  assert.equal(out.plan, false)
  assert.equal(out.picker, false)
  assert.equal(out.recipe, false)
  assert.equal(out.buildable, true, 'saved songs using it still build')
  assert.deepEqual(out.dropped, ['synthType "Resonator"'])
  assert.deepEqual(out.track, { routeId: 'M1', tone: { damping: 0.3 } })
})
