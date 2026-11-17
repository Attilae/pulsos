'use client'

import { useMemo } from 'react'
import { IconReset } from '../../icons.jsx'
import { stopDemand, resolveStopHold, holdLabel } from '@/lib/stopNoteLength.js'
import { STOP_VELOCITY_LABELS } from '@/lib/stopVelocity.js'
import { buildLanePitchMaps, buildLaneNoteRows } from '@/lib/laneNotes.js'

// One segment of the phone lane sheet (see ../LaneSheet.jsx). It receives the
// sheet's props plus the values LaneSheet derives from them, as `ctx`.
export default function NotesSegment({ ctx }) {
  const {
    route, scale, octave, semitone, pitchVariety, gridResolution, loopRegion, perStopSteps, stopVelocities, noteLength, stopChances, onStopPitch, onStopVelocity, onStopChance, trackScale, laneChance, snl, snlStatus, svm,
  } = ctx
  const noteRows = useMemo(() => {
    if (!route) return []
    const { pitchMap } = buildLanePitchMaps(route, {
      scale: trackScale, pitchVariety, perStopSteps,
      octaveShift: octave, semitoneShift: semitone,
      gridResolution, loopRegion,
    })
    return buildLaneNoteRows(route, { pitchMap, perStopSteps, stopVelocities, stopChances, laneChance, velocityMapping: svm })
  }, [route, trackScale.root, trackScale.scaleType, pitchVariety, perStopSteps, stopVelocities, stopChances, laneChance, octave, semitone, gridResolution, loopRegion, svm?.source, svm?.min, svm?.max, svm?.invert])
  return (
    <div className="lsheet-body">
      <p className="lsheet-note">
        One row per stop, in travel order. &plusmn; moves the note within
        the lane&rsquo;s scale. Chance follows the lane until you move it;
        the reset button hands it back.
      </p>
      <ul className="lsheet-notes">
        {noteRows.map(row => (
          <li className="lsheet-noterow" key={row.id}>
            <div className="lsheet-noterow-head">
              <span className="lsheet-stop">{row.name}</span>
              <div className="lsheet-stepper lsheet-stepper--sm">
                <button
                  type="button"
                  onClick={() => onStopPitch(route.id, row.id, row.steps - 1)}
                  aria-label={`${row.name}: down one step`}
                >−</button>
                <span className="mono">{row.steps > 0 ? `+${row.steps}` : row.steps}</span>
                <button
                  type="button"
                  onClick={() => onStopPitch(route.id, row.id, row.steps + 1)}
                  aria-label={`${row.name}: up one step`}
                >+</button>
              </div>
              <span className="lsheet-note-name mono">{row.note}</span>
            </div>
            {snlStatus.active && !route.isMerged && (() => {
              const stop = route.stops?.[row.index]
              const hold = resolveStopHold(snl, stopDemand(stop), noteLength)
              return (
                <div className="lsheet-noterow-param lsheet-noterow-param--text">
                  <span className="lsheet-noterow-label">Hold</span>
                  <span className="lsheet-noterow-value mono">
                    {hold.fallback
                      ? 'Fixed fallback: demand unavailable'
                      : `${holdLabel(hold)} · demand ${Math.round(hold.demand * 100)}%`}
                  </span>
                </div>
              )
            })()}
            <div className="lsheet-noterow-param">
              <span className="lsheet-noterow-label">Velocity</span>
              <input
                type="range" min={0.2} max={1} step={0.05}
                value={row.velocity}
                onChange={e => onStopVelocity(route.id, row.id, Number(e.target.value))}
                aria-label={`${row.name}: velocity`}
              />
              <span
                className={`lsheet-noterow-value mono${row.velocityOrigin === 'authored' ? '' : ' is-inherited'}`}
                title={row.velocityOrigin === 'authored' ? 'Set for this stop' : row.velocityOrigin === 'variety' ? 'Lane default' : `From ${STOP_VELOCITY_LABELS[row.velocityOrigin].toLowerCase()}`}
              >{Math.round(row.velocity * 100)}%</span>
              <span aria-hidden="true" />
            </div>
            <div className="lsheet-noterow-param">
              <span className="lsheet-noterow-label">Chance</span>
              <input
                type="range" min={0} max={1} step={0.05}
                value={row.chance}
                onChange={e => onStopChance(route.id, row.id, Number(e.target.value))}
                aria-label={`${row.name}: chance${row.chanceOverride ? '' : ', following the lane'}`}
              />
              <span
                className={`lsheet-noterow-value mono${row.chanceOverride ? '' : ' is-inherited'}`}
              >{Math.round(row.chance * 100)}%</span>
              {row.chanceOverride ? (
                <button
                  type="button"
                  className="lsheet-noterow-reset"
                  onClick={() => onStopChance(route.id, row.id, null)}
                  aria-label={`${row.name}: follow lane chance`}
                  title="Follow lane chance"
                ><IconReset size={16} /></button>
              ) : <span aria-hidden="true" />}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
