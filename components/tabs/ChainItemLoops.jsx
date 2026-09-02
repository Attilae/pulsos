// The per-item loop strip in the Song Chainer's chain list.
//
// A chain item cuts its preset after a fixed number of bars, but the preset's
// lanes loop on their *own* cycles (that's the polyrhythm the DAW is for), so
// the right bar count is invisible: a 7/8 lane against a 1-bar lane only lines
// up again at 7 bars. This draws each audible lane's loop as repeated bricks
// across the part, hatches the brick the part cuts in half, and offers the
// realignment point as a one-click snap.
//
// Display only — every number comes from lib/laneCycles.js, which reads the
// same snapshot fields playback does.
import { useMemo } from 'react'
import {
  describeSnapshotLoops, buildLoopBricks, suggestBarOptions, formatBars,
} from '@/lib/laneCycles.js'

// Beyond this the strip is taller than the row it explains; the rest collapse
// into a count. Chosen to comfortably clear the Free plan's 6-lane cap.
const MAX_VISIBLE_LANES = 8
// Bar numbers stop being readable long before the ruler runs out of room.
const MAX_RULER_BARS = 32

function LaneRow({ lane, barCount }) {
  const bricks = buildLoopBricks(lane.loopUnits, barCount)
  const length = formatBars(lane.loopBars)
  const title  = `${lane.name} · loops every ${length} bar${lane.loopBars === 1 ? '' : 's'}`
    + (bricks.aligned ? '' : ' — cut mid-loop by this part')

  return (
    <div className="chain-loop-lane" title={title}>
      <span className="chain-loop-name">
        <i className="chain-loop-dot" style={lane.color ? { '--lane-color': lane.color } : undefined} />
        {lane.name}
      </span>

      <span className="chain-loop-track" style={{ '--bar-pct': `${100 / barCount}%` }}>
        {bricks.collapsed ? (
          <span
            className="chain-loop-brick chain-loop-brick--dense"
            style={{ width: '100%', ...(lane.color ? { '--lane-color': lane.color } : {}) }}
          >
            ×{bricks.fullCount}
          </span>
        ) : (
          Array.from({ length: bricks.fullCount }, (_, i) => (
            <span
              key={i}
              className="chain-loop-brick"
              style={{ width: `${bricks.widthPct}%`, ...(lane.color ? { '--lane-color': lane.color } : {}) }}
            />
          ))
        )}

        {bricks.remainderUnits > 0 && (
          <span
            className="chain-loop-brick chain-loop-brick--partial"
            style={{ width: `${bricks.partialPct}%`, ...(lane.color ? { '--lane-color': lane.color } : {}) }}
          />
        )}
      </span>

      <span className={`chain-loop-len ${bricks.aligned ? '' : 'chain-loop-len--cut'}`}>{length}</span>
    </div>
  )
}

export default function ChainItemLoops({
  snapshot, routes, bars, activeLaneLimit = null, onSnapBars,
}) {
  // Keyed off the snapshot, not `bars` — this is the expensive half, and the
  // bars input fires it on every keystroke otherwise.
  const info = useMemo(
    () => describeSnapshotLoops(snapshot, routes, { activeLaneLimit }),
    [snapshot, routes, activeLaneLimit],
  )

  if (snapshot === undefined) return <div className="chain-loops chain-loops--pending">loading…</div>
  if (snapshot === null)      return <div className="chain-loops chain-loops--pending">preset unavailable</div>
  if (info.unknownLanes)      return <div className="chain-loops chain-loops--pending">older song — lane list not recorded</div>
  if (!info.lanes.length)     return <div className="chain-loops chain-loops--pending">no active lanes</div>

  const barCount = Math.max(1, Math.round(bars || 1))
  const visible  = info.lanes.slice(0, MAX_VISIBLE_LANES)
  const hidden   = info.lanes.length - visible.length

  const { suggestedBars, unbounded } = info
  const alignedHere = suggestedBars != null && barCount % suggestedBars === 0
  // Only offered as a fix. Once the part already lands on the cycle, chips that
  // merely shorten it are noise.
  const options = alignedHere ? [] : suggestBarOptions(suggestedBars).filter(n => n !== barCount)

  // Where every lane comes back around inside this part.
  const cycleBars = suggestedBars ?? 0
  const cycleMarks = cycleBars > 0 && cycleBars < barCount
    ? Array.from({ length: Math.floor((barCount - 0.001) / cycleBars) }, (_, i) => (i + 1) * cycleBars)
    : []

  return (
    <div className="chain-loops">
      <div className="chain-loops-grid">
        {cycleMarks.length > 0 && (
          <span className="chain-loop-cycles" aria-hidden="true">
            {cycleMarks.map(at => (
              <span key={at} className="chain-loop-cycle" style={{ left: `${(at / barCount) * 100}%` }} />
            ))}
          </span>
        )}

        {visible.map(lane => <LaneRow key={lane.id} lane={lane} barCount={barCount} />)}

        {barCount <= MAX_RULER_BARS && (
          <div className="chain-loop-lane chain-loops-ruler">
            <span className="chain-loop-name" />
            <span className="chain-loop-track">
              {Array.from({ length: barCount }, (_, i) => (
                <span key={i} className="chain-loop-tick" style={{ width: `${100 / barCount}%` }}>
                  {barCount <= 16 || i % 4 === 0 ? i + 1 : ''}
                </span>
              ))}
            </span>
            <span className="chain-loop-len" />
          </div>
        )}
      </div>

      <div className="chain-loops-hint">
        {hidden > 0 && <span className="chain-loops-more">+{hidden} more lane{hidden === 1 ? '' : 's'}</span>}

        {unbounded ? (
          <span>Lanes never fully realign — no common cycle under 256 bars.</span>
        ) : suggestedBars == null ? null : alignedHere ? (
          <span className="chain-loops-ok">✓ All lanes end together at {barCount} bars.</span>
        ) : (
          <span>
            Lanes realign every <strong>{suggestedBars}</strong> bar{suggestedBars === 1 ? '' : 's'}.
          </span>
        )}

        {options.length > 0 && !unbounded && (
          <span className="chain-snap-chips">
            {options.map(n => (
              <button
                key={n}
                type="button"
                className="chain-snap-chip"
                onClick={() => onSnapBars?.(n)}
                title={`Set this part to ${n} bars — every lane ends flush`}
              >
                {n}
              </button>
            ))}
          </span>
        )}

        {info.missingIds.length > 0 && (
          <span className="chain-loops-warn">
            {info.missingIds.length} lane{info.missingIds.length === 1 ? '' : 's'} not in this city
          </span>
        )}
      </div>
    </div>
  )
}
