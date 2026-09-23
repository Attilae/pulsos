import test from 'node:test'
import assert from 'node:assert/strict'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { createMcpHandler } from '@modelcontextprotocol/server'
import { createLeidMcpServer } from '../lib/server/mcpTools.js'

async function connectedClient(services) {
  const handler = createMcpHandler(() => createLeidMcpServer('user-1', services), { legacy: 'reject' })
  const client = new Client({ name: 'leid-test', version: '1.0.0' }, {
    versionNegotiation: { mode: { pin: '2026-07-28' } },
  })
  await client.connect(new StreamableHTTPClientTransport(new URL('http://test.local/mcp'), {
    fetch: (url, init) => handler.fetch(new Request(url, init)),
  }))
  return { client, handler }
}

test('modern MCP client sees only the scoped song tools and can read a song', async () => {
  const seen = []
  const { client, handler } = await connectedClient({
    getEntitlements: async (userId) => { seen.push(['entitlement', userId]); return { isPro: true } },
    cities: [{ id: 'budapest', name: 'Budapest' }],
    listSongs: async (userId) => { seen.push(['list', userId]); return [{ id: 'song-1', name: 'Set' }] },
    getSong: async (userId, id) => { seen.push(['get', userId, id]); return { id, name: 'Set', state: { bpm: 120 } } },
  })
  try {
    const tools = await client.listTools()
    assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [
      'apply_plan_to_song', 'create_song_from_plan', 'get_composer_guide', 'get_song',
      'list_cities', 'list_routes', 'list_songs', 'preview_song_plan', 'set_song_tempo',
    ])
    const read = await client.callTool({ name: 'get_song', arguments: { id: 'song-1' } })
    assert.equal(read.structuredContent.song.state.bpm, 120)
    assert.deepEqual(seen, [['entitlement', 'user-1'], ['get', 'user-1', 'song-1']])
  } finally {
    await client.close()
    await handler.close()
  }
})

test('MCP write reports a stale saved-song version and denies a downgraded account', async () => {
  let isPro = true
  let writes = 0
  const { client, handler } = await connectedClient({
    getEntitlements: async () => ({ isPro }),
    setSongTempo: async () => { writes += 1; return { error: 'conflict' } },
  })
  try {
    const args = { id: 'song-1', bpm: 128, expectedUpdatedAt: 1000 }
    const conflict = await client.callTool({ name: 'set_song_tempo', arguments: args })
    assert.equal(conflict.isError, true)
    assert.match(conflict.content[0].text, /changed since it was read/)
    assert.equal(writes, 1)

    isPro = false
    const denied = await client.callTool({ name: 'set_song_tempo', arguments: args })
    assert.equal(denied.isError, true)
    assert.match(denied.content[0].text, /Pro is required/)
    assert.equal(writes, 1)
  } finally {
    await client.close()
    await handler.close()
  }
})

// ── Composition tools ────────────────────────────────────────────────────────

const ROUTES = [
  { id: 'M1', name: 'M1', type: 'metro', stopCount: 11, meanDemand: 0.7 },
  { id: 'T4', name: '4', type: 'tram', stopCount: 30, meanDemand: 0.5, desc: 'Széll Kálmán tér / Újbuda' },
  { id: 'B9', name: '9', type: 'bus', stopCount: 20, meanDemand: 0.2 },
]
const KICK = [1, 0, 0, 0, 0.7, 0, 0, 0, 1, 0, 0, 0, 0.7, 0, 0, 0]
const PLAN = {
  summary: 'dub', bpm: 100, harmony: { root: 'A', scaleType: 'dorian' },
  tracks: [
    { routeId: 'M1', synthType: 'FMSynth', volume: -6, label: 'Bass',
      sidechain: { enabled: true, source: 'drums:kick', amountDb: -10, attack: 0.005, release: 0.2 } },
    { routeId: 'T4', synthType: 'Sampler', samplerPreset: 'not-a-preset' },
  ],
  drums: { enabled: true, patterns: [{ padId: 'kick', steps: KICK }] },
  fx: [{ busId: 'reverb', wet: 0.5, params: [], sends: [{ routeId: 'M1', level: 0.3 }] }],
}

function composeServices(overrides = {}) {
  const calls = { created: [], updated: [] }
  const services = {
    getEntitlements: async () => ({ isPro: true, limits: { activeLanes: null } }),
    cities: [{ id: 'budapest', name: 'Budapest' }],
    getRouteIndex: async (cityId) => cityId === 'budapest' ? ROUTES : null,
    searchRoutes: async (cityId, opts) => {
      const routes = ROUTES.filter(r => !opts.type || r.type === opts.type)
      return { routes: routes.slice(0, opts.limit), total: routes.length }
    },
    routeTypeCounts: async () => ({ metro: 1, tram: 1, bus: 1 }),
    newSongId: () => 'song_new',
    appUrl: 'https://leid.example',
    createSong: async (userId, body) => {
      calls.created.push({ userId, body })
      return { id: body.id, name: body.name, updatedAt: 5000 }
    },
    ...overrides,
  }
  return { services, calls }
}

test('composer guide carries the shared vocabulary and the lane limit', async () => {
  const { services } = composeServices({
    getEntitlements: async () => ({ isPro: true, limits: { activeLanes: 6 } }),
  })
  const { client, handler } = await connectedClient(services)
  try {
    const res = await client.callTool({ name: 'get_composer_guide', arguments: { cityId: 'budapest' } })
    assert.equal(res.structuredContent.maxTracks, 6)
    assert.match(res.structuredContent.guide, /Budapest/)
    assert.match(res.structuredContent.guide, /Choose at most 6 tracks/)
    assert.match(res.structuredContent.guide, /samplerPreset \(only when synthType="Sampler"\): piano/)
    assert.deepEqual(res.structuredContent.routeTypes, { metro: 1, tram: 1, bus: 1 })

    const unknown = await client.callTool({ name: 'get_composer_guide', arguments: { cityId: 'atlantis' } })
    assert.equal(unknown.isError, true)
  } finally {
    await client.close()
    await handler.close()
  }
})

test('list_routes filters by type', async () => {
  const { services } = composeServices()
  const { client, handler } = await connectedClient(services)
  try {
    const res = await client.callTool({ name: 'list_routes', arguments: { cityId: 'budapest', type: 'tram' } })
    assert.deepEqual(res.structuredContent.routes.map(r => r.id), ['T4'])
  } finally {
    await client.close()
    await handler.close()
  }
})

test('preview validates the plan, reports drops, and writes nothing', async () => {
  const { services, calls } = composeServices()
  const { client, handler } = await connectedClient(services)
  try {
    const res = await client.callTool({ name: 'preview_song_plan', arguments: { cityId: 'budapest', plan: PLAN } })
    assert.equal(res.isError, undefined)
    const out = res.structuredContent
    assert.equal(out.saved, false)
    assert.ok(out.dropped.some(d => /not-a-preset/.test(d)))
    assert.deepEqual(out.song.lanes.map(l => [l.routeId, l.synthType]), [['M1', 'FMSynth'], ['T4', 'Sampler']])
    assert.deepEqual(out.song.drums.pads, ['kick'])
    assert.equal(calls.created.length, 0)
  } finally {
    await client.close()
    await handler.close()
  }
})

test('create saves under the authenticated user and returns an open link', async () => {
  const { services, calls } = composeServices()
  const { client, handler } = await connectedClient(services)
  try {
    const res = await client.callTool({
      name: 'create_song_from_plan',
      arguments: { cityId: 'budapest', name: 'Dub in Budapest', plan: PLAN },
    })
    const out = res.structuredContent
    assert.equal(out.id, 'song_new')
    assert.equal(out.openUrl, 'https://leid.example/?song=song_new')
    assert.equal(calls.created.length, 1)
    const { userId, body } = calls.created[0]
    assert.equal(userId, 'user-1')
    assert.equal(body.state.cityId, 'budapest')
    assert.deepEqual(body.state.routeIds, ['M1', 'T4'])
    assert.equal(body.state.bpm, 100)
    assert.equal(body.state.muted.M1, false)
  } finally {
    await client.close()
    await handler.close()
  }
})

test('a plan whose routes all belong to another city is rejected before saving', async () => {
  const { services, calls } = composeServices()
  const { client, handler } = await connectedClient(services)
  try {
    const res = await client.callTool({
      name: 'create_song_from_plan',
      arguments: { cityId: 'budapest', name: 'x', plan: { tracks: [{ routeId: 'U2' }] } },
    })
    assert.equal(res.isError, true)
    assert.match(res.content[0].text, /no playable tracks/)
    assert.equal(calls.created.length, 0)
  } finally {
    await client.close()
    await handler.close()
  }
})

test('apply edits the stored song through the conflict-checked writer', async () => {
  let written = null
  const stored = {
    id: 'song-1', name: 'Set', cityId: 'budapest', updatedAt: 1000,
    state: { cityId: 'budapest', routeIds: ['B9'], laneManifest: [{ id: 'B9', kind: 'base' }], muted: { B9: false }, bpm: 90 },
  }
  const { services } = composeServices({
    updateSongState: async (userId, id, expectedUpdatedAt, transform) => {
      assert.equal(userId, 'user-1')
      if (expectedUpdatedAt !== stored.updatedAt) return { error: 'conflict' }
      const next = await transform(stored)
      if (next.error) return next
      written = next.state
      return { song: { ...stored, state: next.state, updatedAt: 2000 } }
    },
  })
  const { client, handler } = await connectedClient(services)
  try {
    const stale = await client.callTool({
      name: 'apply_plan_to_song', arguments: { id: 'song-1', expectedUpdatedAt: 999, plan: PLAN },
    })
    assert.equal(stale.isError, true)
    assert.match(stale.content[0].text, /changed since it was read/)
    assert.equal(written, null)

    const res = await client.callTool({
      name: 'apply_plan_to_song', arguments: { id: 'song-1', expectedUpdatedAt: 1000, plan: PLAN },
    })
    assert.equal(res.structuredContent.updatedAt, 2000)
    assert.deepEqual(res.structuredContent.addedRouteIds, ['M1', 'T4'])
    assert.deepEqual(written.routeIds, ['B9', 'M1', 'T4'])
    assert.equal(written.muted.B9, true)
  } finally {
    await client.close()
    await handler.close()
  }
})

test('composition tools deny a Free account before touching route data or songs', async () => {
  let touched = 0
  const { services, calls } = composeServices({
    getEntitlements: async () => ({ isPro: false, limits: { activeLanes: 6 } }),
    getRouteIndex: async () => { touched += 1; return ROUTES },
    searchRoutes: async () => { touched += 1; return { routes: [], total: 0 } },
  })
  const { client, handler } = await connectedClient(services)
  try {
    for (const [name, args] of [
      ['get_composer_guide', { cityId: 'budapest' }],
      ['list_routes', { cityId: 'budapest' }],
      ['preview_song_plan', { cityId: 'budapest', plan: PLAN }],
      ['create_song_from_plan', { cityId: 'budapest', name: 'x', plan: PLAN }],
      ['apply_plan_to_song', { id: 'song-1', expectedUpdatedAt: 1, plan: PLAN }],
    ]) {
      const res = await client.callTool({ name, arguments: args })
      assert.equal(res.isError, true, name)
      assert.match(res.content[0].text, /Pro is required/, name)
    }
    assert.equal(touched, 0)
    assert.equal(calls.created.length, 0)
  } finally {
    await client.close()
    await handler.close()
  }
})

test('compose_loop prompt walks the client through the tools', async () => {
  const { services } = composeServices()
  const { client, handler } = await connectedClient(services)
  try {
    const prompt = await client.getPrompt({ name: 'compose_loop', arguments: { cityId: 'budapest', request: 'slow dub' } })
    const text = prompt.messages[0].content.text
    for (const tool of ['get_composer_guide', 'list_routes', 'preview_song_plan', 'create_song_from_plan']) {
      assert.match(text, new RegExp(tool))
    }
  } finally {
    await client.close()
    await handler.close()
  }
})
