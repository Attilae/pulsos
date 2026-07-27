import { snapshotBaseRouteIds } from '../songLanes.js'

export const FREE_LIMITS = Object.freeze({
  activeLanes: 4,
  compositionItems: 3,
  exports: 3,
  ai: 3,
})

export const PRO_LIMITS = Object.freeze({
  activeLanes: null,
  compositionItems: null,
  exports: null,
  ai: 50,
})

export const SUPERADMIN_LIMITS = Object.freeze({
  activeLanes: null,
  compositionItems: null,
  exports: null,
  ai: null,
})

export const ACCESS_STATUSES = new Set([
  'on_trial', 'active', 'paused', 'past_due', 'unpaid', 'cancelled',
])

export function isSubscriptionEntitled(subscription, now = new Date()) {
  if (!subscription || !ACCESS_STATUSES.has(subscription.status)) return false
  if (subscription.status === 'cancelled') {
    return !!subscription.endsAt && new Date(subscription.endsAt).getTime() > now.getTime()
  }
  return true
}

export function isOverrideEntitled(override, now = new Date()) {
  if (!override || override.plan !== 'pro') return false
  return !override.expiresAt || new Date(override.expiresAt).getTime() > now.getTime()
}

export function resolveAccess({ role, override, subscription }, now = new Date()) {
  if (role === 'superadmin') {
    return { plan: 'pro', accessSource: 'superadmin', limits: SUPERADMIN_LIMITS }
  }
  if (isOverrideEntitled(override, now)) {
    return { plan: 'pro', accessSource: 'override', limits: PRO_LIMITS }
  }
  if (isSubscriptionEntitled(subscription, now)) {
    return { plan: 'pro', accessSource: 'subscription', limits: PRO_LIMITS }
  }
  return { plan: 'free', accessSource: 'free', limits: FREE_LIMITS }
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
