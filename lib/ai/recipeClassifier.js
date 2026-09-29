// Genre-recipe inference through TypeSafe's Jev (a "System One" decision model:
// typed Choice in, calibrated probabilities out — it never writes text). A
// prototype behind JEV_RECIPE_ENABLED: selectRecipe's keyword matching stays
// primary, and Jev is only asked when no alias matched and no chip was chosen —
// "something for a rainy night drive" names no style, but still implies one.
//
// Pure (no fetch, no env), so the request/answer shaping is testable and the
// route handler only owns I/O. Imported server-side only.

import { GENRE_RECIPES, recipeById } from './musicalPolicy.js'

export const JEV_ENDPOINT = 'https://api.typesafe.ai/v1/systemone'
export const JEV_MODEL = 'jev-latest'
export const NONE_OPTION = 'none'
// Choice confidence is (n·peak − 1)/(n − 1) over the 12 options, so 0.5 needs
// the winner to hold roughly 54% of the probability. A starting point to tune
// against real prompts, not a measured optimum.
export const DEFAULT_MIN_CONFIDENCE = 0.5
// Longer than any sane user prompt; Jev bills input tokens, so cap what we send.
export const MAX_PROMPT_CHARS = 1000

/** The Choice criteria: one option per recipe id, plus an explicit way out. */
export function recipeCriteria() {
  const criteria = {}
  for (const r of GENRE_RECIPES) {
    criteria[r.id] = {
      style: r.label,
      also_called: r.aliases,
      tempo_bpm: `${r.bpm.min}–${r.bpm.max}`,
      character: r.borrow,
    }
  }
  criteria[NONE_OPTION] = 'No style or mood that clearly points at one of the other options, or not a music request at all.'
  return criteria
}

/** The full POST body for a composer prompt. */
export function buildRecipeRequest(prompt) {
  return {
    state: { composer_request: String(prompt ?? '').slice(0, MAX_PROMPT_CHARS) },
    model: JEV_MODEL,
    questions: {
      recipe: {
        type: 'choice',
        instructions: 'A user asked a music app to compose a short electronic loop (`composer_request`). Which style best fits the music they describe, including one implied only by a mood, place, activity or reference artist?',
        criteria: recipeCriteria(),
      },
    },
  }
}

/**
 * Turn Jev's response into a recipe decision. Anything malformed, low-confidence
 * or `none` yields `recipeId: null`, which callers treat exactly like the
 * keyword matcher finding nothing.
 * @returns {{ recipeId: string|null, confidence: number|null, probabilities: object|null }}
 */
export function interpretRecipeAnswer(response, { minConfidence = DEFAULT_MIN_CONFIDENCE } = {}) {
  const answer = response?.answers?.recipe
  if (answer?.type !== 'choice' || typeof answer.choice !== 'string') {
    return { recipeId: null, confidence: null, probabilities: null }
  }
  const confidence = Number.isFinite(answer.confidence) ? answer.confidence : null
  const probabilities = answer.probabilities && typeof answer.probabilities === 'object' ? answer.probabilities : null
  const accepted = answer.choice !== NONE_OPTION
    && recipeById(answer.choice) != null
    && confidence != null
    && confidence >= minConfidence
  return { recipeId: accepted ? answer.choice : null, confidence, probabilities }
}
