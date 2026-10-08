import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'

// Macro's path through the AI/MCP plan contract: tone.macro validation, both
// apply paths, the edit description, advisories and recipes. The plan
// vocabulary only offers Macro once released (NEXT_PUBLIC_MACRO_ENABLED), and
// modules read that at import time, so the flag is set before the dynamic
// imports below (node --test runs every file in its own process) and the
// flag-off behaviour is checked in a child process.
process.env.NEXT_PUBLIC_MACRO_ENABLED = 'true'

const specs = await import('../lib/macroSpecs.js')
const { SYNTH_DEFAULTS, toneToSynthParams, PICKER_SYNTH_TYPES } = await import('../lib/soundSpecs.js')
const { validatePlan, buildComposerGuide, SYNTH_TYPES: PLAN_SYNTH_TYPES } = await import('../lib/ai/planContract.js')
const { PLAN_INPUT_SCHEMA, COMPOSITION_RESPONSE_FORMAT } = await import('../lib/ai/planSchema.js')
const { trackSynthParams, withNewCompositionBaseline } = await import('../lib/ai/planApply.js')
const { applyPlanToSnapshot, defaultSnapshot, describeSnapshot } = await import('../lib/ai/planSnapshot.js')
const { planAdvisories } = await import('../lib/ai/planAdvisories.js')
const { SOUND_RECIPES, soundRecipeTrack, soundRecipeLine } = await import('../lib/ai/soundPolicy.js')
const { buildSnapshot, applySnapshot } = await import('../lib/songState.js')

const route = (id, type = 'metro') => ({ id, name: id, type, stops: [{ lat: 1, lon: 2 }], totalDist: 10 })
const CITY = [route('M1'), route('M2'), route('4', 'tram')]

const MACRO = { engine: 'modal', harmonics: 0.3, timbre: 0.6, morph: 0.7, transpose: -5, fmAmount: 0.1, lpgDecay: 0.4, voices: 3 }

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

test('tone.macro maps to the lane params and back', () => {
  const params = specs.macroToneToParams(MACRO)
  assert.equal(params.macroEngine, 'modal')
  assert.equal(params.macroFrequency, 2 / 14, 'transpose -5 st is knob 2/14')
  assert.equal(params.macroVoices, 3)
  assert.equal(params.macroDecay, 0.4)
  assert.equal(params.macroColour, undefined, 'only the keys the plan names')
  const back = specs.macroParamsToTone({ ...SYNTH_DEFAULTS.Macro, ...params })
  for (const [k, v] of Object.entries(MACRO)) assert.equal(back[k], v, k)
  assert.deepEqual(toneToSynthParams({ macro: MACRO }, 'Macro'), params)
  assert.deepEqual(toneToSynthParams({ macro: MACRO, oscillator: 'sine' }, 'Macro'), params, 'other instruments\' keys are not read')
})

test('released: the vocabulary, both schemas and the guide offer Macro', () => {
  assert.ok(PLAN_SYNTH_TYPES.includes('Macro'))
  assert.ok(PICKER_SYNTH_TYPES.includes('Macro'))
  const { plan, dropped } = validatePlan({ tracks: [{ routeId: 'M1', synthType: 'Macro', tone: { macro: MACRO } }] }, CITY)
  assert.deepEqual(dropped, [])
  assert.deepEqual(plan.tracks[0].tone, { macro: MACRO })
  assert.ok(PLAN_INPUT_SCHEMA.safeParse({ tracks: [{ routeId: 'M1', synthType: 'Macro', tone: { macro: MACRO } }] }).success)
  const strictTone = JSON.stringify(COMPOSITION_RESPONSE_FORMAT)
  assert.match(strictTone, /"lpgDecay"/, 'the strict schema carries tone.macro')
  const guide = buildComposerGuide({ routes: CITY })
  assert.match(guide, /Macro: a macro-oscillator with 24 synthesis engines/)
  for (const e of specs.MACRO_ENGINES) assert.ok(guide.includes(`${e.id} (${e.label}:`), e.id)
  assert.match(guide, /For Macro: tone\.macro \{engine/)
})

test('invalid tone.macro values are clamped or reported by key', () => {
  const { plan, dropped } = validatePlan({ tracks: [{
    routeId: 'M1', synthType: 'Macro',
    tone: { macro: { engine: 'moog', harmonics: 3, transpose: 11.6, fmAmount: -4, voices: 9, timbre: 'bright', wobble: 1 }, oscillator: 'sine' },
  }] }, CITY)
  assert.deepEqual(plan.tracks[0].tone, { macro: { harmonics: 1, transpose: 7, fmAmount: -1 } })
  for (const bit of ['tone.macro.engine "moog"', 'tone.macro.voices 9', 'tone.macro.timbre', 'tone.macro.wobble', 'tone.oscillator on Macro']) {
    assert.ok(dropped.some(d => d.includes(bit)), bit)
  }
  const notObject = validatePlan({ tracks: [{ routeId: 'M1', synthType: 'Macro', tone: { macro: 'modal' } }] }, CITY)
  assert.ok(notObject.dropped.some(d => d.startsWith('tone.macro on')))
  const onSynth = validatePlan({ tracks: [{ routeId: 'M1', synthType: 'Synth', tone: { macro: MACRO } }] }, CITY)
  assert.ok(onSynth.dropped.some(d => d.includes('tone.macro on Synth lane')))
})

test('both apply paths write the same Macro lane params (new and edit), never an envelope', () => {
  const { plan } = validatePlan({ tracks: [{
    routeId: 'M1', synthType: 'Macro', tone: { macro: MACRO },
    envelope: { attack: 0.5, decay: 0.1, sustain: 1, release: 1 },
  }] }, CITY)
  const { snapshot } = applyPlanToSnapshot(defaultSnapshot('budapest'), withNewCompositionBaseline(plan))
  // MixerTab.applyAIPlan: handleSynthType resets to SYNTH_DEFAULTS, then handleADSR
  // merges trackSynthParams(track, synthType).
  const mixerTab = { ...SYNTH_DEFAULTS.Macro, ...trackSynthParams(plan.tracks[0], 'Macro') }
  assert.equal(snapshot.trackSynthTypes.M1, 'Macro')
  assert.deepEqual(snapshot.trackADSRs.M1, mixerTab)
  assert.equal(snapshot.trackADSRs.M1.attack, undefined, 'a plan envelope is not written as inert keys')

  // An edit that omits synthType keeps the lane's instrument and filters by it.
  const edit = validatePlan({ tracks: [{ routeId: 'M1', tone: { macro: { morph: 0.2 }, oscillator: 'square' } }] }, CITY).plan
  const edited = applyPlanToSnapshot(snapshot, edit).snapshot
  assert.equal(edited.trackADSRs.M1.macroMorph, 0.2)
  assert.equal(edited.trackADSRs.M1.macroEngine, 'modal', 'the rest of the patch stays')
  assert.equal(edited.trackADSRs.M1.oscillatorType, undefined)
})

test('a Macro song survives the DAW load → save round trip unchanged', () => {
  const { plan } = validatePlan({ bpm: 96, tracks: [
    { routeId: 'M1', synthType: 'Macro', tone: { macro: MACRO } },
    { routeId: 'M2', synthType: 'Synth' },
  ] }, CITY)
  const { snapshot } = applyPlanToSnapshot(defaultSnapshot('budapest'), plan)
  assert.deepEqual(roundTrip(snapshot, CITY), snapshot)
})

test('an edit prompt describes the whole Macro patch, not an envelope', () => {
  const { plan } = validatePlan({ tracks: [{ routeId: 'M1', synthType: 'Macro', tone: { macro: MACRO } }] }, CITY)
  const { snapshot } = applyPlanToSnapshot(defaultSnapshot('budapest'), plan)
  const lane = describeSnapshot(snapshot, CITY, { detail: true }).lanes.find(l => l.routeId === 'M1')
  assert.equal(lane.synthType, 'Macro')
  assert.equal(lane.envelope, undefined)
  assert.deepEqual(lane.tone, { macro: specs.macroParamsToTone(snapshot.trackADSRs.M1) })
  assert.equal(lane.tone.macro.engine, 'modal')
  // Fed back as an edit, the description changes nothing.
  const again = validatePlan({ tracks: [{ routeId: 'M1', tone: lane.tone }] }, CITY)
  assert.deepEqual(again.dropped, [])
  assert.deepEqual(applyPlanToSnapshot(snapshot, again.plan).snapshot.trackADSRs.M1, snapshot.trackADSRs.M1)
})

test('advisories flag inert settings, chiptune drones, wild FM and the voice budget', () => {
  const clean = validatePlan({ tracks: [{ routeId: 'M1', synthType: 'Macro', tone: { macro: { engine: 'va', lpgDecay: 0.4 } } }] }, CITY).plan
  assert.deepEqual(planAdvisories(clean), [])

  const noisy = validatePlan({ tracks: [{
    routeId: 'M1', synthType: 'Macro', legato: true, glide: 0.2, noteLength: '2n',
    envelope: { attack: 2, decay: 0.1, sustain: 1, release: 1 },
    tone: { macro: { engine: 'va' } },
  }] }, CITY).plan
  const advice = planAdvisories(noisy)
  assert.equal(advice.length, 1, advice.join(' | '))
  for (const word of ['envelope', 'legato', 'glide', 'noteLength']) assert.ok(advice[0].includes(word), word)
  assert.ok(!advice[0].includes('2 s attack'), 'no generic attack-vs-length advice')

  // On a 6-op FM engine the note length is real.
  const sixOp = validatePlan({ tracks: [{ routeId: 'M1', synthType: 'Macro', noteLength: '1n', tone: { macro: { engine: 'sixOpB' } } }] }, CITY).plan
  assert.deepEqual(planAdvisories(sixOp), [])

  const chip = validatePlan({ tracks: [{ routeId: 'M1', synthType: 'Macro', tone: { macro: { engine: 'chiptune' } } }] }, CITY).plan
  assert.ok(planAdvisories(chip).some(a => a.includes('drones')))
  const chipOk = validatePlan({ tracks: [{ routeId: 'M1', synthType: 'Macro', tone: { macro: { engine: 'chiptune', timbreAmount: 0.3 } } }] }, CITY).plan
  assert.deepEqual(planAdvisories(chipOk), [])

  const zap = validatePlan({ tracks: [{ routeId: 'M1', synthType: 'Macro', tone: { macro: { engine: 'va', fmAmount: 0.6 } } }] }, CITY).plan
  assert.ok(planAdvisories(zap).some(a => a.includes('fmAmount')))

  // An edit that names no engine doesn't guess the lane's.
  const edit = validatePlan({ tracks: [{ routeId: 'M1', noteLength: '2n' }] }, CITY).plan
  edit.tracks[0].synthType = 'Macro'
  assert.deepEqual(planAdvisories(edit, { mode: 'edit' }), [])

  const heavy = validatePlan({ tracks: ['M1', 'M2', '4'].map(routeId => ({ routeId, synthType: 'Macro', tone: { macro: { engine: 'va', voices: 4 } } })) }, CITY).plan
  heavy.tracks.push(...heavy.tracks.map(t => ({ ...t, routeId: `${t.routeId}b` })))
  assert.ok(planAdvisories(heavy).some(a => a.includes('24 Macro voices')))
})

test('every Macro sound recipe validates untouched and raises no advisory', () => {
  const recipes = SOUND_RECIPES.filter(s => s.synthType === 'Macro')
  assert.deepEqual(recipes.map(r => r.id), ['R18', 'R19'])
  for (const r of recipes) {
    const track = soundRecipeTrack(r, 'M1')
    assert.equal(track.envelope, undefined, r.id)
    const { plan, dropped } = validatePlan({ tracks: [track] }, CITY)
    assert.deepEqual(dropped, [], r.id)
    assert.deepEqual(plan.tracks[0].tone, track.tone, r.id)
    assert.deepEqual(planAdvisories(plan), [], r.id)
    assert.match(soundRecipeLine(r), /no envelope \(a low-pass gate/, r.id)
  }
})

test('unreleased: plans cannot pick Macro, but an edit to an existing Macro lane still applies', () => {
  const script = `
    const { validatePlan, SYNTH_TYPES } = await import('./lib/ai/planContract.js')
    const { PICKER_SYNTH_TYPES, SYNTH_TYPES: ALL, TONE_SUPPORT } = await import('./lib/soundSpecs.js')
    const { SOUND_RECIPES } = await import('./lib/ai/soundPolicy.js')
    const { buildComposerGuide } = await import('./lib/ai/planContract.js')
    const { plan, dropped } = validatePlan({ tracks: [{ routeId: 'M1', synthType: 'Macro', tone: { macro: { morph: 0.3 } } }] }, [{ id: 'M1', type: 'metro' }])
    console.log(JSON.stringify({
      plan: SYNTH_TYPES.includes('Macro'), picker: PICKER_SYNTH_TYPES.includes('Macro'),
      buildable: ALL.includes('Macro') && !!TONE_SUPPORT.Macro,
      recipe: SOUND_RECIPES.some(r => r.synthType === 'Macro'),
      guide: buildComposerGuide({ routes: [] }).includes('macro-oscillator'),
      track: plan.tracks[0], dropped,
    }))`
  const env = { ...process.env }
  delete env.NEXT_PUBLIC_MACRO_ENABLED
  const out = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: new URL('..', import.meta.url), env,
  }).toString())
  assert.equal(out.plan, false)
  assert.equal(out.picker, false)
  assert.equal(out.recipe, false)
  assert.equal(out.guide, false)
  assert.equal(out.buildable, true, 'saved songs using it still build')
  assert.deepEqual(out.dropped, ['synthType "Macro"'])
  assert.deepEqual(out.track, { routeId: 'M1', tone: { macro: { morph: 0.3 } } })
})
