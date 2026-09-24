import test from 'node:test'
import assert from 'node:assert/strict'
import { composerVocabularyText, fxBusDocs, buildSystemPrompt, buildComposerGuide, validatePlan, EXAMPLE_PLAN_JSON } from '../lib/ai/planContract.js'
import { PLAN_INPUT_SCHEMA } from '../lib/ai/planSchema.js'
import { selectRecipe } from '../lib/ai/musicalPolicy.js'
import { planAdvisories } from '../lib/ai/planAdvisories.js'
import { OSC_TYPES } from '../lib/soundSpecs.js'

// The prompt the model composes from must not contradict the engine. These pin
// the corrections from docs/composer-musical-guide.md §5: loop windows select
// material (they never delay an entrance), delay/pre-delay are stored in
// seconds, and reverb decay only reaches the synthetic IR.

const busLine = (id) => fxBusDocs().split('\n').find(line => line.startsWith(`- "${id}"`))

test('FX docs give plan values in their stored unit, not the UI display unit', () => {
  assert.match(busLine('delay'), /delayTime \(0\.01\.\.1\.5 s\)/)
  assert.match(busLine('pingpong'), /delayTime \(0\.01\.\.1\.5 s\)/)
  assert.match(busLine('reverb'), /preDelay \(0\.\.0\.2 s\)/)
  assert.match(busLine('chorus'), /delayTime \(1\.\.20 ms\)/, 'chorus delay really is milliseconds')
  assert.doesNotMatch(busLine('delay'), /\bms\b/)
})

test('the guide explains fixed IRs and the synthetic reverb', () => {
  const text = composerVocabularyText()
  assert.match(text, /decay and preDelay only affect irType "synthetic"/)
  assert.match(text, /fixed recordings/)
})

test('the guide describes loop windows as material selection, with the loop-length formula', () => {
  const text = composerVocabularyText()
  assert.doesNotMatch(text, /later or shorter loopRegions/)
  assert.doesNotMatch(text, /so parts enter/)
  assert.match(text, /never delays the lane's entrance/)
  assert.match(text, /beats = 16 × \(endCell − startCell\) ÷ 64 ÷ speed/)
})

test('the embedded example plan follows its own advice', () => {
  const example = JSON.parse(EXAMPLE_PLAN_JSON)
  const json = JSON.stringify(example)
    .replaceAll('<one of the ids above>', 'L1')
    .replaceAll('<another id above>', 'L2')
  const plan = JSON.parse(json)
  assert.equal(PLAN_INPUT_SCHEMA.safeParse(plan).success, true)
  const validated = validatePlan(plan, [{ id: 'L1', type: 'metro' }, { id: 'L2', type: 'metro' }])
  assert.deepEqual(validated.dropped, [])
  assert.deepEqual(planAdvisories(validated.plan), [], 'the example raises no advisories')
  assert.equal(validated.plan.tracks[0].tone.oscillator, 'square', 'the example shows tone')

  for (const track of plan.tracks) {
    assert.deepEqual(track.loopRegion, { startCell: 0, endCell: 64 })
  }
  for (const fx of plan.fx) {
    const params = Object.fromEntries(fx.params.map(p => [p.paramId, p.value]))
    if (fx.busId === 'reverb' && 'decay' in params) assert.equal(params.irType, 'synthetic')
    assert.equal(fx.wet, 1, 'parallel sends keep wet at 1')
  }
})

// Instrument facts from docs/composer-synthesis-guide.md, verified in engine.js:
// the '4n' note gate, Sampler/Drums attack+release only, PluckSynth attack-only,
// FMSynth's slow default modulator.
test('the guide states how instruments and notes really behave', () => {
  const text = composerVocabularyText()
  assert.match(text, /noteLength is how long each ordinary stop note is held[^\n]*4n = 1 beat[^\n]*1n = 4 beats/)
  assert.match(text, /The default is 4n whatever the grid, speed or loop window/)
  assert.match(text, /noteLength does nothing with legato, drone, an enabled arp/)
  assert.match(text, /sustain 0 with a short decay/)
  assert.match(text, /Only envelope\.attack and envelope\.release act/)
  assert.match(text, /modulator attack 0\.5 s/)
  assert.match(text, /PluckSynth: a plucked-string model[^\n]*It ignores envelope, note length and velocity/)
  assert.match(text, /MonoSynth: [^\n]*baseFrequency × 2\^octaves/)
  assert.match(text, /mix ADDS grains/)
  assert.match(text, /once per stop, not per arp note/)
  assert.match(text, /Every type below is in the DAW's instrument picker/)
  assert.doesNotMatch(text, /cannot reselect/)
})

test('the guide documents tone with the real waveform list and per-instrument support', () => {
  const text = composerVocabularyText()
  assert.ok(text.includes(`tone.oscillator ∈ {${OSC_TYPES.join(', ')}}`))
  assert.match(text, /tone\.modulationIndex 0\.\.40 \(FM brightness\) for FMSynth;/)
})

test('prompts carry the policy, one selected recipe, and the current song only in edit mode', () => {
  const routes = [{ id: 'R1', name: 'M1', type: 'metro', stops: [{}, {}] }]
  const recipe = selectRecipe('some dub techno please')
  const fresh = buildSystemPrompt(routes, { cityName: 'Budapest', recipe, mode: 'new', currentSong: { bpm: 90 } })
  assert.match(fresh, /MUSICAL POLICY/)
  assert.match(fresh, /REQUEST MODE: NEW COMPOSITION/)
  assert.match(fresh, /GENRE RECIPE — Dub techno/)
  assert.doesNotMatch(fresh, /GENRE RECIPE — House/)
  assert.doesNotMatch(fresh, /CURRENT SONG \(/, 'a new idea ignores the current song')

  const edit = buildSystemPrompt(routes, { recipe: null, mode: 'edit', currentSong: { bpm: 90 } })
  assert.match(edit, /REQUEST MODE: EDIT THE CURRENT SONG/)
  assert.match(edit, /CURRENT SONG \(what is playing now[^\n]*\n\{"bpm":90\}/)
  assert.doesNotMatch(edit, /GENRE RECIPE/)
})

test('the MCP guide explains both modes and includes a recipe only when asked', () => {
  const plain = buildComposerGuide({ cityName: 'Budapest' })
  assert.match(plain, /NEW COMPOSITION/)
  assert.match(plain, /EDIT THE CURRENT SONG/)
  assert.doesNotMatch(plain, /GENRE RECIPE/)
  assert.match(buildComposerGuide({ recipe: selectRecipe('', 'ambient') }), /GENRE RECIPE — Ambient/)
})
