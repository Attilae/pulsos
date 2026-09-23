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
      'get_song', 'list_cities', 'list_songs', 'set_song_tempo',
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
