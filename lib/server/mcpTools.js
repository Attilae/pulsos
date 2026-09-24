import { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { CITIES } from '../shared/cities.js'
import { getSong, listSongs, setSongTempo, createSong, updateSongState, newServerSongId } from './presets.js'
import { getRouteIndex, searchRoutes, routeTypeCounts, ROUTE_TYPES } from './routeIndex.js'
import { buildComposerGuide, validatePlan } from '../ai/planContract.js'
import { PLAN_INPUT_SCHEMA } from '../ai/planSchema.js'
import { applyPlanToSnapshot, defaultSnapshot, describeSnapshot } from '../ai/planSnapshot.js'
import { withNewCompositionBaseline } from '../ai/planApply.js'
import { RECIPE_IDS, recipeCatalog, selectRecipe } from '../ai/musicalPolicy.js'

const result = (value) => ({
  content: [{ type: 'text', text: JSON.stringify(value) }],
  structuredContent: value,
})

const errorResult = (message) => ({
  content: [{ type: 'text', text: message }],
  isError: true,
})

const PRO_REQUIRED = 'Leið Pro is required'

const cityIdSchema = z.string().min(1).max(64)
const songIdSchema = z.string().min(1).max(128)

// Line type → role, the same convention the in-app composer is told. Repeated
// in tool descriptions because a client may pick routes before reading the guide.
const LINE_ROLES = 'metro → melodic lead/keys/bass, tram/trolley → rhythmic percussion, bus → pads/textures, hev (suburban rail) → low slow melodic voices'

export function createLeidMcpServer(userId, services = {}) {
  const server = new McpServer({ name: 'leid', version: '1.1.0' })
  const entitlementFor = services.getEntitlements ?? (async (id) => {
    const { getEntitlements } = await import('../billing/server.js')
    return getEntitlements(id)
  })
  const songsFor = services.listSongs ?? listSongs
  const songFor = services.getSong ?? getSong
  const tempoFor = services.setSongTempo ?? setSongTempo
  const createFor = services.createSong ?? createSong
  const updateFor = services.updateSongState ?? updateSongState
  const newSongId = services.newSongId ?? newServerSongId
  const routesFor = services.getRouteIndex ?? getRouteIndex
  const searchFor = services.searchRoutes ?? searchRoutes
  const typeCountsFor = services.routeTypeCounts ?? routeTypeCounts
  const cities = services.cities ?? CITIES
  const appUrl = services.appUrl ?? process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

  // Pro is re-resolved on every call, so a downgrade cuts access immediately.
  // Returns the entitlement (for its lane limit) or null when access is denied.
  const proAccess = async () => {
    const entitlement = await entitlementFor(userId)
    return entitlement?.isPro ? entitlement : null
  }
  const proRequired = async () => !!await proAccess()
  const cityById = (id) => cities.find(city => city.id === id) ?? null
  const laneLimitOf = (entitlement) => entitlement?.limits?.activeLanes ?? null
  const openUrlFor = (songId) => new URL(`/?song=${encodeURIComponent(songId)}`, appUrl).toString()

  // Validate a client-written plan against the city's real routes and apply it to
  // `base`. Never trusts the client: every id, enum and range goes through
  // validatePlan, which reports what it drops instead of failing the whole plan.
  // mode 'new' (a new song) fills the clean-lane baseline the guide promises;
  // 'edit' (an existing song) keeps everything the plan leaves out.
  const compose = async ({ cityId, base, plan, entitlement, mode }) => {
    const routes = await routesFor(cityId)
    if (!routes) return { error: `No route data for city "${cityId}"` }
    const limit = laneLimitOf(entitlement)
    const { plan: validated, dropped } = validatePlan(plan, routes, { activeLaneLimit: limit ?? Infinity })
    if (!validated.tracks.length) {
      return { error: `The plan has no playable tracks after validation. Dropped: ${dropped.join('; ') || 'nothing'}. Use routeIds from list_routes for "${cityId}".` }
    }
    const toApply = mode === 'new' ? withNewCompositionBaseline(validated) : validated
    const applied = applyPlanToSnapshot(base, toApply, { activeLaneLimit: limit })
    return {
      snapshot: applied.snapshot,
      report: {
        summary: validated.summary ?? null,
        dropped,
        skippedRouteIds: applied.skippedIds,
        addedRouteIds: applied.addedRouteIds,
        song: describeSnapshot(applied.snapshot, routes),
      },
    }
  }

  server.registerTool('list_cities', {
    description: 'List the cities available for Leið songs.',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true },
  }, async () => {
    if (!await proRequired()) return errorResult(PRO_REQUIRED)
    return result({ cities: cities.map(({ id, name }) => ({ id, name })) })
  })

  server.registerTool('list_songs', {
    description: 'List your saved Leið songs, newest first.',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true },
  }, async () => {
    if (!await proRequired()) return errorResult(PRO_REQUIRED)
    return result({ songs: await songsFor(userId, { limit: 100 }) })
  })

  server.registerTool('get_song', {
    description: 'Read one of your saved Leið songs, including its snapshot. "current" summarizes what its audible lanes play (sound, register, timing, gating, sends, drums, FX) — preserve what the user did not ask to change when you write an edit plan.',
    inputSchema: z.object({ id: songIdSchema }),
    annotations: { readOnlyHint: true },
  }, async ({ id }) => {
    if (!await proRequired()) return errorResult(PRO_REQUIRED)
    const song = await songFor(userId, id)
    if (!song) return errorResult('Song not found')
    const encoded = JSON.stringify(song)
    if (encoded.length > 200_000) return errorResult('Song is too large for this MCP tool')
    const routes = song.cityId && song.state ? await routesFor(song.cityId) : null
    const current = song.state ? describeSnapshot(song.state, routes ?? [], { detail: true }) : null
    return result({ song, current })
  })

  server.registerTool('set_song_tempo', {
    description: 'Set the BPM of one of your saved songs. Supply the updatedAt value from get_song to avoid overwriting a newer edit.',
    inputSchema: z.object({
      id: songIdSchema,
      bpm: z.number().int().min(40).max(240),
      expectedUpdatedAt: z.number().int().nonnegative(),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, async ({ id, bpm, expectedUpdatedAt }) => {
    if (!await proRequired()) return errorResult(PRO_REQUIRED)
    const saved = await tempoFor(userId, id, bpm, expectedUpdatedAt)
    if (saved.error === 'not_found') return errorResult('Song not found')
    if (saved.error === 'conflict') return errorResult('Song changed since it was read; fetch it again')
    return result({ id, bpm, updatedAt: saved.song.updatedAt })
  })

  // ── Composition ────────────────────────────────────────────────────────────
  // The connected client is the model: these tools hand it the same vocabulary
  // the in-app AI Composer's system prompt carries, let it pick from the city's
  // real lines, and turn the plan it writes into a saved song. No LLM is called
  // server-side, so none of this draws on the in-app AI allowance.

  server.registerTool('get_composer_guide', {
    description: `Start here to compose music. Returns the musical policy, the full vocabulary (instruments, sampler presets, drum pads, FX buses and params, scales, ranges) and an example plan for writing a Leið loop plan in a city, plus your lane limit and the genre recipes available. Pass genre (one of ${RECIPE_IDS.join(', ')}) to include that recipe's tempo, roles, drum seed and effects. Then pick lines with list_routes, check the plan with preview_song_plan, and save it with create_song_from_plan or apply_plan_to_song.`,
    inputSchema: z.object({ cityId: cityIdSchema, genre: z.enum(RECIPE_IDS).optional() }),
    annotations: { readOnlyHint: true },
  }, async ({ cityId, genre }) => {
    const entitlement = await proAccess()
    if (!entitlement) return errorResult(PRO_REQUIRED)
    const city = cityById(cityId)
    if (!city) return errorResult(`Unknown city "${cityId}"; see list_cities`)
    const maxTracks = laneLimitOf(entitlement) ?? 12
    return result({
      cityId,
      cityName: city.name,
      maxTracks,
      routeTypes: await typeCountsFor(cityId),
      genre: genre ?? null,
      recipes: recipeCatalog(),
      guide: buildComposerGuide({ cityName: city.name, maxTracks, recipe: genre ? selectRecipe('', genre) : null }),
    })
  })

  server.registerTool('list_routes', {
    description: `Find transit lines in a city to use as tracks. Each result's id is the routeId a plan needs. Filter by type (${ROUTE_TYPES.join(', ')}) or search by line name/terminus. Convention: ${LINE_ROLES}. stopCount hints note density; meanDemand (0..1) is how busy the line's stops are.`,
    inputSchema: z.object({
      cityId: cityIdSchema,
      type: z.enum(ROUTE_TYPES).optional(),
      query: z.string().max(80).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    }),
    annotations: { readOnlyHint: true },
  }, async ({ cityId, type, query, limit }) => {
    if (!await proRequired()) return errorResult(PRO_REQUIRED)
    if (!cityById(cityId)) return errorResult(`Unknown city "${cityId}"; see list_cities`)
    const found = await searchFor(cityId, { type, query, limit: limit ?? 40 })
    if (!found) return errorResult(`No route data for city "${cityId}"`)
    return result({ cityId, total: found.total, routes: found.routes })
  })

  server.registerTool('preview_song_plan', {
    description: 'Check a loop plan without saving anything. Validates every route id, instrument, range and FX setting (see get_composer_guide), then reports what was dropped and summarizes the resulting song. Without songId it previews a new song (every planned lane starts from the clean baseline, and no drums block means no drums); pass songId to preview an edit of an existing song, which keeps whatever the plan leaves out.',
    inputSchema: z.object({
      cityId: cityIdSchema.optional(),
      songId: songIdSchema.optional(),
      plan: PLAN_INPUT_SCHEMA,
    }),
    annotations: { readOnlyHint: true },
  }, async ({ cityId, songId, plan }) => {
    const entitlement = await proAccess()
    if (!entitlement) return errorResult(PRO_REQUIRED)
    let base
    if (songId) {
      const song = await songFor(userId, songId)
      if (!song) return errorResult('Song not found')
      if (!song.cityId) return errorResult('This song predates city tracking; open it in Leið once to update it')
      if (cityId && cityId !== song.cityId) return errorResult(`This song belongs to "${song.cityId}", not "${cityId}"`)
      cityId = song.cityId
      base = song.state
    } else {
      if (!cityId) return errorResult('Pass cityId (new song) or songId (edit)')
      if (!cityById(cityId)) return errorResult(`Unknown city "${cityId}"; see list_cities`)
      base = defaultSnapshot(cityId)
    }
    const composed = await compose({ cityId, base, plan, entitlement, mode: songId ? 'edit' : 'new' })
    if (composed.error) return errorResult(composed.error)
    return result({ cityId, saved: false, ...composed.report })
  })

  server.registerTool('create_song_from_plan', {
    description: 'Save a loop plan as a new song in your Leið library. Every planned lane starts from the clean baseline (no arp, granular, drone, sidechain, chance or rest pattern unless the plan sets them; no drums block means no drums). The result includes openUrl, which opens the song in the Leið DAW; press Play there to hear it. This does not change a song that is already open in a browser tab.',
    inputSchema: z.object({
      cityId: cityIdSchema,
      name: z.string().trim().min(1).max(120),
      plan: PLAN_INPUT_SCHEMA,
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, async ({ cityId, name, plan }) => {
    const entitlement = await proAccess()
    if (!entitlement) return errorResult(PRO_REQUIRED)
    if (!cityById(cityId)) return errorResult(`Unknown city "${cityId}"; see list_cities`)
    const composed = await compose({ cityId, base: defaultSnapshot(cityId), plan, entitlement, mode: 'new' })
    if (composed.error) return errorResult(composed.error)
    const song = await createFor(userId, {
      id: newSongId(),
      name,
      schemaVersion: composed.snapshot.schemaVersion,
      state: composed.snapshot,
    })
    return result({
      id: song.id, name: song.name, cityId, updatedAt: song.updatedAt,
      openUrl: openUrlFor(song.id), saved: true, ...composed.report,
    })
  })

  server.registerTool('apply_plan_to_song', {
    description: 'Apply a loop plan to one of your saved songs. The plan\'s tracks become the song\'s audible lanes (other lanes are disabled, not deleted, and keep their settings); lines the song lacks are added. Supply updatedAt from get_song or list_songs as expectedUpdatedAt; the write fails rather than overwrite a newer edit.',
    inputSchema: z.object({
      id: songIdSchema,
      expectedUpdatedAt: z.number().int().nonnegative(),
      plan: PLAN_INPUT_SCHEMA,
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, async ({ id, expectedUpdatedAt, plan }) => {
    const entitlement = await proAccess()
    if (!entitlement) return errorResult(PRO_REQUIRED)
    let report = null
    const saved = await updateFor(userId, id, expectedUpdatedAt, async (song) => {
      if (!song.cityId) return { error: 'no_city' }
      const composed = await compose({ cityId: song.cityId, base: song.state, plan, entitlement, mode: 'edit' })
      if (composed.error) return { error: 'invalid_plan', message: composed.error }
      report = composed.report
      return { state: composed.snapshot }
    })
    if (saved.error === 'not_found') return errorResult('Song not found')
    if (saved.error === 'conflict') return errorResult('Song changed since it was read; fetch it again')
    if (saved.error === 'no_city') return errorResult('This song predates city tracking; open it in Leið once to update it')
    if (saved.error === 'invalid_plan') return errorResult(saved.message)
    return result({
      id, name: saved.song.name, cityId: saved.song.cityId, updatedAt: saved.song.updatedAt,
      openUrl: openUrlFor(id), saved: true, ...report,
    })
  })

  server.registerPrompt('compose_loop', {
    title: 'Compose a Leið loop',
    description: 'Turn a musical idea into a saved Leið song built from a city\'s transit lines.',
    argsSchema: z.object({
      cityId: z.string().describe('City id from list_cities, e.g. budapest'),
      request: z.string().describe('What the loop should sound like'),
    }),
  }, ({ cityId, request }) => ({
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: `Compose a Leið loop in city "${cityId}": ${request}

1. Call get_composer_guide for "${cityId}" — pass the genre from its recipes list that fits the request, if any — and follow its musical policy, vocabulary and ranges exactly.
2. Use list_routes to choose lines that suit each role (${LINE_ROLES}).
3. Call preview_song_plan with your plan, fix anything it reports as dropped, and preview again until nothing that matters is dropped.
4. Save it with create_song_from_plan, then give me the openUrl.

To change a saved song instead, read it with get_song (its "current" summary is what to preserve), preview with its songId, and save with apply_plan_to_song using its updatedAt as expectedUpdatedAt; if that reports a conflict, read the song again rather than retrying.`,
      },
    }],
  }))

  return server
}
