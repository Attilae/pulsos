import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { getRouteIndex, searchRoutes, routeTypeCounts } from '../lib/server/routeIndex.js'

// Everything the MCP server imports must stay free of browser/audio code — the
// plan contract used to live in lib/ai/composer.js, which pulls in Tone.js via
// the engine and React via DawView. Load the whole MCP module graph in a child
// process whose resolver throws on any of them, so a stray import fails here
// rather than in the server bundle.
const FORBIDDEN = ['tone', 'weq8', 'react', 'react-dom', 'leaflet']

test('the MCP tool module graph never imports Tone, React or other browser code', () => {
  const hook = `
    const forbidden = new Set(${JSON.stringify(FORBIDDEN)});
    export async function resolve(spec, ctx, next) {
      const bare = spec.split('/')[0];
      if (forbidden.has(bare) || spec.endsWith('.jsx') || spec.endsWith('.css')) {
        throw new Error('forbidden import in server graph: ' + spec + ' (from ' + ctx.parentURL + ')');
      }
      return next(spec, ctx);
    }`
  const register = `import { register } from 'node:module'; register('data:text/javascript,' + encodeURIComponent(${JSON.stringify(hook)}));`
  const modules = [
    './lib/server/mcpTools.js', './lib/ai/planContract.js', './lib/ai/planSchema.js',
    './lib/ai/planSnapshot.js', './lib/server/routeIndex.js',
  ]
  const run = spawnSync(process.execPath, [
    '--import', `data:text/javascript,${encodeURIComponent(register)}`,
    '--input-type=module',
    '-e', modules.map(m => `await import(${JSON.stringify(m)});`).join(''),
  ], { cwd: process.cwd(), encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
})

test('route index loads every registered city with composable rows', async () => {
  for (const cityId of ['budapest', 'helsinki', 'berlin', 'prague', 'newyork', 'zurich', 'warsaw']) {
    const routes = await getRouteIndex(cityId)
    assert.ok(routes.length > 0, cityId)
    for (const route of routes) {
      assert.equal(typeof route.id, 'string')
      assert.ok(['metro', 'tram', 'trolley', 'bus', 'hev'].includes(route.type), `${cityId} ${route.id} ${route.type}`)
    }
  }
  assert.equal(await getRouteIndex('atlantis'), null)
})

test('route search ranks exact names first, folds accents, and filters by type', async () => {
  const exact = await searchRoutes('budapest', { query: 'm1' })
  assert.equal(exact.routes[0].name, 'M1')

  const metro = await searchRoutes('budapest', { type: 'metro', limit: 2 })
  assert.equal(metro.routes.length, 2)
  assert.ok(metro.total >= 4)
  assert.ok(metro.routes.every(route => route.type === 'metro'))

  // Terminus search without diacritics ("Vorosmarty" for "Vörösmarty tér").
  const terminus = await searchRoutes('budapest', { query: 'vorosmarty' })
  assert.ok(terminus.routes.some(route => route.name === 'M1'))

  const counts = await routeTypeCounts('budapest')
  assert.equal(counts.metro, 4)
})
