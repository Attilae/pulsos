import { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { CITIES } from '../shared/cities.js'
import { getSong, listSongs, setSongTempo } from './presets.js'

const result = (value) => ({
  content: [{ type: 'text', text: JSON.stringify(value) }],
  structuredContent: value,
})

const errorResult = (message) => ({
  content: [{ type: 'text', text: message }],
  isError: true,
})

export function createLeidMcpServer(userId, services = {}) {
  const server = new McpServer({ name: 'leid', version: '1.0.0' })
  const entitlementFor = services.getEntitlements ?? (async (id) => {
    const { getEntitlements } = await import('../billing/server.js')
    return getEntitlements(id)
  })
  const songsFor = services.listSongs ?? listSongs
  const songFor = services.getSong ?? getSong
  const tempoFor = services.setSongTempo ?? setSongTempo
  const cities = services.cities ?? CITIES
  const proRequired = async () => (await entitlementFor(userId)).isPro

  server.registerTool('list_cities', {
    description: 'List the cities available for Leið songs.',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true },
  }, async () => {
    if (!await proRequired()) return errorResult('Leið Pro is required')
    return result({ cities: cities.map(({ id, name }) => ({ id, name })) })
  })

  server.registerTool('list_songs', {
    description: 'List your saved Leið songs, newest first.',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true },
  }, async () => {
    if (!await proRequired()) return errorResult('Leið Pro is required')
    return result({ songs: await songsFor(userId, { limit: 100 }) })
  })

  server.registerTool('get_song', {
    description: 'Read one of your saved Leið songs, including its snapshot.',
    inputSchema: z.object({ id: z.string().min(1).max(128) }),
    annotations: { readOnlyHint: true },
  }, async ({ id }) => {
    if (!await proRequired()) return errorResult('Leið Pro is required')
    const song = await songFor(userId, id)
    if (!song) return errorResult('Song not found')
    const encoded = JSON.stringify(song)
    if (encoded.length > 200_000) return errorResult('Song is too large for this MCP tool')
    return result({ song })
  })

  server.registerTool('set_song_tempo', {
    description: 'Set the BPM of one of your saved songs. Supply the updatedAt value from get_song to avoid overwriting a newer edit.',
    inputSchema: z.object({
      id: z.string().min(1).max(128),
      bpm: z.number().int().min(40).max(240),
      expectedUpdatedAt: z.number().int().nonnegative(),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, async ({ id, bpm, expectedUpdatedAt }) => {
    if (!await proRequired()) return errorResult('Leið Pro is required')
    const saved = await tempoFor(userId, id, bpm, expectedUpdatedAt)
    if (saved.error === 'not_found') return errorResult('Song not found')
    if (saved.error === 'conflict') return errorResult('Song changed since it was read; fetch it again')
    return result({ id, bpm, updatedAt: saved.song.updatedAt })
  })

  return server
}
