// Everything about one lane that doesn't fit on its strip.
//
// Desktop shows this as a multi-column "device rack" of dense cards. Here it's
// five segments in a bottom sheet:
//   Tone   — instrument, harmony and pitch mapping
//   Rhythm — playback timing and arpeggiation
//   Mix   — level, stereo position, filter, EQ, FX sends, sidechain ducking
//   Notes — the touch replacement for the stop rail (see below)
//   Auto  — source-driven curves and loop windows
//
// The stop rail can't be made tappable at this size: dots are 8px and sit
// 10–20px apart, so 44px hit areas would overlap several neighbours. Notes is
// a plain vertical list of 44px rows instead, which is a better touch editor
// than dot-dragging ever was — the trade is that you lose the shape of the
// line at a glance, which is why the desktop rail stays.
'use client'

import { useState } from 'react'
import Sheet from '../Sheet.jsx'
import { useResonatorStatus } from '@/lib/shared/useResonatorStatus.js'
import { DEFAULT_ARP } from '@/lib/engine.js'
import { DEFAULT_GRID_RESOLUTION, DEFAULT_PITCH_VARIETY } from '@/lib/mappings.js'
import { normalizeStopNoteLength, stopNoteLengthStatus } from '@/lib/stopNoteLength.js'
import { normalizeVelocityMapping, stopVelocityStatus } from '@/lib/stopVelocity.js'
import { normalizeLoopPattern, normalizeNoteChance } from '@/lib/laneGating.js'
import ToneSegment from './lane/ToneSegment.jsx'
import RhythmSegment from './lane/RhythmSegment.jsx'
import MixSegment from './lane/MixSegment.jsx'
import NotesSegment from './lane/NotesSegment.jsx'
import AutoSegment from './lane/AutoSegment.jsx'
import { useAutomationPlayback } from '@/lib/shared/useAutomationPlayback.js'

const SEGMENTS = [
  { id: 'sound', label: 'Tone' },
  { id: 'rhythm', label: 'Rhythm' },
  { id: 'mix',   label: 'Mix' },
  { id: 'notes', label: 'Notes' },
  { id: 'auto', label: 'Auto' },
]

export default function LaneSheet({
  route,
  open,
  onClose,
  onChangeLine, onRemoveLine, onDuplicate, onRemoveDuplicate, onUnmerge,
  // state
  volume = 0,
  pan = 0,
  disabled = false,
  soloed = false,
  synthType,
  adsr,
  granular,
  scale,
  octave = 0,
  semitone = 0,
  pitchVariety,
  speed = 1,
  gridResolution = DEFAULT_GRID_RESOLUTION,
  loopRegion,
  onTrackLoopRegion,
  started = false, audioExporting = false, audioProgress = 0,
  onExportMidi, onExportWav,
  arp,
  perStopSteps,
  stopVelocities,
  noteChance,
  noteLength,
  stopNoteLength,
  stopVelocityMap,
  glide = 0,
  automationLanes, automationRoutes, sourceRegions, sourceResolutions,
  onAddAutomationLane, onUpdateAutomationLane, onRemoveAutomationLane,
  legato = false,
  drone = false,
  stopChances,
  loopPattern,
  sendMatrix,
  activeFxTracks = [],
  sidechain,
  sidechainSources = [],
  filter, getEqRuntime, engineGen,
  tag,
  // handlers — the same ones the desktop rack calls
  onSamplerPreset, onSamplerUpload, onDrumVoice, onGranular, onGlide, onLegato,
  onVolume, onPan, onDisable, onSolo, onSynthType, onADSR, onScale, onOctaveShift,
  onPitchVariety, onTrackSpeed, onGridResolution, onArp,
  onSendLevel, onSidechain, onStopPitch, onStopVelocity, onLaneTag,
  onNoteChance, onStopChance, onLoopPattern, onNoteLength, onStopNoteLength, onStopVelocityMap, onFilter,
}) {
  const [segment, setSegment] = useState('sound')
  const resonatorStatus = useResonatorStatus()
  const { targets: autoTargets, visuals: autoVisuals } = useAutomationPlayback({ lanes: automationLanes, routes: automationRoutes,
    regions: sourceRegions, resolutions: sourceResolutions, started, active: open && !!route,
    synthType: synthType ?? 'Synth', adsr, filter, granular,
    laneRegion: loopRegion, laneSpeed: speed, devices: { arp, granular, sidechain } })

  const trackScale = scale ?? { root: 'C', scaleType: 'major' }
  const pv = { ...DEFAULT_PITCH_VARIETY, ...pitchVariety }
  const ag = { ...DEFAULT_ARP, ...arp }
  const laneChance = normalizeNoteChance(noteChance)
  const pattern = normalizeLoopPattern(loopPattern)
  // Stop-driven note length (lib/stopNoteLength.js) — same rules as the desktop rack.
  const snl = normalizeStopNoteLength(stopNoteLength)
  const snlStatus = stopNoteLengthStatus({
    cfg: snl, synthType, arp: ag.enabled, legato, drone, merged: !!route?.isMerged,
  })
  const setSnlBound = (key, len) => onStopNoteLength?.(route.id, { ...snl, [key]: len })
  // Stop-driven velocity (lib/stopVelocity.js) — same rules as the desktop rack.
  const svm = normalizeVelocityMapping(stopVelocityMap)
  const svmStatus = stopVelocityStatus({ cfg: svm, synthType })
  const setSvm = patch => onStopVelocityMap?.(route.id, { ...svm, ...patch })

  const ctx = { autoTargets, autoVisuals, automationRoutes, sourceRegions, sourceResolutions,
    onAddAutomationLane, onUpdateAutomationLane, onRemoveAutomationLane, onTrackLoopRegion, started, audioExporting, audioProgress, onExportMidi, onExportWav, glide, automationLanes, onSamplerPreset, onSamplerUpload, onDrumVoice, onGranular, onGlide, onLegato, route, volume, pan, disabled, soloed, synthType, adsr, granular, scale, octave,
    semitone, pitchVariety, speed, gridResolution, loopRegion, arp, perStopSteps,
    stopVelocities, noteChance, noteLength, stopNoteLength, stopVelocityMap, legato, drone,
    stopChances, loopPattern, sendMatrix, activeFxTracks, sidechain, sidechainSources, filter, getEqRuntime, engineGen,
    tag, onVolume, onPan, onDisable, onSolo, onSynthType, onADSR, onScale, onOctaveShift,
    onPitchVariety, onTrackSpeed, onGridResolution, onArp, onSendLevel, onSidechain,
    onStopPitch, onStopVelocity, onLaneTag, onNoteChance, onStopChance, onLoopPattern,
    onNoteLength, onStopNoteLength, onStopVelocityMap, onFilter, trackScale, pv, ag, laneChance,
    pattern, snl, snlStatus, setSnlBound, svm, svmStatus, setSvm, resonatorStatus,
  }

  if (!route) return null

  return (
    <Sheet
      open={open}
      onClose={onClose}
      tourId="mobile-lane-sheet"
      title={route.name ?? route.id}
      className="lane-sheet"
      // In the sheet's toolbar, not its body: the Notes list runs to 60+ rows
      // on a bus route, and inside the scrolling body these tabs scrolled out
      // of reach — leaving no way back to Sound or Mix.
      toolbar={
        <>
          <div className="lsheet-line-actions">
            <select aria-label="Line actions" value="" onChange={e => {
              const actions = { change: onChangeLine, remove: onRemoveLine, duplicate: onDuplicate, removeCopy: onRemoveDuplicate, unmerge: onUnmerge }
              actions[e.target.value]?.()
            }}>
              <option value="" disabled>Line actions</option>
              {!route.isDuplicate && !route.isMerged && <>
                <option value="change" disabled={started}>Change line</option>
                <option value="remove" disabled={started}>Remove</option>
              </>}
              {!route.isMerged && <option value="duplicate">Duplicate</option>}
              {route.isDuplicate && <option value="removeCopy">Remove this copy</option>}
              {route.isMerged && <option value="unmerge">Un-merge</option>}
            </select>
            {started && !route.isDuplicate && !route.isMerged && <span className="lsheet-hint">Stop to change or remove lines.</span>}
          </div>
        <div className="lsheet-segments" role="tablist">
          {SEGMENTS.map(s => (
            <button
              key={s.id}
              data-tour={`mobile-${s.id}`}
              type="button"
              role="tab"
              aria-selected={segment === s.id}
              className={`lsheet-segment ${segment === s.id ? 'is-active' : ''}`}
              onClick={() => setSegment(s.id)}
            >{s.label}</button>
          ))}
        </div>
        </>
      }
    >
      {segment === 'sound' && <ToneSegment ctx={ctx} />}
      {segment === 'rhythm' && <RhythmSegment ctx={ctx} />}
      {segment === 'mix' && <MixSegment ctx={ctx} />}
      {segment === 'notes' && <NotesSegment ctx={ctx} />}
      {segment === 'auto' && <AutoSegment ctx={ctx} />}
    </Sheet>
  )
}
