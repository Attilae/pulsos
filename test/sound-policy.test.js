import test from 'node:test'
import assert from 'node:assert/strict'
import { SOUND_RECIPES, SOUND_IDS, DEFAULT_SOUND_IDS, soundRecipeTrack, soundRecipesText } from '../lib/ai/soundPolicy.js'
import { GENRE_RECIPES, selectRecipe, soundContextText } from '../lib/ai/musicalPolicy.js'
import { validatePlan, buildSystemPrompt, buildComposerGuide } from '../lib/ai/planContract.js'
import { planAdvisories } from '../lib/ai/planAdvisories.js'
import { PICKER_SYNTH_TYPES } from '../lib/soundSpecs.js'

// The sound recipes are data the prompt hands the model as "use these settings",
// so every one must survive the real contract untouched (nothing dropped, nothing
// clamped) and raise no advisory at the tempo of any genre that points at it.

const routes = [{ id: 'L', type: 'metro' }]

test('sound recipe ids are unique and every genre points at existing, picker-only sounds', () => {
  assert.equal(new Set(SOUND_IDS).size, SOUND_RECIPES.length)
  for (const genre of GENRE_RECIPES) {
    assert.ok(genre.sounds?.length >= 3, `${genre.id} lists its sounds`)
    for (const id of genre.sounds) assert.ok(SOUND_IDS.includes(id), `${genre.id} → ${id}`)
  }
  for (const id of DEFAULT_SOUND_IDS) assert.ok(SOUND_IDS.includes(id))
  for (const r of SOUND_RECIPES) assert.ok(PICKER_SYNTH_TYPES.includes(r.synthType), `${r.id} uses a picker instrument`)
})

test('genre recipe texts only recommend picker instruments', () => {
  const hidden = /\b(MonoSynth|DuoSynth|AMSynth|PluckSynth|MetalSynth|MembraneSynth)\b/
  for (const genre of GENRE_RECIPES) {
    assert.doesNotMatch(genre.text, hidden, genre.id)
    if (genre.blueprint) assert.doesNotMatch(genre.blueprint, hidden, genre.id)
  }
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
