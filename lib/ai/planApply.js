// Pure replacement-selection helper shared by the AI apply path and tests.
// The plan order is authoritative; unknown/duplicate/excess ids are skipped.
export function buildReplacementLaneState(routes, requestedIds, currentDisabled = {}, limit = null) {
  const available = new Set((routes ?? []).map(route => route?.id).filter(Boolean))
  const activeIds = []
  const skippedIds = []
  const seen = new Set()

  for (const id of requestedIds ?? []) {
    if (!available.has(id) || seen.has(id)) {
      skippedIds.push(id)
      continue
    }
    seen.add(id)
    if (limit != null && activeIds.length >= limit) {
      skippedIds.push(id)
      continue
    }
    activeIds.push(id)
  }

  const active = new Set(activeIds)
  const disabled = { ...currentDisabled }
  for (const route of routes ?? []) {
    if (route?.id) disabled[route.id] = !active.has(route.id)
  }

  return { activeIds, disabled, skippedIds }
}
