// POST /api/compose's request contract. The client sends structured fields
// (prompt, city, loaded lanes, recipe, mode, current song), never a finished
// prompt: the server checks each field and builds the system prompt itself, so
// the endpoint can't be used as a general-purpose proxy for the app's key.
// Pure, tested in test/compose-request.test.js.

import { buildSystemPrompt } from './planContract.js'
import { RECIPE_IDS, selectRecipe } from './musicalPolicy.js'
import { checkJsonBounds } from '../storageLimits.js'

export const COMPOSE_MAX_BODY_BYTES = 256 * 1024
export const COMPOSE_MAX_PROMPT_CHARS = 4_000
export const COMPOSE_MAX_ROUTES = 64
export const COMPOSE_ROUTE_TYPES = ['metro', 'tram', 'trolley', 'bus', 'hev']
const ROUTE_ID_RE = /^[\w.:~-]{1,128}$/
const ROUTE_NAME_MAX = 80
const MAX_STOPS = 2_000
const MAX_TRACKS_DEFAULT = 8

// describeSnapshot(…, { detail: true }) of a large song is tens of KB.
const CURRENT_SONG_LIMITS = Object.freeze({
  maxBytes: 128 * 1024,
  maxDepth: 10,
  maxArrayLength: 1_000,
  maxStringLength: 1_000,
  maxKeys: 500,
})

// Names land inside the prompt between quotes; keep them to one short line.
function cleanName(name) {
  if (typeof name !== 'string') return null
  const text = name.replace(/[\u0000-\u001f"\\]/g, ' ').replace(/\s+/g, ' ').trim()
  return text ? text.slice(0, ROUTE_NAME_MAX) : null
}

/**
 * @param {object} body  { prompt, cityId, routes: [{ id, name, type, stopCount }],
 *   recipeId, mode: 'new' | 'edit', currentSong }
 * @param {string[]} cityIds  the registered city ids
 */
export function validateComposeRequest(body, cityIds) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'invalid request' }
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
  if (!prompt) return { ok: false, error: 'prompt required' }
  if (prompt.length > COMPOSE_MAX_PROMPT_CHARS) {
    return { ok: false, error: `prompt is limited to ${COMPOSE_MAX_PROMPT_CHARS} characters` }
  }
  if (typeof body.cityId !== 'string' || !cityIds.includes(body.cityId)) {
    return { ok: false, error: 'unknown city' }
  }
  if (!Array.isArray(body.routes) || body.routes.length === 0) return { ok: false, error: 'routes required' }
  if (body.routes.length > COMPOSE_MAX_ROUTES) return { ok: false, error: 'too many routes' }

  const routes = []
  const seen = new Set()
  for (const route of body.routes) {
    if (!route || typeof route.id !== 'string' || !ROUTE_ID_RE.test(route.id)) {
      return { ok: false, error: 'invalid route id' }
    }
    if (seen.has(route.id)) continue
    seen.add(route.id)
    const stopCount = Number.isInteger(route.stopCount) && route.stopCount >= 0 && route.stopCount <= MAX_STOPS
      ? route.stopCount : null
    routes.push({
      id: route.id,
      name: cleanName(route.name),
      type: COMPOSE_ROUTE_TYPES.includes(route.type) ? route.type : null,
      stopCount,
    })
  }

  const recipeId = body.recipeId == null ? null : body.recipeId
  if (recipeId !== null && !RECIPE_IDS.includes(recipeId)) return { ok: false, error: 'unknown recipe' }
  const mode = body.mode === 'edit' ? 'edit' : 'new'

  let currentSong = null
  if (mode === 'edit' && body.currentSong != null) {
    if (typeof body.currentSong !== 'object' || Array.isArray(body.currentSong)) {
      return { ok: false, error: 'invalid current song' }
    }
    const checked = checkJsonBounds(body.currentSong, CURRENT_SONG_LIMITS)
    if (!checked.ok) return { ok: false, error: `current song ${checked.error}` }
    currentSong = body.currentSong
  }

  return { ok: true, request: { prompt, cityId: body.cityId, routes, recipeId, mode, currentSong } }
}

/**
 * Builds the [system, user] messages. Lanes the city's route index knows take
 * their name, type and stop count from it; a lane it doesn't know (a stale
 * index after a preprocess) keeps the cleaned client fields.
 * @param {object} request  validateComposeRequest().request
 * @param {{ cityName?: string, routeIndex?: object[]|null, activeLaneLimit?: number|null }} ctx
 */
export function buildComposeMessages(request, { cityName, routeIndex = null, activeLaneLimit = null } = {}) {
  const indexed = new Map((routeIndex ?? []).map(route => [route.id, route]))
  const routes = request.routes.map(route => {
    const known = indexed.get(route.id)
    return {
      id: route.id,
      name: known?.name ?? route.name ?? route.id,
      type: known?.type ?? route.type ?? 'bus',
      stopCount: known?.stopCount ?? route.stopCount,
    }
  })
  const maxTracks = Math.min(routes.length, activeLaneLimit ?? MAX_TRACKS_DEFAULT)
  const recipe = selectRecipe(request.prompt, request.recipeId)
  const system = buildSystemPrompt(routes, {
    cityName, maxTracks, recipe, mode: request.mode, currentSong: request.currentSong,
  })
  return [
    { role: 'system', content: system },
    { role: 'user', content: request.prompt },
  ]
}
