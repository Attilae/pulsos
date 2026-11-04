import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { CITIES } from '../lib/shared/cities.js'
import { getRouteIndex } from '../lib/server/routeIndex.js'
import { validatePlan } from '../lib/ai/planContract.js'
import { planAdvisories } from '../lib/ai/planAdvisories.js'
import { withNewCompositionBaseline } from '../lib/ai/planApply.js'
import { applyPlanToSnapshot, defaultSnapshot } from '../lib/ai/planSnapshot.js'

const readJson = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'))
const plans = await readJson('../lib/shared/cityPresetPlans.json')
for (const city of CITIES) {
  test(`${city.id} bundled preset matches its validated MCP plan and current client routes`, async () => {
    const preset = await readJson(`../public/presets/${city.id}.json`)
    const { plan: raw, name } = plans[city.id]
    const { plan, dropped } = validatePlan(raw, await getRouteIndex(city.id), { activeLaneLimit: 6 })
    assert.deepEqual(dropped, [])
    assert.deepEqual(planAdvisories(plan, { mode: 'new' }), [])
    const expected = applyPlanToSnapshot(defaultSnapshot(city.id), withNewCompositionBaseline(plan), { activeLaneLimit: 6 })
    assert.deepEqual(preset, { name, cityId: city.id, state: expected.snapshot })
    assert.deepEqual(expected.skippedIds, [])
    const lines = await readJson(`../public/data/lines.${city.id}.slim.json`)
    const ids = new Set(lines.routes.map(route => route.id))
    for (const id of preset.state.routeIds) assert.ok(ids.has(id), `Missing client route ${id}`)
  })
}
