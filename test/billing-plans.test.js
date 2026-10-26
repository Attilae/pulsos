import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AI_ATTEMPT_BUDGETS,
  FREE_LIMITS,
  PAYMENT_GRACE_MS,
  aiAttemptBudget,
  SUPERADMIN_LIMITS,
  countActiveLanes,
  isOverrideEntitled,
  isSubscriptionEntitled,
  metricLimit,
  normalizeLaneAccess,
  normalizeSnapshotLaneAccess,
  resolveAccess,
  usagePeriod,
} from '../lib/billing/plans.js'

test('subscription access follows provider status and cancellation end date', () => {
  const now = new Date('2026-07-21T12:00:00Z')
  for (const status of ['on_trial', 'active']) {
    assert.equal(isSubscriptionEntitled({ status }, now), true, status)
  }
  for (const status of ['paused', 'unpaid', 'expired']) {
    assert.equal(isSubscriptionEntitled({ status, renewsAt: '2026-07-20T00:00:00Z' }, now), false, status)
  }
  assert.equal(isSubscriptionEntitled({ status: 'cancelled' }, now), false)
  assert.equal(isSubscriptionEntitled({ status: 'cancelled', endsAt: '2026-07-22T00:00:00Z' }, now), true)
  assert.equal(isSubscriptionEntitled({ status: 'cancelled', endsAt: '2026-07-20T00:00:00Z' }, now), false)
})

test('past_due keeps Pro only through a finite grace after the failed renewal', () => {
  const renewsAt = '2026-07-01T00:00:00Z'
  const due = new Date(renewsAt).getTime()
  const sub = { status: 'past_due', renewsAt }
  assert.equal(isSubscriptionEntitled(sub, new Date(due + PAYMENT_GRACE_MS - 1)), true)
  assert.equal(isSubscriptionEntitled(sub, new Date(due + PAYMENT_GRACE_MS)), false)
  assert.equal(isSubscriptionEntitled(sub, new Date('2026-10-21T00:00:00Z')), false)
  // No dates at all can't grant open-ended access.
  assert.equal(isSubscriptionEntitled({ status: 'past_due' }, new Date(due)), false)
  // Falls back to the provider update time when renewsAt is missing.
  assert.equal(isSubscriptionEntitled({ status: 'past_due', providerUpdatedAt: renewsAt }, new Date(due + 1)), true)
  // Recovery: the provider flips the status back to active.
  assert.equal(isSubscriptionEntitled({ ...sub, status: 'active' }, new Date('2026-10-21T00:00:00Z')), true)
})

test('the audit reproduction no longer grants Pro for stale unpaid/past_due/paused records', () => {
  const now = new Date('2026-10-21T00:00:00Z')
  for (const status of ['unpaid', 'past_due', 'paused']) {
    const subscription = { status, endsAt: '2000-01-01T00:00:00Z', renewsAt: '2000-01-01T00:00:00Z' }
    assert.equal(resolveAccess({ subscription }, now).plan, 'free', status)
  }
})

test('trials end after their trial date plus grace', () => {
  const trialEndsAt = '2026-07-01T00:00:00Z'
  const end = new Date(trialEndsAt).getTime()
  assert.equal(isSubscriptionEntitled({ status: 'on_trial', trialEndsAt }, new Date(end)), true)
  assert.equal(isSubscriptionEntitled({ status: 'on_trial', trialEndsAt }, new Date(end + PAYMENT_GRACE_MS)), false)
})

test('test-mode subscriptions only entitle when the deployment allows them', () => {
  const now = new Date('2026-07-21T12:00:00Z')
  const subscription = { status: 'active', testMode: true }
  assert.equal(isSubscriptionEntitled(subscription, now), false)
  assert.equal(isSubscriptionEntitled(subscription, now, { allowTestMode: true }), true)
  assert.equal(resolveAccess({ subscription }, now).plan, 'free')
  assert.equal(resolveAccess({ subscription, allowTestMode: true }, now).plan, 'pro')
  // Overrides are unaffected.
  assert.equal(resolveAccess({ subscription, override: { plan: 'pro' } }, now).plan, 'pro')
})

test('AI attempt budgets are finite for every access source', () => {
  for (const source of ['free', 'subscription', 'override', 'superadmin', undefined]) {
    const budget = aiAttemptBudget(source)
    assert.ok(Number.isInteger(budget.limit) && budget.limit > 0, String(source))
  }
  assert.equal(aiAttemptBudget('free'), AI_ATTEMPT_BUDGETS.free)
  assert.equal(AI_ATTEMPT_BUDGETS.free.windowMs, null)
  // Two provider calls per success credit always fit, with slack.
  assert.ok(AI_ATTEMPT_BUDGETS.free.limit >= FREE_LIMITS.ai * 2)
  assert.equal(aiAttemptBudget('subscription'), AI_ATTEMPT_BUDGETS.pro)
})

test('access resolution prioritizes superadmins, then overrides, then subscriptions', () => {
  const now = new Date('2026-07-21T12:00:00Z')
  const subscription = { status: 'active' }
  const activeOverride = { plan: 'pro', expiresAt: '2026-08-01T00:00:00Z' }

  assert.equal(isOverrideEntitled(activeOverride, now), true)
  assert.equal(isOverrideEntitled({ ...activeOverride, expiresAt: '2026-07-01T00:00:00Z' }, now), false)
  assert.deepEqual(
    resolveAccess({ role: 'superadmin', override: activeOverride, subscription }, now),
    { plan: 'pro', accessSource: 'superadmin', limits: SUPERADMIN_LIMITS },
  )
  assert.equal(resolveAccess({ role: 'user', override: activeOverride, subscription }, now).accessSource, 'override')
  assert.equal(resolveAccess({ role: 'user', subscription }, now).accessSource, 'subscription')
  assert.equal(resolveAccess({ role: 'user' }, now).accessSource, 'free')
})

test('free lane normalization counts instruments but never the drum pseudo-route', () => {
  const routes = [
    { id: 'a' }, { id: '__drums__' }, { id: 'b' }, { id: 'c' }, { id: 'd' },
    { id: 'e' }, { id: 'f' }, { id: 'g' },
  ]
  const result = normalizeLaneAccess(routes, {}, FREE_LIMITS.activeLanes)
  assert.deepEqual(result.lockedIds, ['g'])
  assert.equal(result.disabled.g, true)
  assert.equal(countActiveLanes(routes, result.disabled), 6)
})

test('snapshot downgrade follows the saved manifest and preserves configuration', () => {
  const snapshot = {
    state: {
      muted: { lane3: true },
      laneManifest: ['lane1', 'lane2', 'lane3', 'lane4', 'lane5', 'lane6'].map(id => ({ id })),
      trackScales: { lane6: { root: 'D', scaleType: 'dorian' } },
    },
  }
  const result = normalizeSnapshotLaneAccess(snapshot, [], 3)
  assert.equal(result.state.muted.lane3, true)
  assert.equal(result.state.muted.lane5, true)
  assert.equal(result.state.muted.lane6, true)
  assert.deepEqual(result.state.trackScales, snapshot.state.trackScales)
  assert.equal(snapshot.state.muted.lane5, undefined, 'source snapshot is not mutated')
})

test('usage periods and limits distinguish lifetime Free credits from monthly Pro AI', () => {
  const now = new Date('2026-07-21T12:00:00Z')
  assert.equal(usagePeriod('free', 'ai', now), 'lifetime')
  assert.equal(usagePeriod('pro', 'ai', now), '2026-07')
  assert.equal(metricLimit('free', 'export'), 3)
  assert.equal(metricLimit('pro', 'export'), null)
  assert.equal(metricLimit('pro', 'ai'), 50)
})

test('custom sample and IR uploads are Pro-only', () => {
  assert.equal(resolveAccess({}).limits.customUploads, false)
  assert.equal(resolveAccess({ override: { plan: 'pro' } }).limits.customUploads, true)
  assert.equal(resolveAccess({ subscription: { status: 'active' } }).limits.customUploads, true)
  assert.equal(resolveAccess({ role: 'superadmin' }).limits.customUploads, true)
})

test('legacy snapshot normalization only considers base lanes present in saved state', () => {
  const routes = ['picked1', 'picked2', 'picked3', 'unpicked1', 'unpicked2'].map(id => ({ id }))
  const snapshot = { muted: { picked1: false, picked2: false, picked3: false } }
  const result = normalizeSnapshotLaneAccess(snapshot, routes, 2)
  assert.equal(result.muted.picked3, true)
  assert.equal(result.muted.unpicked1, undefined)
})

test('snapshot normalization falls back to routeIds order when no manifest was saved', () => {
  const routes = ['a', 'b', 'c', 'd'].map(id => ({ id }))
  // routeIds carries the authored order; `muted` key order must not decide which
  // lanes survive the cap.
  const snapshot = {
    routeIds: ['c', 'a', 'b'],
    muted: { a: false, b: false, c: false },
  }
  const result = normalizeSnapshotLaneAccess(snapshot, routes, 2)
  assert.equal(result.muted.c, false, 'first authored lane stays audible')
  assert.equal(result.muted.a, false, 'second authored lane stays audible')
  assert.equal(result.muted.b, true, 'the lane past the cap is disabled')
})
