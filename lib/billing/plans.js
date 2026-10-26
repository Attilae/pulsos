import { snapshotBaseRouteIds } from '../songLanes.js'

export const FREE_LIMITS = Object.freeze({
  activeLanes: 6,
  compositionItems: 3,
  exports: 3,
  ai: 3,
  // Custom sampler samples and reverb impulse responses are Pro-only.
  customUploads: false,
})

export const PRO_LIMITS = Object.freeze({
  activeLanes: null,
  compositionItems: null,
  exports: null,
  ai: 50,
  customUploads: true,
})

export const SUPERADMIN_LIMITS = Object.freeze({
  activeLanes: null,
  compositionItems: null,
  exports: null,
  ai: null,
  customUploads: true,
})

// Lemon Squeezy statuses and what each grants:
//   active, on_trial  → Pro (on_trial until its trial end plus the grace below)
//   past_due          → Pro while payment is retried, for PAYMENT_GRACE_MS past
//                       the renewal that failed, then Free even if the status
//                       never changes
//   cancelled         → Pro until the paid period's endsAt
//   unpaid, paused, expired → Free (retries exhausted / collection paused)
export const ACCESS_STATUSES = new Set(['on_trial', 'active', 'past_due', 'cancelled'])
export const PAYMENT_GRACE_MS = 14 * 86400e3

function timeOf(value) {
  if (!value) return null
  const t = new Date(value).getTime()
  return Number.isNaN(t) ? null : t
}

// Test-mode subscriptions (Lemon Squeezy test checkouts) only count when the
// deployment explicitly allows them (LEMONSQUEEZY_TEST_MODE=true, never in
// production), so a signed test event can't grant live Pro.
export function isSubscriptionEntitled(subscription, now = new Date(), { allowTestMode = false } = {}) {
  if (!subscription || !ACCESS_STATUSES.has(subscription.status)) return false
  if (subscription.testMode && !allowTestMode) return false
  const t = now.getTime()
  switch (subscription.status) {
    case 'active':
      return true
    case 'on_trial': {
      const trialEnd = timeOf(subscription.trialEndsAt)
      return trialEnd == null || t < trialEnd + PAYMENT_GRACE_MS
    }
    case 'past_due': {
      const due = timeOf(subscription.renewsAt) ?? timeOf(subscription.providerUpdatedAt)
      return due != null && t < due + PAYMENT_GRACE_MS
    }
    case 'cancelled': {
      const end = timeOf(subscription.endsAt)
      return end != null && t < end
    }
    default:
      return false
  }
}

export function isOverrideEntitled(override, now = new Date()) {
  if (!override || override.plan !== 'pro') return false
  return !override.expiresAt || new Date(override.expiresAt).getTime() > now.getTime()
}

export function resolveAccess({ role, override, subscription, allowTestMode = false }, now = new Date()) {
  if (role === 'superadmin') {
    return { plan: 'pro', accessSource: 'superadmin', limits: SUPERADMIN_LIMITS }
  }
  if (isOverrideEntitled(override, now)) {
    return { plan: 'pro', accessSource: 'override', limits: PRO_LIMITS }
  }
  if (isSubscriptionEntitled(subscription, now, { allowTestMode })) {
    return { plan: 'pro', accessSource: 'subscription', limits: PRO_LIMITS }
  }
  return { plan: 'free', accessSource: 'free', limits: FREE_LIMITS }
}

// Provider calls the AI Composer makes, counted whether or not they produce a
// plan. The `ai` allowance above is refunded when generation fails; this budget
// never is, so failed (but billed) generations can't be repeated for free.
// Free is lifetime, like its `ai` credits: two calls per credit plus slack.
const DAY_MS = 86400e3
export const AI_ATTEMPT_BUDGETS = Object.freeze({
  free:       Object.freeze({ limit: 12, windowMs: null }),
  pro:        Object.freeze({ limit: 40, windowMs: DAY_MS }),
  superadmin: Object.freeze({ limit: 200, windowMs: DAY_MS }),
})

export function aiAttemptBudget(accessSource) {
  if (accessSource === 'superadmin') return AI_ATTEMPT_BUDGETS.superadmin
  if (accessSource === 'override' || accessSource === 'subscription') return AI_ATTEMPT_BUDGETS.pro
  return AI_ATTEMPT_BUDGETS.free
}

export function usagePeriod(plan, metric, now = new Date()) {
  if (plan === 'pro' && metric === 'ai') {
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
  }
  return 'lifetime'
}

export function metricLimit(plan, metric) {
  const limits = plan === 'pro' ? PRO_LIMITS : FREE_LIMITS
  return metric === 'export' ? limits.exports : metric === 'ai' ? limits.ai : undefined
}

export function normalizeLaneAccess(routes, disabled = {}, limit = FREE_LIMITS.activeLanes) {
  if (limit == null) return { disabled: { ...disabled }, lockedIds: [] }
  let audible = 0
  const next = { ...disabled }
  const lockedIds = []
  for (const route of routes ?? []) {
    if (!route?.id || route.id === '__drums__' || next[route.id]) continue
    audible += 1
    if (audible > limit) {
      next[route.id] = true
      lockedIds.push(route.id)
    }
  }
  return { disabled: next, lockedIds }
}

export function countActiveLanes(routes, disabled = {}) {
  let count = 0
  for (const route of routes ?? []) {
    if (route?.id && route.id !== '__drums__' && !disabled[route.id]) count += 1
  }
  return count
}

// Preserve an oversized song verbatim while disabling only the lanes beyond a
// user's allowance. A saved manifest gives stable authored order; legacy songs
// fall back to visible base routes followed by synthetic lanes.
export function normalizeSnapshotLaneAccess(snapshot, routes, limit) {
  if (limit == null || !snapshot) return snapshot
  const wrapped = !!snapshot.state
  const raw = wrapped ? snapshot.state : snapshot
  const muted = { ...(raw.muted ?? {}) }
  const consumed = new Set((raw.merges ?? []).flatMap(merge => merge.sourceIds ?? []))
  const automationSources = new Set()
  for (const lanes of Object.values(raw.automationCfg ?? {})) {
    for (const lane of Object.values(lanes ?? {})) {
      if (lane?.sourceRouteId) automationSources.add(lane.sourceRouteId)
    }
  }
  const routeIds = new Set((routes ?? []).map(route => route.id))
  const savedBaseIds = snapshotBaseRouteIds(raw).filter(id => routeIds.has(id))
  const fallbackIds = [
    ...savedBaseIds.filter(id => !consumed.has(id) && !automationSources.has(id)),
    ...(raw.duplicates ?? []).map(duplicate => duplicate.id),
    ...(raw.merges ?? []).map(merge => merge.id),
  ]
  const order = (raw.laneManifest?.length ? raw.laneManifest.map(lane => lane.id) : fallbackIds)
    .filter(Boolean)
  let audible = 0
  for (const id of [...new Set(order)]) {
    if (muted[id]) continue
    audible += 1
    if (audible > limit) muted[id] = true
  }
  const normalized = { ...raw, muted }
  return wrapped ? { ...snapshot, state: normalized } : normalized
}
