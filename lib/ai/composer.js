// AI Composer (in-app) — sends a natural-language prompt to POST /api/compose,
// which returns a structured "plan" that maps 1:1 onto the existing MixerTab
// handlers (tempo, harmony, per-track instruments, FX buses + sends). The
// vocabulary, prompt and validator live in ./planContract.js, which the MCP
// server shares; they are re-exported here for existing callers.

import { buildSystemPrompt } from './planContract.js'

export {
  SYNTH_TYPES, TRACK_SPEEDS, GRID_RESOLUTIONS, PITCH_CONTOURS, GRID_TOTAL_CELLS, FILTER_TYPES,
  buildSystemPrompt, validatePlan,
} from './planContract.js'

// Same-origin Next route handler (keeps the OpenRouter key server-side).
const COMPOSE_URL = '/api/compose'

export async function requestComposition(userPrompt, routes, options = {}) {
  const messages = [
    { role: 'system', content: buildSystemPrompt(routes, options) },
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
  return res.json()
}
