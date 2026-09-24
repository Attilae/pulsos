import test from 'node:test'
import assert from 'node:assert/strict'
import { SOUND_RECIPES, SOUND_IDS, DEFAULT_SOUND_IDS, soundRecipeTrack, soundRecipesText } from '../lib/ai/soundPolicy.js'
import { GENRE_RECIPES, selectRecipe, soundContextText } from '../lib/ai/musicalPolicy.js'
import { validatePlan, buildSystemPrompt, buildComposerGuide } from '../lib/ai/planContract.js'
import { planAdvisories } from '../lib/ai/planAdvisories.js'
import { SYNTH_TYPES, SYNTH_DEFAULTS } from '../lib/soundSpecs.js'

// The sound recipes are data the prompt hands the model as "use these settings",
// so every one must survive the real contract untouched (nothing dropped, nothing
// clamped) and raise no advisory at the tempo of any genre that points at it.

const routes = [{ id: 'L', type: 'metro' }]

test('sound recipe ids are unique and every genre points at existing sounds', () => {
  assert.equal(new Set(SOUND_IDS).size, SOUND_RECIPES.length)
  for (const genre of GENRE_RECIPES) {
    assert.ok(genre.sounds?.length >= 3, `${genre.id} lists its sounds`)
    for (const id of genre.sounds) assert.ok(SOUND_IDS.includes(id), `${genre.id} → ${id}`)
  }
  for (const id of DEFAULT_SOUND_IDS) assert.ok(SOUND_IDS.includes(id))
  for (const r of SOUND_RECIPES) assert.ok(SYNTH_TYPES.includes(r.synthType), `${r.id} uses a real instrument`)
})

// The picker (DawView/LaneSheet), the plan vocabulary and the engine all read
// SYNTH_TYPES; an instrument missing from it can't be reselected once a plan or
// song sets it, and one missing from SYNTH_DEFAULTS has no params to build from.
test('the instrument picker lists exactly the instruments the engine can build', () => {
  assert.deepEqual([...SYNTH_TYPES].sort(), Object.keys(SYNTH_DEFAULTS).sort())
  assert.equal(new Set(SYNTH_TYPES).size, SYNTH_TYPES.length)
})

test('every sound recipe validates untouched through validatePlan', () => {
  for (const r of SOUND_RECIPES) {
    const track = soundRecipeTrack(r, 'L')
    const { plan, dropped } = validatePlan({ tracks: [track] }, routes)
    assert.deepEqual(dropped, [], r.id)
    const out = plan.tracks[0]
    for (const key of ['synthType', 'samplerPreset', 'drumVoice', 'envelope', 'tone', 'filter', 'octave', 'granular']) {
      assert.deepEqual(out[key], track[key], `${r.id}.${key} is not clamped or dropped`)
    }
  }
})

test('no sound recipe raises an advisory at the tempo of a genre that uses it', () => {
  for (const genre of GENRE_RECIPES) {
    for (const id of genre.sounds) {
      const r = SOUND_RECIPES.find(s => s.id === id)
      const { plan } = validatePlan({ bpm: genre.bpm.max, tracks: [soundRecipeTrack(r, 'L')] }, routes)
      assert.deepEqual(planAdvisories(plan), [], `${genre.id} → ${id}`)
    }
  }
})

test('prompts carry only the selected genre\'s sounds; the MCP guide without a genre carries them all', () => {
  const lanes = [{ id: 'L', name: 'L', type: 'metro', stops: [{}] }]
  const house = buildSystemPrompt(lanes, { recipe: selectRecipe('a warm house groove') })
  for (const id of SOUND_IDS) {
    const line = new RegExp(`^- ${id} `, 'm')
    assert.equal(line.test(house), GENRE_RECIPES.find(g => g.id === 'house').sounds.includes(id), `house prompt and ${id}`)
  }
  assert.match(house, /BEAT BLUEPRINT — Warm house beat/)

  const plain = buildSystemPrompt(lanes, {})
  for (const id of SOUND_IDS) assert.equal(new RegExp(`^- ${id} `, 'm').test(plain), DEFAULT_SOUND_IDS.includes(id), `default palette and ${id}`)

  const guide = buildComposerGuide({})
  for (const id of SOUND_IDS) assert.match(guide, new RegExp(`^- ${id} `, 'm'))
  assert.equal(soundContextText(null, { all: true }), soundRecipesText())
})

test('the sound policy is part of every prompt', () => {
  const lanes = [{ id: 'L', name: 'L', type: 'metro', stops: [{}] }]
  assert.match(buildSystemPrompt(lanes, {}), /SOUND DESIGN \(compose the notes and the sound together/)
  assert.match(buildComposerGuide({}), /SOUND DESIGN/)
})

// Regression: the grain source used to label the nearest zone as C4, detuning
// eight presets (casio by 17 semitones). The zone's real name must travel with it.
test('the granular source zone keeps its real note name', async () => {
  const { granularSourceZone, SAMPLER_PRESETS } = await import('../lib/soundSpecs.js')
  assert.deepEqual(granularSourceZone('Sampler', { samplerPreset: 'bass-electric' }),
    { url: SAMPLER_PRESETS['bass-electric'].baseUrl + 'Cs4.mp3', note: 'C#4' })
  assert.equal(granularSourceZone('Sampler', { samplerPreset: 'casio' }).note, 'G2')
  assert.equal(granularSourceZone('Sampler', { samplerPreset: 'piano' }).note, 'C4')
  assert.equal(granularSourceZone('Sampler', { samplerPreset: 'nope' }).note, 'C4', 'unknown preset falls back to piano')
  assert.equal(granularSourceZone('Drums', { drumVoice: 'kick' }).note, 'C4', 'a one-shot has no pitch of its own')
  for (const [id, preset] of Object.entries(SAMPLER_PRESETS)) {
    const zone = granularSourceZone('Sampler', { samplerPreset: id })
    assert.ok(zone.note in preset.urls && zone.url === preset.baseUrl + preset.urls[zone.note], id)
  }
})
