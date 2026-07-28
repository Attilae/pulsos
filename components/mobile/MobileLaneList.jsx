// The phone's lane view: every route grouped by line type, one strip each.
// Grouping uses the SECTIONS list exported by DawView so both views agree on
// order and labels.
'use client'

import { SECTIONS } from '../DawView.jsx'
import MobileLaneStrip from './MobileLaneStrip.jsx'

export default function MobileLaneList({
  routes,
  disabled,
  soloRoutes,
  volumes,
  lockedIds,
  mergedConsumedIds,
  onDisable,
  onSolo,
  onVolume,
  onOpenLane,
}) {
  const consumed = mergedConsumedIds ?? new Set()
  const anySoloed = (soloRoutes?.size ?? 0) > 0

  const byType = {}
  for (const s of SECTIONS) {
    byType[s.type] = (routes ?? []).filter(r => r.type === s.type && !consumed.has(r.id))
  }

  const total = Object.values(byType).reduce((n, list) => n + list.length, 0)
  if (!total) {
    return <p className="mlanes-empty">No lines loaded for this city yet.</p>
  }

  return (
    <div className="mlanes">
      {SECTIONS.map(({ type, label }) => byType[type].length > 0 && (
        <section className="mlanes-section" key={type}>
          <h3 className="mlanes-heading">{label}</h3>
          <ul className="mlanes-list">
            {byType[type].map(route => (
              <MobileLaneStrip
                key={route.id}
                route={route}
                disabled={!!disabled?.[route.id]}
                soloed={!!soloRoutes?.has(route.id)}
                anySoloed={anySoloed}
                volume={volumes?.[route.id] ?? 0}
                locked={!!lockedIds?.has(route.id)}
                onDisable={onDisable}
                onSolo={onSolo}
                onVolume={onVolume}
                onOpen={onOpenLane}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
