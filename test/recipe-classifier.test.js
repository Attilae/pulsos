import test from 'node:test'
import assert from 'node:assert/strict'
import { RECIPE_IDS } from '../lib/ai/musicalPolicy.js'
import {
  NONE_OPTION, MAX_PROMPT_CHARS, DEFAULT_MIN_CONFIDENCE,
  recipeCriteria, buildRecipeRequest, interpretRecipeAnswer,
} from '../lib/ai/recipeClassifier.js'

const answer = (choice, confidence, extra = {}) => ({
  model: 'jev-1.13.0',
  answers: { recipe: { type: 'choice', choice, confidence, probabilities: { [choice]: 0.9 }, ...extra } },
})

test('every recipe is an option, plus none, within Jev\'s 255-option cap', () => {
  const keys = Object.keys(recipeCriteria())
  assert.deepEqual(keys, [...RECIPE_IDS, NONE_OPTION])
  assert.ok(keys.length <= 255)
})

test('request is a single choice question over a truncated prompt', () => {
  const body = buildRecipeRequest('x'.repeat(MAX_PROMPT_CHARS + 50))
  assert.equal(body.model, 'jev-latest')
  assert.equal(body.state.composer_request.length, MAX_PROMPT_CHARS)
  assert.equal(body.questions.recipe.type, 'choice')
  assert.deepEqual(Object.keys(body.questions.recipe.criteria), [...RECIPE_IDS, NONE_OPTION])
  assert.equal(buildRecipeRequest(undefined).state.composer_request, '')
})

test('a confident known recipe is accepted', () => {
  const r = interpretRecipeAnswer(answer('ambient', 0.8))
  assert.equal(r.recipeId, 'ambient')
  assert.equal(r.confidence, 0.8)
})

test('low confidence, none, and unknown ids are rejected but still reported', () => {
  assert.equal(interpretRecipeAnswer(answer('ambient', DEFAULT_MIN_CONFIDENCE - 0.01)).recipeId, null)
  assert.equal(interpretRecipeAnswer(answer('ambient', 0.3), { minConfidence: 0.2 }).recipeId, 'ambient')
  const none = interpretRecipeAnswer(answer(NONE_OPTION, 0.99))
  assert.equal(none.recipeId, null)
  assert.equal(none.confidence, 0.99)
  assert.equal(interpretRecipeAnswer(answer('polka', 0.99)).recipeId, null)
})

test('malformed responses degrade to no recipe', () => {
  for (const bad of [null, {}, { answers: {} }, { answers: { recipe: { type: 'noul', noul: 1 } } }, answer('house', undefined)]) {
    assert.equal(interpretRecipeAnswer(bad).recipeId, null)
  }
})
