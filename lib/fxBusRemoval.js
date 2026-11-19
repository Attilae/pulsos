import { DRUMS_ROUTE_ID } from './soundSpecs.js'

// A removed bus must lose sends from transit, drums and any stale saved keys.
// Automation uses the existing invalid-target fallback; unrelated inactive
// targets (another filter/Texture model) are deliberately retained.
export function fxBusRemovalPlan(busId, routes = [], sendMatrix = {}, automationCfg = {}) {
  const suffix = `:${busId}`
  const routeIds = new Set([DRUMS_ROUTE_ID, ...(routes ?? []).map(r => r.id)])
  for (const key of Object.keys(sendMatrix ?? {})) {
    if (key.endsWith(suffix)) routeIds.add(key.slice(0, -suffix.length))
  }
  const automationRoutes = []
  const removedTarget = `send.${busId}`
  for (const [routeId, lanes] of Object.entries(automationCfg ?? {})) {
    const configs = Object.values(lanes ?? {})
    if (!configs.some(cfg => cfg?.paramTarget === removedTarget)) continue
    const validIds = new Set(['volume'])
    for (const cfg of configs) if (cfg?.paramTarget && cfg.paramTarget !== removedTarget) validIds.add(cfg.paramTarget)
    automationRoutes.push({ routeId, validIds })
  }
  return { routeIds: [...routeIds], automationRoutes }
}

export function clearFxBusSends(matrix, busId, routeIds) {
  const next = { ...matrix }
  const suffix = `:${busId}`
  for (const key of Object.keys(next)) if (key.endsWith(suffix)) next[key] = 0
  for (const routeId of routeIds) next[`${routeId}:${busId}`] = 0
  return next
}
