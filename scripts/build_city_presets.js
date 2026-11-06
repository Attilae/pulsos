// Generate bundled defaults through the real MCP protocol and composition tools.
// Storage is redirected to files: this never writes to an account or database.
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { createMcpHandler } from '@modelcontextprotocol/server'
import { createLeidMcpServer } from '../lib/server/mcpTools.js'

const handler = createMcpHandler(() => createLeidMcpServer('bundled-defaults', {
  getEntitlements: async () => ({ isPro: true, limits: { activeLanes: 6 } }),
  newSongId: () => 'city-default',
  createSong: async (_user, body) => {
    await mkdir(new URL('../public/presets/', import.meta.url), { recursive: true })
    const output = { name: body.name, cityId: body.state.cityId, state: body.state }
    await writeFile(new URL(`../public/presets/${body.state.cityId}.json`, import.meta.url), JSON.stringify(output, null, 2) + '\n')
    return { ...body, updatedAt: 0 }
  },
}), { legacy: 'stateless' })
const client = new Client({ name: 'leid-default-builder', version: '1.0.0' }, {
  versionNegotiation: { mode: { pin: '2026-07-28' } },
})
const call = async (name, args = {}) => {
  const result = await client.callTool({ name, arguments: args })
  if (result.isError) throw new Error(result.content[0].text)
  return result.structuredContent
}
try {
  await client.connect(new StreamableHTTPClientTransport(new URL('http://local.defaults/mcp'), {
    fetch: (url, init) => handler.fetch(new Request(url, init)),
  }))
  const cities = (await call('list_cities')).cities
  const inspect = process.argv.includes('--inspect')
  for (const city of cities) {
    const guide = await call('get_composer_guide', { cityId: city.id })
    const routes = (await call('list_routes', { cityId: city.id, limit: 100 })).routes
    if (inspect) {
      await writeFile(`${process.env.TMPDIR || "/tmp"}/leid-guide-${city.id}.json`, JSON.stringify(guide, null, 2))
      console.log(city.id, JSON.stringify(routes.filter(r => r.stopCount >= 8 && r.stopCount <= 24).slice(0, 12)))
      continue
    }
    const plans = JSON.parse(await readFile(new URL('../lib/shared/cityPresetPlans.json', import.meta.url)))
    const { name, plan } = plans[city.id]
    const preview = await call('preview_song_plan', { cityId: city.id, plan })
    if (preview.dropped.length || preview.advisories.length || preview.skippedRouteIds.length) {
      throw new Error(`${city.id}: ${JSON.stringify(preview)}`)
    }
    await call('create_song_from_plan', { cityId: city.id, name, plan })
    console.log(`${city.name}: ${name}, ${plan.bpm} BPM, ${plan.tracks.length} lanes`)
  }
} finally {
  await client.close()
  await handler.close()
}
