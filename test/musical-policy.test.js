import test from 'node:test'
import assert from 'node:assert/strict'
import { GENRE_RECIPES, RECIPE_IDS, selectRecipe, recipeContextText, recipeCatalog, musicalPolicyText } from '../lib/ai/musicalPolicy.js'
import { buildSystemPrompt, RANGES } from '../lib/ai/planContract.js'

const pick = (prompt, override) => {
  const s = selectRecipe(prompt, override)
  return s && [s.recipe.id, s.secondary?.id ?? null]
}

test('more specific styles win over their generic parents', () => {
  assert.deepEqual(pick('a warm deep house groove'), ['deep-house', null])
  assert.deepEqual(pick('dub techno, lots of echo'), ['dub-techno', null])
  assert.deepEqual(pick('melodic techno at night'), ['melodic-techno', null])
  assert.deepEqual(pick('just some techno'), ['hypnotic-techno', null], 'bare techno → the hypnotic branch')
  assert.deepEqual(pick('House music'), ['house', null], 'case-insensitive')
})

test('aliases match whole words only', () => {
  assert.equal(selectRecipe('a warehouse party'), null, '"warehouse" is not "house"')
  assert.deepEqual(pick('2-step garage'), ['ukg', null])
  assert.deepEqual(pick('drum & bass'), ['dnb', null])
})

test('hybrids: a style named just before another modifies it; otherwise the first is primary', () => {
  assert.deepEqual(pick('ambient techno'), ['hypnotic-techno', 'ambient'])
  assert.deepEqual(pick('lo-fi house'), ['house', 'lofi'])
  assert.deepEqual(pick('techno with ambient pads'), ['hypnotic-techno', 'ambient'])
  assert.match(recipeContextText(selectRecipe('ambient techno')), /HYBRID: keep the Techno groove/)
})

test('an explicit override always wins; unknown overrides fall back to detection', () => {
  assert.deepEqual(pick('hard techno', 'deep-house'), ['deep-house', null])
  assert.equal(selectRecipe('hard techno', 'deep-house').source, 'override')
  assert.deepEqual(pick('hard techno', 'polka'), ['hypnotic-techno', null])
})

test('no recognizable style → no recipe, and the prompt carries policy only', () => {
  assert.equal(selectRecipe('something calm for the morning commute'), null)
  assert.equal(selectRecipe(''), null)
  assert.equal(recipeContextText(null), '')
})

test('every recipe is well formed', () => {
  assert.equal(new Set(RECIPE_IDS).size, GENRE_RECIPES.length, 'unique ids')
  for (const r of GENRE_RECIPES) {
    assert.ok(r.bpm.min <= r.bpm.default && r.bpm.default <= r.bpm.max, `${r.id} default in range`)
    assert.ok(r.bpm.min >= RANGES.bpm[0] && r.bpm.max <= RANGES.bpm[1], `${r.id} inside the plan's bpm range`)
    assert.ok(r.text.length > 100 && r.borrow.length > 10, `${r.id} has text and a borrow trait`)
    for (const alias of r.aliases) assert.equal(alias, alias.toLowerCase(), `${r.id} alias "${alias}" lowercase`)
  }
  assert.deepEqual(recipeCatalog().map(r => r.id), RECIPE_IDS)
})

test('a prompt carries one recipe, never the whole catalogue', () => {
  const routes = [{ id: 'R1', type: 'metro' }]
  const one = buildSystemPrompt(routes, { recipe: selectRecipe('trance') })
  const none = buildSystemPrompt(routes, {})
  const everyRecipe = GENRE_RECIPES.map(r => recipeContextText({ recipe: r })).join('\n\n')
  assert.ok(one.length - none.length < everyRecipe.length / 4)
  const mentioned = GENRE_RECIPES.filter(r => one.includes(`GENRE RECIPE — ${r.label} `))
  assert.deepEqual(mentioned.map(r => r.id), ['trance'])
})

test('policy text differs by mode, and "both" carries each mode once', () => {
  assert.match(musicalPolicyText('new'), /NEW COMPOSITION/)
  assert.doesNotMatch(musicalPolicyText('new'), /EDIT THE CURRENT SONG/)
  assert.match(musicalPolicyText('edit'), /EDIT THE CURRENT SONG/)
  const both = musicalPolicyText('both')
  assert.equal(both.match(/REQUEST MODE:/g).length, 2)
})
