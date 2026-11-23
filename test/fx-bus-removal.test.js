import test from 'node:test'
import assert from 'node:assert/strict'
import { fxBusRemovalPlan, clearFxBusSends } from '../lib/fxBusRemoval.js'

test('bus removal clears transit, duplicate, drum and stale sends, including colon route ids', () => {
  const matrix = { 'line:42:delay': .4, 'old:delay': .8, '__drums__:delay': .5, 'line:42:reverb': .3, 'old:delay2': .9 }
  const plan = fxBusRemovalPlan('delay', [{ id: 'line:42' }, { id: 'copy' }], matrix)
  assert.deepEqual(new Set(plan.routeIds), new Set(['__drums__', 'line:42', 'copy', 'old']))
  const next = clearFxBusSends(matrix, 'delay', plan.routeIds)
  assert.equal(next['__drums__:delay'], 0)
  assert.equal(next['copy:delay'], 0)
  assert.equal(next['old:delay'], 0)
  assert.equal(next['line:42:delay'], 0)
  assert.equal(next['line:42:reverb'], .3)
  assert.equal(next['old:delay2'], .9)
  assert.equal(matrix['old:delay'], .8, 'does not mutate saved state')
})
test('removed-send automation is invalidated without dropping unrelated inactive targets', () => {
  const cfg = { a: { removed: { paramTarget: 'send.delay' }, retained: { paramTarget: 'send.reverb' }, inactive: { paramTarget: 'filter.drive' } }, b: { kept: { paramTarget: 'pan' } } }
  const plan = fxBusRemovalPlan('delay', [], {}, cfg)
  assert.equal(plan.automationRoutes.length, 1)
  assert.equal(plan.automationRoutes[0].routeId, 'a')
  assert.deepEqual(plan.automationRoutes[0].validIds, new Set(['volume', 'send.reverb', 'filter.drive']))
  assert.equal(cfg.a.removed.paramTarget, 'send.delay')
})
test('drum-only and empty songs still clear the virtual drum send', () => {
  const plan = fxBusRemovalPlan('reverb', null, null, null)
  assert.deepEqual(plan.routeIds, ['__drums__'])
  assert.deepEqual(clearFxBusSends({}, 'reverb', plan.routeIds), { '__drums__:reverb': 0 })
  assert.deepEqual(plan.automationRoutes, [])
})
