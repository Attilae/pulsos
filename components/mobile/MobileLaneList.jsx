// The phone's lane view uses the same sections and action handlers as DawView.
'use client'

import { SECTIONS } from '../DawView.jsx'
import SnapshotBar from '../SnapshotBar.jsx'
import MobileLaneStrip from './MobileLaneStrip.jsx'

export default function MobileLaneList({
  routes, disabled, soloRoutes, volumes, lockedIds, labels, mergedConsumedIds,
  onDisable, onSolo, onVolume, onOpenLane,
  mode, started, liveSnapshot, snapshotLoading, onRefetch, onAddLine, onRepickType,
}) {
  const consumed = mergedConsumedIds ?? new Set()
  const anySoloed = (soloRoutes?.size ?? 0) > 0
  const byType = {}
  for (const s of SECTIONS) {
    byType[s.type] = (routes ?? []).filter(r => r.type === s.type && !consumed.has(r.id))
  }
  const total = Object.values(byType).reduce((n, list) => n + list.length, 0)

  return (
    <div className="mlanes">
      {mode === 'live' && <SnapshotBar snapshot={liveSnapshot} loading={snapshotLoading}
        started={started} onRefetch={onRefetch} variant="phone" />}
      {!total && <p className="mlanes-empty">No lines in this song. Add a line to start.</p>}
      {SECTIONS.map(({ type, label }) => byType[type].length > 0 && (
        <section className="mlanes-section" key={type} aria-label={`${label} lanes`}>
          <div className="mlanes-section-head">
            <h3 className="mlanes-heading">{label}</h3>
            {type !== 'metro' && <button type="button" className="mlanes-action" disabled={started}
              aria-label={`Re-pick ${label} lines`} onClick={() => onRepickType(type)}>Re-pick</button>}
            <button type="button" className="mlanes-action" disabled={started}
              aria-label={`Add a ${label} line`} onClick={() => onAddLine(type)}>Add line</button>
          </div>
          <ul className="mlanes-list">
            {byType[type].map(route => (
              <MobileLaneStrip key={route.id} route={route}
                disabled={!!disabled?.[route.id]} soloed={!!soloRoutes?.has(route.id)} anySoloed={anySoloed}
                volume={volumes?.[route.id] ?? 0} locked={!!lockedIds?.has(route.id)} tag={labels?.[route.id]}
                onDisable={onDisable} onSolo={onSolo} onVolume={onVolume} onOpen={onOpenLane} />
            ))}
          </ul>
        </section>
      ))}
      <button type="button" className="mlanes-add lsheet-action" disabled={started} onClick={() => onAddLine(null)}>Add line</button>
    </div>
  )
}
