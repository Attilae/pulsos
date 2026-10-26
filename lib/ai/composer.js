// AI Composer (in-app) — sends a natural-language prompt to POST /api/compose,
// which returns a structured "plan" that maps 1:1 onto the existing MixerTab
// handlers (tempo, harmony, per-track instruments, FX buses + sends). The
// vocabulary, prompt and validator live in ./planContract.js, which the MCP
// server shares; they are re-exported here for existing callers.

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
 * @param {object} [options] { cityId, recipeId (chip override, null = auto),
 *   mode ('new' | 'edit'), currentSong (describeSnapshot detail, edit mode) }.
 *   The server builds the prompt from these; the lane cap comes from the plan.
 * @returns {Promise<{ raw: object, recipe: object|null }>} the model's plan and the
 *   genre recipe it was given (a selectRecipe() result), for the panel to show
 */
export async function requestComposition(userPrompt, routes, options = {}) {
  // Shown by the panel; the server picks the same recipe for the prompt it
  // builds (selectRecipe is deterministic).
  const recipe = selectRecipe(userPrompt, options.recipeId)
  const body = {
    prompt: userPrompt,
    cityId: options.cityId,
    routes: (routes ?? []).map(r => ({
      id: r.id,
      name: r.name ?? r.shortName ?? r.id,
      type: r.type,
      stopCount: r.stops?.length ?? 0,
    })),
    recipeId: options.recipeId ?? null,
    mode: options.mode,
    currentSong: options.mode === 'edit' ? options.currentSong ?? null : null,
  }

  const res = await fetch(COMPOSE_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
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
