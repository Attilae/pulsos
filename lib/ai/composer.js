// AI Composer (in-app) — sends a natural-language prompt to POST /api/compose,
// which returns a structured "plan" that maps 1:1 onto the existing MixerTab
// handlers (tempo, harmony, per-track instruments, FX buses + sends). The
// vocabulary, prompt and validator live in ./planContract.js, which the MCP
// server shares; they are re-exported here for existing callers.

import { buildSystemPrompt } from './planContract.js'
import { selectRecipe } from './musicalPolicy.js'

export {
  SYNTH_TYPES, TRACK_SPEEDS, GRID_RESOLUTIONS, PITCH_CONTOURS, GRID_TOTAL_CELLS, FILTER_TYPES,
  buildSystemPrompt, validatePlan,
} from './planContract.js'
export { GENRE_RECIPES, selectRecipe } from './musicalPolicy.js'

// Same-origin Next route handler (keeps the OpenRouter key server-side).
const COMPOSE_URL = '/api/compose'

/**
 * @param {string} userPrompt
 * @param {object[]} routes  the loaded lanes the model may use
 * @param {object} [options] { cityName, maxTracks, recipeId (chip override, null = auto),
 *   mode ('new' | 'edit'), currentSong (describeSnapshot detail, edit mode) }
 * @returns {Promise<{ raw: object, recipe: object|null }>} the model's plan and the
 *   genre recipe it was given (a selectRecipe() result), for the panel to show
 */
export async function requestComposition(userPrompt, routes, options = {}) {
  const recipe = selectRecipe(userPrompt, options.recipeId)
  const messages = [
    { role: 'system', content: buildSystemPrompt(routes, { ...options, recipe }) },
    { role: 'user',   content: userPrompt },
  ]

  const res = await fetch(COMPOSE_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ messages }),
  })

  if (!res.ok) {
    let payload = null
    try { payload = await res.json() } catch { /* ignore */ }
    const error = new Error(payload?.error || `Composer request failed (${res.status})`)
    error.code = payload?.code
    error.status = res.status
    throw error
  }
  return { raw: await res.json(), recipe }
}
