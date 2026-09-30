import * as Tone from 'tone'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { SYNTH_DEFAULTS, availableAutomationTargets, findTargetSpec, SAMPLER_PRESET_LIST, SAMPLER_PRESETS, DRUM_VOICES, DRUM_VOICE_LICENSE, DEFAULT_GRANULAR, DEFAULT_SIDECHAIN, ARP_STYLES, ARP_RATES, DEFAULT_ARP, DRUMS_ROUTE_ID } from '@/lib/engine.js'
import { FX_BUSES, AUTOMATION_TARGETS, FX_PARAM_SPECS, FX_SYNC_TARGETS } from '@/lib/fxTrack.js'
import { PAD_DEFS as DRUM_PAD_DEFS, STEPS as DRUM_STEPS, SOURCE_STEPS as DRUM_SOURCE_STEPS, emptyPattern as emptyDrumPattern } from '@/lib/engines/drumEngine.js'
import { generatePitchMap, shiftOctaveNote, shiftSemitones, noteToMidi, SCALES, hashStopValue, snapStopsToGrid, GRID_TOTAL_CELLS, GRID_BARS, GRID_STEPS_PER_BAR, GRID_RESOLUTION_STEPS_PER_BAR, DEFAULT_GRID_RESOLUTION, denormalizeToRange, denormalizeExp, transposeNoteInScale, PITCH_CONTOURS, DEFAULT_PITCH_VARIETY } from '@/lib/mappings.js'
import { buildLanePitchMaps } from '@/lib/laneNotes.js'
import { pickerSynthTypes, OSC_TYPES } from '@/lib/soundSpecs.js'
import { NOTE_LENGTHS, NOTE_LENGTH_LABELS, DEFAULT_NOTE_LENGTH } from '@/lib/noteLength.js'
import { useResetGesture } from '@/lib/shared/useResetGesture.js'
import { useIsPhone } from '@/lib/shared/useViewport.js'
import { subscribePlayhead } from '@/lib/shared/playheadTicker.js'
import { subscribeEvents, getEvents } from '@/lib/shared/eventLogStore.js'
import { normalizeLaneTag } from '@/lib/laneTags.js'
import { LOOP_PATTERN_PRESETS, MAX_PATTERN_PLAY, MAX_PATTERN_REST, normalizeLoopPattern, normalizeNoteChance, formatLoopPattern, loopIndexAt, loopPlays } from '@/lib/laneGating.js'
import StopEditor from './StopEditor.jsx'
import LaneTagEditor from './LaneTagEditor.jsx'
import DuplicateLaneDialog from './DuplicateLaneDialog.jsx'
import LinePicker from './LinePicker.jsx'
import { NOTE_ROOTS, SCALE_TYPES } from '@/lib/harmony.js'
import { getMasterBus } from '@/lib/masterBus.js'
import { MASTER_CHAIN_DEFAULTS, MASTER_CHAIN_SPECS, MASTER_CHAIN_STAGES, isDefaultMasterChain } from '@/lib/masterChain.js'
import './DawView.css'

// Exported so the phone lane sheet offers exactly the same instruments.
export { pickerSynthTypes } from '@/lib/soundSpecs.js'

// Lane groupings, in render order. Exported so the phone lane list
// (components/mobile/MobileLaneList.jsx) groups tracks identically.
export const SECTIONS = [
  { type: 'metro',   label: 'Metro' },
  { type: 'tram',    label: 'Tram' },
  { type: 'trolley', label: 'Trolley' },
  { type: 'bus',     label: 'Bus' },
]

export { NOTE_ROOTS, SCALE_TYPES } from '@/lib/harmony.js'

// Grouped <option> list for a sidechain source picker. Exported so the phone lane
// sheet offers exactly the same sources as the desktop rack — MixerTab builds the
// list once and both surfaces render it identically.
export function SidechainSourceOptions({ sources = [], excludeId }) {
  const groups = []
  for (const src of sources) {
    if (src.value === excludeId) continue   // a lane ducking off itself is never useful
    let group = groups.find(g => g.label === src.group)
    if (!group) { group = { label: src.group, items: [] }; groups.push(group) }
    group.items.push(src)
  }
  return (
    <>
      <option value="">None</option>
      {groups.map(group => (
        <optgroup key={group.label} label={group.label}>
          {group.items.map(src => <option key={src.value} value={src.value}>{src.label}</option>)}
        </optgroup>
      ))}
    </>
  )
}
export const SPEED_OPTIONS = [
  { value: 0.25, label: '÷4',   title: '0.25× speed — one pass every 4 loops' },
  { value: 0.5,  label: '÷2',   title: '0.5× speed — one pass every 2 loops' },
  { value: 1,    label: '1×',   title: 'Normal speed' },
  { value: 1.5,  label: '×1.5', title: '1.5× speed — 3:2 polyrhythm' },
  { value: 2,    label: '×2',   title: '2× speed — two passes per loop' },
  { value: 3,    label: '×3',   title: '3× speed — three passes per loop' },
  { value: 4,    label: '×4',   title: '4× speed — four passes per loop' },
]

// Arpeggiator display labels (values come from ARP_STYLES / ARP_RATES in engine/mappings)
export const ARP_STYLE_LABELS = {
  up: 'Up', down: 'Dn', updown: 'Up/Dn', downup: 'Dn/Up',
  converge: 'Conv', diverge: 'Div', random: 'Rnd',
}
export const ARP_RATE_LABELS = {
  '4n': '1/4', '8n': '1/8', '8t': '1/8T', '16n': '1/16', '16t': '1/16T', '32n': '1/32',
}

// Pitch-contour display labels (values come from PITCH_CONTOURS in mappings)
export const CONTOUR_LABELS = { geographic: 'Geo', demand: 'Demand', randomWalk: 'Walk', arch: 'Arch' }
export const CONTOUR_TITLES = {
  demand:     'Demand — more service or riders produces a higher note (default)',
  geographic: 'Geographic — latitude traces the melody',
  randomWalk: 'Random walk — seeded melodic drift through the scale',
  arch:       'Arch — rises then falls along the stop sequence',
}

const FILTER_TYPES = ['lowpass', 'highpass', 'bandpass', 'notch']
const FILTER_ROLLOFFS = [-12, -24, -48, -96]
const NOISE_TYPES = ['white', 'pink', 'brown']

const DEFAULT_FILTER = { type: 'lowpass', frequency: 20000, Q: 4 }

// Find the stop nearest to a vehicle lat/lng, return its rail position (0–100)
function resolvePlayhead(route, lat, lng) {
  if (!route.stops.length || route.totalDist <= 0 || lat == null) return null
  let nearest = route.stops[0]
  let minD    = Infinity
  for (const s of route.stops) {
    const d = (s.lat - lat) ** 2 + (s.lon - lng) ** 2
    if (d < minD) { minD = d; nearest = s }
  }
  return { pct: (nearest.dist / route.totalDist) * 100, stopId: nearest.id }
}

// ── Loop-region handles (note rail + automation rail) ───────────────────────
// Pointer: capture on the handle itself, so the drag follows the pointer
// anywhere and ends on up, cancel (a scroll or OS gesture took the touch) or
// lost capture. The old window listeners ran permanently on every rail and a
// cancelled touch left the handle "stuck" to the next move.
// Keyboard: each handle is a slider. Arrows move one grid cell, Shift+arrows a
// beat, PageUp/PageDown a bar, Home/End to the limit.
const CELLS_PER_BEAT = GRID_STEPS_PER_BAR / 4

function describeCell(cell) {
  const bar  = Math.floor(cell / GRID_STEPS_PER_BAR) + 1
  const step = (cell % GRID_STEPS_PER_BAR) + 1
  return `bar ${bar}, step ${step}`
}

function useLoopHandles({ railRef, startCell, endCell, onLoopRegion }) {
  const dragRef   = useRef(null)  // 'start' | 'end' | null
  const latestRef = useRef({ startCell, endCell, onLoopRegion })
  latestRef.current = { startCell, endCell, onLoopRegion }

  const moveEdge = useCallback((edge, cell) => {
    const { startCell: s0, endCell: e0, onLoopRegion: set } = latestRef.current
    if (!set) return
    if (edge === 'start') {
      const next = Math.max(0, Math.min(e0 - 1, cell))
      if (next !== s0) set({ startCell: next, endCell: e0 })
    } else {
      const next = Math.max(s0 + 1, Math.min(GRID_TOTAL_CELLS, cell))
      if (next !== e0) set({ startCell: s0, endCell: next })
    }
  }, [])

  return useCallback((edge) => {
    const isStart = edge === 'start'
    const value   = isStart ? startCell : endCell
    const end = (e) => {
      if (dragRef.current !== edge) return
      dragRef.current = null
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    }
    return {
      role: 'slider',
      tabIndex: onLoopRegion ? 0 : -1,
      'aria-label': isStart ? 'Loop start' : 'Loop end',
      'aria-orientation': 'horizontal',
      'aria-valuemin': isStart ? 0 : startCell + 1,
      'aria-valuemax': isStart ? endCell - 1 : GRID_TOTAL_CELLS,
      'aria-valuenow': value,
      'aria-valuetext': isStart
        ? `Starts at ${describeCell(startCell)}`
        : `Ends after ${describeCell(endCell - 1)}`,
      onPointerDown: (e) => {
        if (!onLoopRegion) return
        e.preventDefault()
        e.stopPropagation()
        e.currentTarget.setPointerCapture?.(e.pointerId)
        dragRef.current = edge
      },
      onPointerMove: (e) => {
        if (dragRef.current !== edge) return
        const rect = railRef.current?.getBoundingClientRect()
        if (!rect || rect.width === 0) return
        const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
        moveEdge(edge, Math.round(frac * GRID_TOTAL_CELLS))
      },
      onPointerUp: end,
      onPointerCancel: end,
      onLostPointerCapture: end,
      onKeyDown: (e) => {
        if (!onLoopRegion) return
        const small = e.shiftKey ? CELLS_PER_BEAT : 1
        let next = null
        switch (e.key) {
          case 'ArrowLeft': case 'ArrowDown': next = value - small; break
          case 'ArrowRight': case 'ArrowUp':  next = value + small; break
          case 'PageDown': next = value - GRID_STEPS_PER_BAR; break
          case 'PageUp':   next = value + GRID_STEPS_PER_BAR; break
          case 'Home': next = isStart ? 0 : startCell + 1; break
          case 'End':  next = isStart ? endCell - 1 : GRID_TOTAL_CELLS; break
          default: return
        }
        e.preventDefault()
        e.stopPropagation()
        moveEdge(edge, next)
      },
    }
  }, [startCell, endCell, onLoopRegion, railRef, moveEdge])
}

// Call two handler maps' same-named handlers in order (a then b).
function mergeHandlers(a, b) {
  const out = { ...a, ...b }
  for (const key of Object.keys(a)) {
    if (key.startsWith('on') && typeof a[key] === 'function' && typeof b[key] === 'function') {
      out[key] = (e) => { a[key](e); b[key](e) }
    }
  }
  return out
}

export default function DawView({
  className = '',
  visible = true, mode, started, routes, allRoutes, onRepickType,
  onAddLine, onChangeLine, onRemoveLine,
  onDuplicateTrack, onRemoveDuplicate, onStopPitch, perStopStepsById,
  onMergeLanes, onUnmerge, mergedConsumedIds,
  volumes, disabled, pans, soloRoutes,
  bpm,
  drumPattern, drumsMuted, onToggleDrumStep, onToggleDrumPadMute, onToggleDrumsMute, onClearDrums,
  drumVolume, drumFilter, onDrumVolume, onDrumFilter, onDrumSendLevel, getDrumEqRuntime,
  liveSnapshot, snapshotLoading,
  trackSoundModes, trackScales, trackSynthTypes, trackADSRs, trackFilters,
  getEqRuntime,
  sendMatrix, automationCfg, automationSourceIds,
  fxBusWet, activeFxTracks, masterVolume, masterChain, onMasterChain, trackOctaves, trackSemitones, trackGlides, trackLegatos, trackArps, trackGranulars, trackSidechains, sidechainSources, trackSpeeds, trackLoopRegions,
  trackGridResolutions,
  trackPitchVariety, onPitchVariety,
  trackStopVelocities, onStopVelocity,
  trackNoteChances, onNoteChance, trackStopChances, onStopChance, trackLoopPatterns, onLoopPattern,
  trackNoteLengths, onNoteLength,
  trackLabels, onLaneTag,
  trackDroneModes, trackDroneRoots, onDroneMode, onDroneRoot,
  onVolume, onDisable, onPan, onSolo,
  onSoundMode, onScale, onSynthType, onADSR, onSamplerPreset, onDrumVoice, onSamplerUpload, onFilter,
  onSendLevel, onFxBusWet, fxBusMuted, fxBusSoloed, onFxBusMute, onFxBusSolo,
  fxBusParams, onFxBusParam, onFxBusCustomIR,
  onAddFxTrack, onRemoveFxTrack, onMasterVolume,
  onOctaveShift, onGlide, onLegato, onArp, onGranular, onSidechain, onTrackSpeed, onTrackLoopRegion, onGridResolution,
  onAddAutomationLane, onRemoveAutomationLane, onUpdateAutomationLane,
  onRefetch, onVehicleCrossed, onExportRouteMidi, onExportRouteAudio, audioExportActive,
}) {
  const tracksRef             = useRef(null)
  const animRef               = useRef(null)
  const lastProgressRef       = useRef(0)
  // Stop-editor modal: the stop currently open for pitch/velocity editing, or null.
  const [editingStop, setEditingStop] = useState(null)
  // Duplicate-lane modal: { routeId, routeName } of the lane being duplicated, or null.
  const [dupPrompt, setDupPrompt] = useState(null)
  // Lane-label modal: { routeId, routeName } of the lane being labelled, or null.
  const [tagPrompt, setTagPrompt] = useState(null)
  // Line picker modal: { mode:'add'|'change', type?, routeId? }, or null.
  const [linePicker, setLinePicker] = useState(null)

  // Merge mode: tick 2+ base lanes, then fold them into one PolySynth chord lane.
  const [mergeMode, setMergeMode] = useState(false)
  const [mergeSel,  setMergeSel]  = useState(() => new Set())
  const toggleMergeSel = useCallback((id) => {
    setMergeSel(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])
  const exitMergeMode = useCallback(() => { setMergeMode(false); setMergeSel(new Set()) }, [])

  // Live automation values reported by each lane's curve rail, keyed routeId → laneId →
  // { paramTarget, value }. Used purely to mirror automation onto the instrument controls;
  // transient (not persisted). Updates only when a playhead crosses a stop.
  const [liveAuto, setLiveAuto] = useState({})
  const handleLiveAuto = useCallback((routeId, laneId, paramTarget, value) => {
    setLiveAuto(prev => {
      const prevLane = prev[routeId]?.[laneId]
      if (prevLane && prevLane.paramTarget === paramTarget && prevLane.value === value) return prev
      return { ...prev, [routeId]: { ...prev[routeId], [laneId]: { paramTarget, value } } }
    })
  }, [])

  const vehiclesByRoute = useMemo(() => {
    if (!liveSnapshot?.vehicles) return {}
    const map = {}
    for (const v of liveSnapshot.vehicles) {
      if (!map[v.routeShortName]) map[v.routeShortName] = []
      map[v.routeShortName].push(v)
    }
    return map
  }, [liveSnapshot])

  // Live mode: fire a note when a vehicle crosses the 4-bar visual cycle.
  // This drives audio, not display, so it runs whether or not the DAW view is
  // visible. Playheads and step highlights draw themselves from the shared
  // ticker (lib/shared/playheadTicker.js) without touching React state.
  useEffect(() => {
    lastProgressRef.current = 0
    if (!started || mode !== 'live' || !routes || !liveSnapshot) return

    const tick = () => {
      // The global Transport no longer loops (each Part self-loops for polyrhythm), so
      // Transport.progress stays 0. Compute the 4-bar visual cycle phase manually.
      const bpm = Tone.Transport.bpm.value || 120
      const loopSec = (16 / bpm) * 60
      const progress = (Tone.getTransport().seconds % loopSec) / loopSec

      const prev = lastProgressRef.current
      for (const route of routes) {
        const vehicles = vehiclesByRoute[route.name] ?? []
        for (const v of vehicles) {
          const ph2 = resolvePlayhead(route, v.lat, v.lng)
          if (!ph2) continue
          const vPct   = ph2.pct / 100
          const crossed = progress >= prev
            ? (prev < vPct && vPct <= progress)
            : (prev < vPct || vPct <= progress)
          if (crossed) onVehicleCrossed(route.id, route.type, v.lat, ph2.stopId)
        }
      }

      lastProgressRef.current = progress
      animRef.current = requestAnimationFrame(tick)
    }

    animRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(animRef.current)
  }, [started, mode, routes, liveSnapshot, vehiclesByRoute, onVehicleCrossed])

  // Automation-source lanes now stay visible/audible in their own section (they can
  // both play and drive automation). Only lanes folded into a merged PolySynth lane
  // are hidden — they still play through the merged lane.
  const consumed = mergedConsumedIds ?? new Set()
  const routesByType = Object.fromEntries(
    SECTIONS.map(s => [s.type, routes?.filter(r => r.type === s.type && !consumed.has(r.id)) ?? []])
  )
  // All routes by id for source picker lookups
  const routeById = useMemo(() => {
    const map = {}
    for (const r of routes ?? []) map[r.id] = r
    return map
  }, [routes])
  // Ids already in the mix — the LinePicker greys these out in 'add' mode.
  const selectedIds = useMemo(() => new Set((routes ?? []).map(r => r.id)), [routes])

  return (
    <div className={`daw-body${className ? ` ${className}` : ''}`}>
      <section className="daw-tracks" ref={tracksRef} aria-label="Tracks">

        {!routes && <div className="daw-loading">Loading line data…</div>}

        {mode === 'live' && routes && (
          <div className="snapshot-bar">
            <span className="snapshot-label">
              {liveSnapshot
                ? `${liveSnapshot.vehicles.length} vehicles loaded`
                : 'No snapshot loaded'}
            </span>
            <button
              className="refetch-btn"
              onClick={onRefetch}
              disabled={snapshotLoading || started}
            >
              {snapshotLoading ? 'Fetching…' : '↺ Refetch'}
            </button>
          </div>
        )}

        {/* ── Merge lanes toolbar ── */}
        {/* The "Merge lanes" entry button is hidden per request; the merge
            functionality below stays intact and only renders once merge mode
            is active (e.g. triggered programmatically). */}
        {routes && onMergeLanes && mergeMode && (
          <div className="merge-bar">
            {(
              <>
                <span className="merge-hint">Tick 2+ lanes, then fold them into one PolySynth chord lane</span>
                <button
                  className="merge-confirm"
                  disabled={mergeSel.size < 2}
                  onClick={() => { onMergeLanes([...mergeSel]); exitMergeMode() }}
                >Merge{mergeSel.size ? ` ${mergeSel.size}` : ''}</button>
                <button className="merge-cancel" onClick={exitMergeMode}>Cancel</button>
              </>
            )}
          </div>
        )}

        {/* ── Sections per line type ── */}
        {SECTIONS.map(({ type, label }) => routesByType[type].length > 0 && (
          <div key={type}>
            <div className="daw-section-label">
              {label}
              {type !== 'metro' && onRepickType && (
                <button
                  className="section-repick-btn"
                  onClick={() => onRepickType(type)}
                  disabled={started}
                  title={`Re-pick ${label} lines`}
                >↻</button>
              )}
              {onAddLine && (
                <button
                  className="section-add-btn"
                  onClick={() => setLinePicker({ mode: 'add', type })}
                  disabled={started}
                  title={`Add a ${label} line`}
                >＋</button>
              )}
            </div>
            {routesByType[type].map(route => {
              const lanes = Object.entries(automationCfg?.[route.id] ?? {})
              // Source routes attached to this instrument
              const attachedSrcIds = [...new Set(
                lanes.map(([, lc]) => lc?.sourceRouteId).filter(Boolean)
              )]
              // Which params are owned by an armed automation lane, + their live value.
              // Drives the disable + visual-sweep of the matching instrument controls.
              const synthTypeFor = trackSynthTypes?.[route.id] ?? 'Synth'
              const autoTargets = {}
              for (const [laneId, cfg] of lanes) {
                if (!cfg?.sourceRouteId) continue
                const live = liveAuto[route.id]?.[laneId]
                autoTargets[cfg.paramTarget] = {
                  spec: findTargetSpec(cfg.paramTarget, synthTypeFor),
                  value: live?.paramTarget === cfg.paramTarget ? live.value : null,
                }
              }
              return (
                <div key={route.id} className={`track-group ${lanes.length > 0 ? 'track-group--has-lanes' : ''}`}>
                  <LineTrack
                    route={route}
                    mode={mode}
                    started={started}
                    visible={visible}
                    volume={volumes[route.id] ?? 0}
                    disabled={disabled[route.id] ?? false}
                    pan={pans[route.id] ?? 0}
                    isSoloed={soloRoutes.has(route.id)}
                    vehicles={vehiclesByRoute[route.name] ?? []}
                    soundMode={trackSoundModes?.[route.id] ?? 'harmonic'}
                    trackScale={trackScales?.[route.id] ?? { root: 'C', scaleType: 'major' }}
                    synthType={trackSynthTypes?.[route.id] ?? 'Synth'}
                    adsr={trackADSRs?.[route.id] ?? SYNTH_DEFAULTS['Synth']}
                    droneMode={trackDroneModes?.[route.id] ?? false}
                    droneRoot={trackDroneRoots?.[route.id] ?? 'C3'}
                    laneCount={lanes.length}
                    autoTargets={autoTargets}
                    activeFxTracks={activeFxTracks ?? []}
                    sendMatrix={sendMatrix}
                    onSendLevel={(busId, lvl) => onSendLevel(route.id, busId, lvl)}
                    onVolume={v => onVolume(route.id, v)}
                    onDisable={() => onDisable(route.id)}
                    onPan={v => onPan(route.id, v)}
                    onSolo={e => onSolo(route.id, e.metaKey || e.ctrlKey)}
                    octaveShift={trackOctaves?.[route.id] ?? 0}
                    semitoneShift={trackSemitones?.[route.id] ?? 0}
                    glide={trackGlides?.[route.id] ?? 0}
                    legato={trackLegatos?.[route.id] ?? false}
                    arp={trackArps?.[route.id]}
                    granular={trackGranulars?.[route.id]}
                    sidechain={trackSidechains?.[route.id]}
                    sidechainSources={sidechainSources}
                    speed={trackSpeeds?.[route.id] ?? 1}
                    loopRegion={trackLoopRegions?.[route.id]}
                    onLoopRegion={r => onTrackLoopRegion(route.id, r)}
                    gridResolution={trackGridResolutions?.[route.id]}
                    onGridResolution={rt => onGridResolution(route.id, rt)}
                    pitchVariety={trackPitchVariety?.[route.id]}
                    onPitchVariety={cfg => onPitchVariety(route.id, cfg)}
                    stopVelocities={trackStopVelocities?.[route.id]}
                    noteChance={trackNoteChances?.[route.id]}
                    onNoteChance={c => onNoteChance?.(route.id, c)}
                    noteLength={trackNoteLengths?.[route.id]}
                    onNoteLength={len => onNoteLength?.(route.id, len)}
                    stopChances={trackStopChances?.[route.id]}
                    loopPattern={trackLoopPatterns?.[route.id]}
                    onLoopPattern={p => onLoopPattern?.(route.id, p)}
                    onStopOpen={setEditingStop}
                    onSoundMode={m => onSoundMode(route.id, route.name, m)}
                    onScale={s => onScale(route.id, route.name, s)}
                    onSynthType={st => onSynthType(route.id, route.type, st)}
                    onADSR={p => onADSR(route.id, p)}
                    onSamplerPreset={id => onSamplerPreset(route.id, route.type, id)}
                    onDrumVoice={id => onDrumVoice(route.id, route.type, id)}
                    onSamplerUpload={(file, note) => onSamplerUpload(route.id, file, note)}
                    filter={trackFilters?.[route.id] ?? DEFAULT_FILTER}
                    getEqRuntime={() => getEqRuntime?.(route.id)}
                    onFilter={p => onFilter(route.id, p)}
                    onOctaveShift={shift => onOctaveShift(route.id, shift)}
                    onGlide={s => onGlide(route.id, s)}
                    onLegato={en => onLegato(route.id, en)}
                    onArp={params => onArp(route.id, params)}
                    onGranular={params => onGranular(route.id, params)}
                    onSidechain={params => onSidechain(route.id, params)}
                    onSpeed={m => onTrackSpeed(route.id, m)}
                    onDroneMode={en => onDroneMode(route.id, en)}
                    onDroneRoot={n => onDroneRoot(route.id, n)}
                    onAddLane={() => onAddAutomationLane(route.id)}
                    onExportRouteMidi={onExportRouteMidi}
                    onExportRouteAudio={onExportRouteAudio}
                    audioExportActive={audioExportActive}
                    tag={trackLabels?.[route.id]}
                    onOpenTag={() => setTagPrompt({ routeId: route.id, routeName: route.name })}
                    onDuplicate={() => setDupPrompt({ routeId: route.id, routeName: route.name })}
                    onRemoveDuplicate={() => onRemoveDuplicate?.(route.id)}
                    onChangeLine={onChangeLine ? () => setLinePicker({ mode: 'change', type: route.type, routeId: route.id }) : undefined}
                    perStopSteps={perStopStepsById?.[route.id]}
                    mergeMode={mergeMode}
                    mergeChecked={mergeSel.has(route.id)}
                    onMergeToggle={() => toggleMergeSel(route.id)}
                    onUnmerge={() => onUnmerge?.(route.id)}
                  />
                  {attachedSrcIds.map(srcId => (
                    <AutomationSourceTrack
                      key={srcId}
                      srcRoute={routeById[srcId]}
                      instRoute={route}
                      automationCfg={automationCfg}
                      srcGridResolution={trackGridResolutions?.[srcId]}
                    />
                  ))}
                  {lanes.map(([laneId, laneCfg]) => (
                    <AutomationLane
                      key={laneId}
                      laneId={laneId}
                      instRoute={route}
                      laneCfg={laneCfg}
                      allRoutes={routes ?? []}
                      activeFxTracks={activeFxTracks ?? []}
                      disabled={disabled}
                      soloRoutes={soloRoutes}
                      synthType={trackSynthTypes?.[route.id] ?? 'Synth'}
                      granularEnabled={!!trackGranulars?.[route.id]?.enabled}
                      started={started}
                      visible={visible}
                      srcLoopRegion={trackLoopRegions?.[laneCfg.sourceRouteId]}
                      srcGridResolution={trackGridResolutions?.[laneCfg.sourceRouteId]}
                      onUpdate={cfg => onUpdateAutomationLane(route.id, laneId, cfg)}
                      onRemove={() => onRemoveAutomationLane(route.id, laneId)}
                      onLiveValue={handleLiveAuto}
                    />
                  ))}
                </div>
              )
            })}
          </div>
        ))}

        {routes && onAddLine && (
          <div className="daw-add-line-row">
            <button
              className="daw-add-line-btn"
              onClick={() => setLinePicker({ mode: 'add' })}
              disabled={started}
              title="Add a transit line as a new lane"
            >＋ Add line</button>
          </div>
        )}

        {drumPattern && (
          <DrumLane
            pattern={drumPattern}
            muted={drumsMuted}
            started={started}
            visible={visible}
            onToggleStep={onToggleDrumStep}
            onTogglePadMute={onToggleDrumPadMute}
            onToggleMute={onToggleDrumsMute}
            onClear={onClearDrums}
            volume={drumVolume}
            filter={drumFilter}
            onVolume={onDrumVolume}
            onFilter={onDrumFilter}
            onSendLevel={onDrumSendLevel}
            getEqRuntime={getDrumEqRuntime}
            activeFxTracks={activeFxTracks}
            sendMatrix={sendMatrix}
          />
        )}

      </section>

      <EventLog visible={visible} />

      <DawFooter
        activeFxTracks={activeFxTracks ?? []}
        masterVolume={masterVolume ?? 0}
        masterChain={masterChain}
        onMasterChain={onMasterChain}
        fxBusWet={fxBusWet}
        fxBusMuted={fxBusMuted}
        fxBusSoloed={fxBusSoloed}
        fxBusParams={fxBusParams}
        onMasterVolume={onMasterVolume}
        onFxBusWet={onFxBusWet}
        onFxBusMute={onFxBusMute}
        onFxBusSolo={onFxBusSolo}
        onFxBusParam={onFxBusParam}
        onFxBusCustomIR={onFxBusCustomIR}
        onAddFxTrack={onAddFxTrack}
        onRemoveFxTrack={onRemoveFxTrack}
      />

      {editingStop && (
        <StopEditor
          key={`${editingStop.routeId}:${editingStop.stopId}`}
          editingStop={editingStop}
          onClose={() => setEditingStop(null)}
          onPitch={onStopPitch}
          onVelocity={onStopVelocity}
          onChance={onStopChance}
        />
      )}

      {tagPrompt && (
        <LaneTagEditor
          key={tagPrompt.routeId}
          routeName={tagPrompt.routeName}
          tag={trackLabels?.[tagPrompt.routeId]}
          onChange={patch => onLaneTag?.(tagPrompt.routeId, patch)}
          onClose={() => setTagPrompt(null)}
        />
      )}

      {dupPrompt && (
        <DuplicateLaneDialog
          routeName={dupPrompt.routeName}
          onClose={() => setDupPrompt(null)}
          onConfirm={(semitones) => { onDuplicateTrack?.(dupPrompt.routeId, semitones); setDupPrompt(null) }}
        />
      )}

      {linePicker && (
        <LinePicker
          mode={linePicker.mode}
          allRoutes={allRoutes ?? []}
          selectedIds={selectedIds}
          currentType={linePicker.type ?? null}
          currentRouteId={linePicker.routeId ?? null}
          onPick={(picked) => {
            if (linePicker.mode === 'add') onAddLine?.(picked)
            else onChangeLine?.(linePicker.routeId, picked)
            setLinePicker(null)
          }}
          onRemove={linePicker.mode === 'change'
            ? () => { onRemoveLine?.(linePicker.routeId); setLinePicker(null) }
            : undefined}
          onClose={() => setLinePicker(null)}
        />
      )}
    </div>
  )
}

// ── Drum lane (imported Drum Machine pattern, editable in-place) ─────────────
// A mini 6-pad step sequencer pinned to the bottom of the track list. Each pad
// shows the 16 visible steps (its 64-slot buffer windowed by the pad's offset);
// clicking a cell toggles it live. Mirrors DrumMachineTab's grid, DAW-scoped.
// ── Event log ────────────────────────────────────────────────────────────────
// Subscribes to the note feed itself (lib/shared/eventLogStore.js), so a note
// burst re-renders this list and nothing above it. Hidden → no subscription.
const noSubscribe = () => () => {}
function EventLog({ visible }) {
  const events = useSyncExternalStore(visible ? subscribeEvents : noSubscribe, getEvents, getEvents)
  return (
    <aside className="event-log">
      <h2>Event Log</h2>
      <ul>
        {events.slice(0, 24).map((ev, i) => (
          <li key={i}>
            <span className="ev-line">{ev.routeShortName ?? ev.lineId}</span>
            <span className="ev-stop">{ev.stopName}</span>
            <span className="ev-note">{ev.note}</span>
          </li>
        ))}
      </ul>
    </aside>
  )
}

function DrumLane({
  pattern, muted, started = false, visible = true, onToggleStep, onTogglePadMute, onToggleMute, onClear,
  volume = 0, filter, onVolume, onFilter, onSendLevel, getEqRuntime,
  activeFxTracks = [], sendMatrix = {},
}) {
  const [rackOpen, setRackOpen] = useState(false)
  // Playing-step highlight, drawn on the DOM from the shared ticker instead of
  // re-rendering the lane every step. After any render React may have rewritten
  // the step classNames, so forget the applied step and let the next frame redo it.
  const stepsRef = useRef(null)
  const playingStepRef = useRef(-1)
  useLayoutEffect(() => { playingStepRef.current = -1 })
  useEffect(() => {
    const root = stepsRef.current
    const clear = () => {
      root?.querySelectorAll('.drum-lane-step.playing').forEach(el => el.classList.remove('playing'))
      playingStepRef.current = -1
    }
    if (!started || !visible || !root) { clear(); return undefined }
    const unsubscribe = subscribePlayhead(() => {
      // Drum sequencer step (16th-note loop of DRUM_STEPS cells). The drum loop
      // is shorter than the 16-beat visual cycle, so derive it independently.
      const stepDur = (60 / (Tone.Transport.bpm.value || 120)) / 4
      const step = Math.floor(Tone.getTransport().seconds / stepDur) % DRUM_STEPS
      if (step === playingStepRef.current) return
      root.querySelectorAll('.drum-lane-step.playing').forEach(el => el.classList.remove('playing'))
      root.querySelectorAll(`.drum-lane-step[data-step="${step}"]`).forEach(el => el.classList.add('playing'))
      playingStepRef.current = step
    })
    return () => { unsubscribe(); clear() }
  }, [started, visible])
  const vol = Number.isFinite(volume) ? volume : 0
  return (
    <div className={`daw-section drum-section ${rackOpen ? 'drum-section--open' : ''}`}>
      <div className="daw-section-label">
        <span>Drums</span>
        <button
          className={`drum-lane-master-btn ${muted ? 'on' : ''}`}
          aria-pressed={muted}
          aria-label="Mute drums"
          onClick={onToggleMute}
          title={muted ? 'Unmute drums' : 'Mute drums'}
        >{muted ? 'Muted' : 'Mute'}</button>
        <span className="drum-lane-vol">
          <span className="drum-lane-vol-label">VOL</span>
          <input
            type="range" min="-40" max="6" step="1"
            value={vol} onChange={e => onVolume?.(Number(e.target.value))}
            aria-label="Drum lane volume" aria-valuetext={`${vol} dB`}
            className="volume-slider" title="Drum lane volume"
          />
          <span className="volume-val">{vol}dB</span>
        </span>
        <button
          className={`rack-toggle ${rackOpen ? 'active' : ''}`}
          onClick={() => setRackOpen(o => !o)}
          aria-expanded={rackOpen}
          title="Mixer: filter, EQ, sends"
        >FX <span className={`rack-chevron ${rackOpen ? 'up' : ''}`} aria-hidden="true">▾</span></button>
        <button
          className="drum-lane-master-btn"
          onClick={onClear}
          title="Remove drum lane"
        >× Remove</button>
      </div>

      {rackOpen && (
        <div className="device-rack drum-rack">
          <div className="rack-card">
            <div className="rack-card-head">Filter</div>
            <FilterPanel filter={filter} onFilter={onFilter} />
          </div>
          <div className="rack-card rack-card-eq">
            <div className="rack-card-head">EQ</div>
            <EqPanel getRuntime={getEqRuntime} />
          </div>
          {activeFxTracks?.length > 0 && (
            <div className="rack-card">
              <div className="rack-card-head">Sends</div>
              <div className="line-sends">
                {activeFxTracks.map(busId => {
                  const bus   = FX_BUSES.find(b => b.id === busId)
                  const level = sendMatrix?.[`${DRUMS_ROUTE_ID}:${busId}`] ?? 0
                  return (
                    <div key={busId} className="line-send-row">
                      <span className="line-send-label">→ {bus?.label ?? busId}</span>
                      <input
                        type="range" min="0" max="1" step="0.01"
                        value={level}
                        onChange={e => onSendLevel?.(busId, parseFloat(e.target.value))}
                        aria-label={`Drums send to ${bus?.label ?? busId}`}
                        aria-valuetext={`${Math.round(level * 100)}%`}
                        className="line-send-slider"
                      />
                      <span className="line-send-val">{Math.round(level * 100)}%</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      <div ref={stepsRef} className={`drum-lane ${muted ? 'drum-lane--muted' : ''}`}>
        {DRUM_PAD_DEFS.map(pad => {
          const padPat   = pattern.patterns?.[pad.id] ?? emptyDrumPattern()
          const offset   = pattern.offsets?.[pad.id] ?? 0
          const padMuted = !!pattern.muted?.[pad.id]
          return (
            <div key={pad.id} className={`drum-lane-row ${padMuted ? 'is-muted' : ''}`}>
              <span className="drum-lane-name">{pad.label}</span>
              <button
                className={`drum-lane-mute ${padMuted ? 'on' : ''}`}
                onClick={() => onTogglePadMute(pad.id)}
                aria-pressed={padMuted}
                aria-label={`Mute ${pad.label}`}
                title="Mute pad"
              >M</button>
              <div className="drum-lane-steps">
                {Array.from({ length: DRUM_STEPS }).map((_, i) => {
                  const src   = (offset + i) % DRUM_SOURCE_STEPS
                  const vel   = padPat[src]
                  // Old snapshots store booleans (true → full); numbers are velocities.
                  const v     = typeof vel === 'number' ? vel : (vel ? 1 : 0)
                  const level = !v ? '' : v >= 0.85 ? 'vel-accent' : v >= 0.55 ? 'vel-norm' : 'vel-soft'
                  return (
                    <button
                      key={i}
                      data-step={i}
                      className={[
                        'drum-lane-step',
                        v ? 'on' : '',
                        level,
                        i % 4 === 0 ? 'beat' : '',
                      ].filter(Boolean).join(' ')}
                      onClick={() => onToggleStep(pad.id, i)}
                      aria-label={`${pad.label} step ${i + 1}${v ? `, velocity ${Math.round(v * 100)}%` : ''}`}
                      aria-pressed={!!v}
                      title={v ? `vel ${Math.round(v * 100)}% — click to cycle` : 'click to cycle velocity'}
                    />
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Individual instrument track row ──────────────────────────────────────────
function LineTrack({
  route, mode, started, visible = true, volume, disabled, pan, isSoloed,
  vehicles, soundMode, trackScale, synthType, adsr,
  filter, getEqRuntime,
  droneMode, droneRoot,
  laneCount, autoTargets = {}, activeFxTracks, sendMatrix, octaveShift, semitoneShift, glide, legato, arp, granular, sidechain, sidechainSources, speed,
  loopRegion, onLoopRegion, gridResolution, onGridResolution,
  pitchVariety, onPitchVariety,
  stopVelocities, onStopOpen,
  noteChance, onNoteChance, stopChances, loopPattern, onLoopPattern,
  noteLength, onNoteLength,
  onVolume, onDisable, onPan, onSolo, onSoundMode, onScale, onSynthType, onADSR,
  onSamplerPreset, onDrumVoice, onSamplerUpload,
  onFilter,
  onSendLevel, onOctaveShift, onGlide, onLegato, onArp, onGranular, onSidechain, onSpeed, onDroneMode, onDroneRoot, onAddLane,
  onExportRouteMidi, onExportRouteAudio, audioExportActive,
  onDuplicate, onRemoveDuplicate, onChangeLine, perStopSteps,
  mergeMode, mergeChecked, onMergeToggle, onUnmerge,
  tag, onOpenTag,
}) {
  const laneTag = normalizeLaneTag(tag)
  const [rackOpen, setRackOpen] = useState(false)
  const isDuplicate = !!route.isDuplicate
  const isMerged    = !!route.isMerged
  // Only plain base lanes can be folded into a merged lane.
  const mergeEligible = mergeMode && !isMerged && !isDuplicate

  // Automation locks: when a lane targets one of these, the control greys out and (during
  // playback) reads the swept value. Pan/glide convert from the spec unit to the slider unit.
  const aVol = autoCtl(autoTargets, 'volume')
  const aPan = autoCtl(autoTargets, 'pan',   { divide: 100 })
  const aGli = autoCtl(autoTargets, 'glide', { divide: 1000 })
  const volDisp = aVol.display != null ? Math.round(aVol.display) : volume
  const panDisp = aPan.display != null ? aPan.display : pan
  const gliDisp = aGli.display != null ? aGli.display : (glide ?? 0)

  // All reset gestures are created here, unconditionally: three of these controls live inside
  // the collapsible device rack, and calling the hook down there made the hook count jump when
  // the rack opened (React error #310 — "rendered more hooks than during the previous render").
  const panReset     = useResetGesture(() => { if (!aPan.disabled) onPan(0) })
  const varietyReset = useResetGesture(() => onPitchVariety({ variety: 0 }))
  const glideReset   = useResetGesture(() => { if (!aGli.disabled) onGlide(0) })
  const arpGateReset = useResetGesture(() => onArp({ gate: 0.5 }))
  const chanceReset  = useResetGesture(() => onNoteChance(1))

  const laneChance  = normalizeNoteChance(noteChance)
  // Memoized: StopRail's playhead effect depends on it, and a fresh object per
  // render would restart that rAF loop on every re-render.
  const pattern     = useMemo(() => normalizeLoopPattern(loopPattern), [loopPattern])
  const patternText = formatLoopPattern(pattern)

  return (
    <div
      className={[
        'line-track',
        disabled ? 'line-track--disabled' : '',
        rackOpen ? 'line-track--open' : '',
        laneTag.color ? 'line-track--tagged' : '',
      ].filter(Boolean).join(' ')}
      // The colour rides in as a custom property rather than a resolved border
      // shorthand, so the chip below and the box edge can't disagree, and CSS
      // still owns the width.
      style={laneTag.color ? { '--lane-tag-color': laneTag.color } : undefined}
      data-tour="lane"
    >
      <div className="lt-top">
        <div className="line-label" style={{ borderColor: route.color }}>
          <div className="line-label-top">
            {mergeEligible && (
              <input
                type="checkbox"
                className="merge-check"
                checked={!!mergeChecked}
                onChange={onMergeToggle}
                title="Include this lane in the merge"
              />
            )}
            <span className="line-badge" style={{ background: route.color, color: route.textColor }}>
              {route.name}
            </span>
            {isDuplicate && <span className="dup-badge" title="Chord copy — re-pitched within harmony">copy</span>}
            {isMerged && <span className="dup-badge merged-badge" title="Merged PolySynth chord lane">merged</span>}
            {laneChance < 1 && (
              <span className="dup-badge gate-badge" title={`Each note plays with ${Math.round(laneChance * 100)}% chance`}>
                {Math.round(laneChance * 100)}%
              </span>
            )}
            {patternText && (
              <span className="dup-badge gate-badge" title={`Plays ${pattern.play} loop(s), rests ${pattern.rest}`}>
                {patternText}
              </span>
            )}
            {/* Role label. Untagged lanes keep a faint placeholder rather than
                nothing at all — otherwise the feature is undiscoverable. */}
            <button
              className={`lane-tag-chip ${laneTag.text ? 'has-text' : ''} ${laneTag.color ? 'is-colored' : ''}`}
              style={laneTag.color ? { '--lane-tag-color': laneTag.color } : undefined}
              onClick={onOpenTag}
              title="Label this lane (bass, lead, pad…)"
            >
              {laneTag.text || 'label'}
            </button>
            <button
              className={`add-lane-btn lane-icon-btn ${laneCount > 0 ? 'has-lanes' : ''}`}
              onClick={onAddLane}
              aria-label="Add automation lane"
              data-tooltip="Add automation lane"
            >
              {laneCount > 0 ? `+${laneCount}` : '+'}
            </button>
          </div>
          {isMerged && route.sourceRoutes?.length ? (
            <div className="merge-legend" title="Lanes folded into this chord lane">
              {route.sourceRoutes.map(src => (
                <span key={src.id} className="merge-legend-chip">
                  <span className="merge-legend-swatch" style={{ background: src.color }} />
                  {src.name}
                </span>
              ))}
            </div>
          ) : (
            <span className="line-desc">{route.desc}</span>
          )}
        </div>

        <div className="lt-mix">
          <button className={`disable-btn lane-icon-btn ${disabled ? 'active' : ''}`} onClick={onDisable} aria-pressed={!disabled} aria-label={`Enable ${route.name}`} data-tooltip={disabled ? 'Enable track' : 'Disable track'}>⏻</button>
          <button className={`solo-btn lane-icon-btn ${isSoloed ? 'active' : ''}`} onClick={onSolo} aria-pressed={isSoloed} aria-label={`Solo ${route.name}`} data-tooltip="Solo · Cmd/Ctrl-click to add">S</button>
          <input type="range" min="-40" max="6" step="1"
            value={volDisp} onChange={e => onVolume(Number(e.target.value))}
            aria-label={`${route.name} volume`} aria-valuetext={`${volDisp} dB`}
            disabled={aVol.disabled} className="volume-slider" />
          <span className="volume-val">{volDisp}dB</span>
          <span className="lt-mix-sep" />
          <span className="pan-label">PAN</span>
          <input type="range" min="-1" max="1" step="0.01"
            value={panDisp} onChange={e => onPan(parseFloat(e.target.value))}
            {...panReset}
            aria-label={`${route.name} pan`}
            aria-valuetext={panDisp === 0 ? 'center' : panDisp < 0 ? `left ${Math.round(-panDisp * 100)}` : `right ${Math.round(panDisp * 100)}`}
            disabled={aPan.disabled} className="pan-slider" />
          <span className="pan-val">
            {panDisp === 0 ? 'C' : panDisp < 0 ? `L${Math.round(-panDisp * 100)}` : `R${Math.round(panDisp * 100)}`}
          </span>
          <span className="lt-mix-sep" />
          <button
            type="button"
            className="midi-export-btn lane-icon-btn lane-export-btn"
            onClick={() => onExportRouteMidi?.(route.id)}
            disabled={!route.stops?.length}
            aria-label={`Download ${route.name} as MIDI`}
            data-tooltip="Download MIDI"
          >MIDI</button>
          <button
            type="button"
            className="midi-export-btn wav-export-btn lane-icon-btn lane-export-btn"
            onClick={() => onExportRouteAudio?.(route.id)}
            disabled={!route.stops?.length || !audioExportActive}
            aria-label={`Record ${route.name} as WAV`}
            data-tooltip="Record WAV · play first"
          >WAV</button>
        </div>

        <div className="lt-spacer" />

        {!isMerged && !isDuplicate && onChangeLine && (
          <button
            type="button"
            className="change-line-btn lane-icon-btn"
            onClick={onChangeLine}
            disabled={started}
            aria-label={`Change ${route.name} transit line`}
            data-tooltip="Change transit line"
          >⇄</button>
        )}
        {!isMerged && (
          <button
            type="button"
            className="dup-btn lane-icon-btn"
            onClick={onDuplicate}
            aria-label={`Duplicate ${route.name}`}
            data-tooltip="Duplicate lane · stack a chord"
          >⎘</button>
        )}
        {isDuplicate && (
          <button
            type="button"
            className="dup-remove-btn lane-icon-btn"
            onClick={onRemoveDuplicate}
            aria-label={`Remove ${route.name} copy`}
            data-tooltip="Remove this copy"
          >×</button>
        )}
        {isMerged && (
          <button
            type="button"
            className="dup-remove-btn lane-icon-btn"
            onClick={onUnmerge}
            aria-label={`Un-merge ${route.name}`}
            data-tooltip="Un-merge · restore original lanes"
          >×</button>
        )}

        <button
          className={`rack-toggle ${rackOpen ? 'active' : ''}`}
          onClick={() => setRackOpen(o => !o)}
          title={rackOpen ? 'Collapse device rack' : 'Expand device rack'}
          aria-expanded={rackOpen}
        >
          DEVICE RACK
          <span className={`rack-chevron ${rackOpen ? 'up' : ''}`}>▾</span>
        </button>
      </div>

      <StopRail
        route={route}
        visible={visible}
        speed={speed ?? 1}
        started={started}
        mode={mode}
        vehicles={vehicles}
        trackScale={trackScale}
        octaveShift={octaveShift ?? 0}
        semitoneShift={semitoneShift ?? 0}
        loopRegion={loopRegion}
        onLoopRegion={onLoopRegion}
        gridResolution={gridResolution}
        pitchVariety={pitchVariety}
        stopVelocities={stopVelocities}
        perStopSteps={perStopSteps}
        onStopOpen={onStopOpen}
        laneChance={laneChance}
        stopChances={stopChances}
        loopPattern={pattern}
      />

      {rackOpen && (
        <>
          <div className="rack-domain-key" aria-label="Device groups">
            <span className="rack-domain-key-item rack-domain-key-item--sound">
              <span className="rack-domain-key-dot" aria-hidden="true" />
              <strong>Tone &amp; pitch</strong>
              <small>what the lane sounds like</small>
            </span>
            <span className="rack-domain-key-item rack-domain-key-item--rhythm">
              <span className="rack-domain-key-dot" aria-hidden="true" />
              <strong>Rhythm &amp; movement</strong>
              <small>when and how notes move</small>
            </span>
          </div>

          <div className="device-rack">
          <div className="rack-card rack-card--sound">
            <div className="rack-card-head">Instrument</div>
            <select
              className="synth-select"
              value={synthType}
              onChange={e => onSynthType(e.target.value)}
              aria-label="Instrument type"
            >
              {pickerSynthTypes(synthType).map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          <div className="rack-card rack-card--sound">
            <div className="rack-card-head">Pitch map</div>
            <div className="sound-mode-row">
              <select className="scale-root-select" value={trackScale.root}
                onChange={e => onScale({ ...trackScale, root: e.target.value })}
                aria-label="Root note">
                {NOTE_ROOTS.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
              <select className="scale-type-select" value={trackScale.scaleType}
                onChange={e => onScale({ ...trackScale, scaleType: e.target.value })}
                aria-label="Scale">
                {SCALE_TYPES.map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>
            {(() => {
              const pv = { ...DEFAULT_PITCH_VARIETY, ...pitchVariety }
              return (
                <>
                  <div className="speed-row">
                    <span className="speed-label">SHAPE</span>
                    <div className="speed-btns">
                      {PITCH_CONTOURS.map(c => (
                        <button
                          key={c}
                          className={`speed-btn ${pv.contour === c ? 'active' : ''}`}
                          style={pv.contour === c ? { borderColor: route.color, color: route.color } : {}}
                          onClick={() => onPitchVariety({ contour: c })}
                          title={CONTOUR_TITLES[c]}
                        >
                          {CONTOUR_LABELS[c] ?? c}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="glide-row">
                    <span className="glide-label">VAR</span>
                    <input
                      type="range" min="0" max="1" step="0.01"
                      value={pv.variety}
                      aria-label={`${route.name} pitch variety`}
                      aria-valuetext={`${Math.round(pv.variety * 100)}%`}
                      onChange={e => onPitchVariety({ variety: parseFloat(e.target.value) })}
                      {...varietyReset}
                      className="glide-slider"
                      title="Pitch variety — 0% keeps the selected contour pure; higher adds seeded jitter and gap accents"
                    />
                    <span className="glide-val">{Math.round(pv.variety * 100)}%</span>
                  </div>
                </>
              )
            })()}
          </div>

          <div className="rack-card rack-card--sound">
            <div className="rack-card-head">{synthType}</div>
            <EnvPanel synthType={synthType} adsr={adsr} onADSR={onADSR} onSamplerPreset={onSamplerPreset} onDrumVoice={onDrumVoice} onSamplerUpload={onSamplerUpload} autoTargets={autoTargets} />
          </div>

          <div className="rack-card rack-card--sound">
            <div className="rack-card-head">Filter</div>
            <FilterPanel filter={filter} onFilter={onFilter} autoTargets={autoTargets} />
          </div>

          <div className="rack-card rack-card-eq rack-card--sound">
            <div className="rack-card-head">EQ</div>
            <EqPanel getRuntime={getEqRuntime} />
          </div>

          <div className="rack-card rack-card--sound">
            <div className="rack-card-head">Expression</div>
            <div className="octave-row">
              <span className="octave-label">OCT</span>
              <button className="octave-btn" onClick={() => onOctaveShift(Math.max(-2, octaveShift - 1))}>−</button>
              <span className="octave-val">{octaveShift >= 0 ? `+${octaveShift}` : octaveShift}</span>
              <button className="octave-btn" onClick={() => onOctaveShift(Math.min(2, octaveShift + 1))}>+</button>
            </div>
            <div className="glide-row">
              <span className="glide-label">GLIDE</span>
              <input
                type="range" min="0" max="1" step="0.01"
                value={gliDisp}
                aria-label={`${route.name} glide`}
                aria-valuetext={`${Math.round(gliDisp * 100)}%`}
                onChange={e => onGlide(parseFloat(e.target.value))}
                {...glideReset}
                disabled={aGli.disabled}
                className="glide-slider"
              />
              <span className="glide-val">{Math.round(gliDisp * 1000)}ms</span>
              <button
                className={`legato-btn ${legato ? 'active' : ''}`}
                onClick={() => onLegato(!legato)}
                title={legato ? 'Legato on — click to disable' : 'Enable legato (hold + glide)'}
                style={legato ? { borderColor: route.color, color: route.color } : {}}
              >LEG</button>
            </div>
          </div>

          <div className="rack-card rack-card--rhythm">
            <div className="rack-card-head">Timing</div>
            <div className="speed-row">
              <span className="speed-label">SPEED</span>
              <div className="speed-btns">
                {SPEED_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    className={`speed-btn ${(speed ?? 1) === opt.value ? 'active' : ''}`}
                    style={(speed ?? 1) === opt.value ? { borderColor: route.color, color: route.color } : {}}
                    onClick={() => onSpeed(opt.value)}
                    title={opt.title}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="speed-row">
              <span className="speed-label">GRID</span>
              <div className="speed-btns">
                {ARP_RATES.map(rt => (
                  <button
                    key={rt}
                    className={`speed-btn ${(gridResolution ?? DEFAULT_GRID_RESOLUTION) === rt ? 'active' : ''}`}
                    style={(gridResolution ?? DEFAULT_GRID_RESOLUTION) === rt ? { borderColor: route.color, color: route.color } : {}}
                    onClick={() => onGridResolution(rt)}
                    title={`Note grid: ${ARP_RATE_LABELS[rt] ?? rt}`}
                  >
                    {ARP_RATE_LABELS[rt] ?? rt}
                  </button>
                ))}
              </div>
            </div>
            <div className="speed-row">
              <span className="speed-label">LENGTH</span>
              <div
                className="speed-btns"
                title={legato || arp?.enabled || synthType === 'PluckSynth'
                  ? 'Note length — no effect while legato, the arpeggiator or PluckSynth is in use'
                  : 'How long each note is held before its release'}
              >
                {NOTE_LENGTHS.map(len => {
                  const on = (noteLength ?? DEFAULT_NOTE_LENGTH) === len
                  return (
                    <button
                      key={len}
                      className={`speed-btn ${on ? 'active' : ''}`}
                      style={on ? { borderColor: route.color, color: route.color } : {}}
                      onClick={() => onNoteLength?.(len)}
                    >
                      {NOTE_LENGTH_LABELS[len]}
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="glide-row">
              <span className="glide-label">CHANCE</span>
              <input
                type="range" min="0" max="1" step="0.05"
                value={laneChance}
                aria-label={`${route.name} note chance`}
                aria-valuetext={`${Math.round(laneChance * 100)}%`}
                onChange={e => onNoteChance(parseFloat(e.target.value))}
                {...chanceReset}
                className="glide-slider"
                title="Note chance — each note rolls fresh dice every loop. Double-click for 100%"
              />
              <span className="glide-val">{Math.round(laneChance * 100)}%</span>
            </div>
            <div className="speed-row">
              <span className="speed-label">LOOPS</span>
              <div className="speed-btns">
                {LOOP_PATTERN_PRESETS.map(pr => {
                  const on = pattern.play === pr.play && pattern.rest === pr.rest
                  return (
                    <button
                      key={pr.id}
                      className={`speed-btn ${on ? 'active' : ''}`}
                      style={on ? { borderColor: route.color, color: route.color } : {}}
                      onClick={() => onLoopPattern({ play: pr.play, rest: pr.rest, offset: pr.rest ? pattern.offset : 0 })}
                      title={pr.title}
                    >
                      {pr.label}
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="speed-row loop-pattern-steppers">
              {[
                { key: 'play',   label: 'PLAY', min: 1, max: MAX_PATTERN_PLAY, title: 'Loops played in a row' },
                { key: 'rest',   label: 'REST', min: 0, max: MAX_PATTERN_REST, title: 'Loops skipped after playing' },
                { key: 'offset', label: 'SHIFT', min: 0, max: pattern.play + pattern.rest - 1, title: 'Shift which loop the pattern starts on — offset two lanes to make them take turns' },
              ].map(f => (
                <span key={f.key} className="loop-stepper" title={f.title}>
                  <span className="speed-label">{f.label}</span>
                  <button className="octave-btn" disabled={pattern[f.key] <= f.min}
                    onClick={() => onLoopPattern({ ...pattern, [f.key]: pattern[f.key] - 1 })}>−</button>
                  <span className="octave-val">{pattern[f.key]}</span>
                  <button className="octave-btn" disabled={pattern[f.key] >= f.max}
                    onClick={() => onLoopPattern({ ...pattern, [f.key]: pattern[f.key] + 1 })}>+</button>
                </span>
              ))}
            </div>
          </div>

          {(() => {
            const ag = { ...DEFAULT_ARP, ...arp }
            const arpOn = !!ag.enabled
            const dim = arpOn ? {} : { opacity: 0.4, pointerEvents: 'none' }
            return (
              <div className="rack-card rack-card--rhythm">
                <div className="rack-card-head">
                  Arpeggiator
                  <button
                    className={`legato-btn ${arpOn ? 'active' : ''}`}
                    onClick={() => onArp({ enabled: !arpOn })}
                    title={arpOn ? 'Arpeggiator on — click to disable' : 'Enable arpeggiator (stop note = root)'}
                    style={{ marginLeft: 'auto', ...(arpOn ? { borderColor: route.color, color: route.color } : {}) }}
                  >ARP</button>
                </div>

                <div className="speed-row" style={dim}>
                  <span className="speed-label">STYLE</span>
                  <div className="speed-btns">
                    {ARP_STYLES.map(st => (
                      <button
                        key={st}
                        className={`speed-btn ${ag.style === st ? 'active' : ''}`}
                        style={ag.style === st ? { borderColor: route.color, color: route.color } : {}}
                        onClick={() => onArp({ style: st })}
                        title={ARP_STYLE_LABELS[st] ?? st}
                      >{ARP_STYLE_LABELS[st] ?? st}</button>
                    ))}
                  </div>
                </div>

                <div className="speed-row" style={dim}>
                  <span className="speed-label">RATE</span>
                  <div className="speed-btns">
                    {ARP_RATES.map(rt => (
                      <button
                        key={rt}
                        className={`speed-btn ${ag.rate === rt ? 'active' : ''}`}
                        style={ag.rate === rt ? { borderColor: route.color, color: route.color } : {}}
                        onClick={() => onArp({ rate: rt })}
                        title={`Step rate ${ARP_RATE_LABELS[rt] ?? rt}`}
                      >{ARP_RATE_LABELS[rt] ?? rt}</button>
                    ))}
                  </div>
                </div>

                <div className="octave-row" style={dim}>
                  <span className="octave-label">OCT</span>
                  <button className="octave-btn" onClick={() => onArp({ octaves: Math.max(1, ag.octaves - 1) })}>−</button>
                  <span className="octave-val">{ag.octaves}</span>
                  <button className="octave-btn" onClick={() => onArp({ octaves: Math.min(4, ag.octaves + 1) })}>+</button>
                  <span className="octave-label" style={{ marginLeft: 10 }}>STEPS</span>
                  <button className="octave-btn" onClick={() => onArp({ steps: Math.max(1, ag.steps - 1) })}>−</button>
                  <span className="octave-val">{ag.steps}</span>
                  <button className="octave-btn" onClick={() => onArp({ steps: Math.min(6, ag.steps + 1) })}>+</button>
                </div>

                <div className="octave-row" style={dim}>
                  <span className="octave-label">DIST</span>
                  <button className="octave-btn" onClick={() => onArp({ distance: Math.max(1, ag.distance - 1) })}>−</button>
                  <span className="octave-val">{ag.distance}</span>
                  <button className="octave-btn" onClick={() => onArp({ distance: Math.min(4, ag.distance + 1) })}>+</button>
                </div>

                <div className="glide-row" style={dim}>
                  <span className="glide-label">GATE</span>
                  <input
                    type="range" min="0.05" max="2" step="0.05"
                    value={ag.gate}
                    aria-label={`${route.name} arpeggiator gate`}
                    aria-valuetext={`${Math.round(ag.gate * 100)}%`}
                    onChange={e => onArp({ gate: parseFloat(e.target.value) })}
                    {...arpGateReset}
                    className="glide-slider"
                  />
                  <span className="glide-val">{Math.round(ag.gate * 100)}%</span>
                </div>
              </div>
            )
          })()}

          {(() => {
            const gg = { ...DEFAULT_GRANULAR, ...granular }
            const grainOn = !!gg.enabled
            const dim = grainOn ? {} : { opacity: 0.4, pointerEvents: 'none' }
            // Sliders mirror live grain.* automation (greyed + swept value) like
            // the other instrument controls.
            const grainRow = (label, key, min, max, step, fmt) => {
              const a = autoCtl(autoTargets, `grain.${key}`)
              const val = a.display ?? gg[key]
              return (
                <div className="glide-row" style={dim}>
                  <span className="glide-label">{label}</span>
                  <input
                    type="range" min={min} max={max} step={step}
                    value={val}
                    disabled={a.disabled}
                    aria-label={`${route.name} grain ${label}`}
                    aria-valuetext={a.disabled ? 'automated' : String(fmt(val))}
                    onChange={e => onGranular({ [key]: parseFloat(e.target.value) })}
                    className="glide-slider"
                  />
                  <span className="glide-val">{a.disabled ? 'auto' : fmt(val)}</span>
                </div>
              )
            }
            const pct = v => `${Math.round(v * 100)}%`
            const ms  = v => `${Math.round(v * 1000)}ms`
            return (
              <div className="rack-card rack-card--sound">
                <div className="rack-card-head">
                  Granular
                  <button
                    className={`legato-btn ${grainOn ? 'active' : ''}`}
                    onClick={() => onGranular({ enabled: !grainOn })}
                    title={grainOn
                      ? 'Granular layer on — click to disable'
                      : 'Layer a grain cloud rendered from this track’s instrument'}
                    style={{ marginLeft: 'auto', ...(grainOn ? { borderColor: route.color, color: route.color } : {}) }}
                  >GRAIN</button>
                </div>

                {grainRow('MIX',   'mix',          0,    1,   0.01,  pct)}
                {grainRow('SIZE',  'grainSize',    0.01, 0.5, 0.005, ms)}
                {grainRow('OVLP',  'overlap',      0.01, 0.5, 0.005, ms)}
                {grainRow('RATE',  'playbackRate', 0.25, 4,   0.01,  v => `${Number(v).toFixed(2)}×`)}
                {grainRow('LP ST', 'loopStart',    0,    1,   0.01,  pct)}
                {grainRow('LP EN', 'loopEnd',      0,    1,   0.01,  pct)}
                {grainRow('JITR',  'jitter',       0,    1,   0.01,  pct)}

                <div className="speed-row" style={dim}>
                  <span className="speed-label">DIR</span>
                  <div className="speed-btns">
                    <button
                      className={`speed-btn ${!gg.reverse ? 'active' : ''}`}
                      style={!gg.reverse ? { borderColor: route.color, color: route.color } : {}}
                      onClick={() => onGranular({ reverse: false })}
                    >FWD</button>
                    <button
                      className={`speed-btn ${gg.reverse ? 'active' : ''}`}
                      style={gg.reverse ? { borderColor: route.color, color: route.color } : {}}
                      onClick={() => onGranular({ reverse: true })}
                    >REV</button>
                  </div>
                </div>

                <div className="glide-row" style={dim}>
                  <span className="glide-label">ATK</span>
                  <input
                    type="range" min="0" max="2" step="0.005"
                    value={gg.attack}
                    aria-label={`${route.name} grain attack`}
                    aria-valuetext={String(ms(gg.attack))}
                    onChange={e => onGranular({ attack: parseFloat(e.target.value) })}
                    className="glide-slider"
                  />
                  <span className="glide-val">{ms(gg.attack)}</span>
                </div>
                <div className="glide-row" style={dim}>
                  <span className="glide-label">REL</span>
                  <input
                    type="range" min="0.01" max="6" step="0.01"
                    value={gg.release}
                    aria-label={`${route.name} grain release`}
                    aria-valuetext={`${Number(gg.release).toFixed(2)} s`}
                    onChange={e => onGranular({ release: parseFloat(e.target.value) })}
                    className="glide-slider"
                  />
                  <span className="glide-val">{Number(gg.release).toFixed(2)}s</span>
                </div>
              </div>
            )
          })()}

          {(() => {
            const sc = { ...DEFAULT_SIDECHAIN, ...sidechain }
            // Without a source there is nothing to duck off, so the toggle stays
            // inert until one is picked — no silently-on-but-doing-nothing state.
            const scOn = !!sc.enabled && !!sc.source
            const dim = scOn ? {} : { opacity: 0.4, pointerEvents: 'none' }
            const scRow = (label, key, min, max, step, fmt) => (
              <div className="glide-row" style={dim}>
                <span className="glide-label">{label}</span>
                <input
                  type="range" min={min} max={max} step={step}
                  value={sc[key]}
                  aria-label={`${route.name} sidechain ${label}`}
                  aria-valuetext={String(fmt(sc[key]))}
                  onChange={e => onSidechain({ [key]: parseFloat(e.target.value) })}
                  className="glide-slider"
                />
                <span className="glide-val">{fmt(sc[key])}</span>
              </div>
            )
            const ms = v => `${Math.round(v * 1000)}ms`
            return (
              <div className="rack-card rack-card--rhythm">
                <div className="rack-card-head">
                  Sidechain
                  <button
                    className={`legato-btn ${scOn ? 'active' : ''}`}
                    onClick={() => onSidechain({ enabled: !sc.enabled })}
                    disabled={!sc.source}
                    title={sc.source
                      ? (scOn ? 'Ducking on — click to disable' : 'Duck this lane when the trigger fires')
                      : 'Pick a trigger source first'}
                    style={{ marginLeft: 'auto', ...(scOn ? { borderColor: route.color, color: route.color } : {}) }}
                  >SC</button>
                </div>

                <div className="glide-row">
                  <span className="glide-label">FROM</span>
                  <select
                    className="auto-select"
                    value={sc.source}
                    onChange={e => {
                      const source = e.target.value
                      // Clearing the source turns ducking off rather than leaving
                      // an enabled sidechain with nothing to trigger it.
                      onSidechain(source ? { source } : { source: '', enabled: false })
                    }}
                    title="What this lane ducks away from"
                  >
                    <SidechainSourceOptions sources={sidechainSources} excludeId={route.id} />
                  </select>
                </div>

                {scRow('AMT', 'amountDb', -40, 0,    1,     v => `${Math.round(v)}dB`)}
                {scRow('ATK', 'attack',     0, 0.2,  0.001, ms)}
                {scRow('REL', 'release',  0.02, 1.5, 0.01,  ms)}
              </div>
            )
          })()}

          {activeFxTracks?.length > 0 && (
            <div className="rack-card rack-card--sound">
              <div className="rack-card-head">Sends</div>
              <div className="line-sends">
                {activeFxTracks.map(busId => {
                  const bus   = FX_BUSES.find(b => b.id === busId)
                  const aSend = autoCtl(autoTargets, `send.${busId}`)
                  const level = aSend.display != null ? aSend.display : (sendMatrix?.[`${route.id}:${busId}`] ?? 0)
                  return (
                    <div key={busId} className="line-send-row">
                      <span className="line-send-label">→ {bus?.label ?? busId}</span>
                      <input
                        type="range" min="0" max="1" step="0.01"
                        value={level}
                        onChange={e => onSendLevel(busId, parseFloat(e.target.value))}
                        aria-label={`${route.name} send to ${bus?.label ?? busId}`}
                        aria-valuetext={`${Math.round(level * 100)}%`}
                        disabled={aSend.disabled}
                        className="line-send-slider"
                      />
                      <span className="line-send-val">{Math.round(level * 100)}%</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          </div>
        </>
      )}
    </div>
  )
}

// ── Automation lane (sub-row below instrument track) ─────────────────────────
function AutomationLane({ laneId, instRoute, laneCfg, allRoutes, activeFxTracks, disabled, soloRoutes, synthType = 'Synth', granularEnabled = false, started = false, visible = true, srcLoopRegion, srcGridResolution, onUpdate, onRemove, onLiveValue }) {
  const sourceRouteId = laneCfg?.sourceRouteId ?? ''
  const paramTarget   = laneCfg?.paramTarget   ?? 'volume'
  const points        = laneCfg?.points        ?? {}
  const speed         = laneCfg?.speed         ?? 1
  const glide         = laneCfg?.glide         ?? 0
  // Per-lane sub-loop; falls back to the source line's region until the user drags handles.
  const effectiveRegion = laneCfg?.loopRegion ?? srcLoopRegion

  // Report the value currently in effect (or null) up to DawView, which mirrors it onto
  // the matching instrument-lane control. Clear on unmount / target change so a stale lane
  // frees its lock. `onLiveValue` is DawView's stable handler keyed by (routeId, laneId).
  const routeId = instRoute.id
  const handleActiveValue = useCallback(
    v => onLiveValue?.(routeId, laneId, paramTarget, v),
    [onLiveValue, routeId, laneId, paramTarget],
  )
  useEffect(
    () => () => onLiveValue?.(routeId, laneId, paramTarget, null),
    [onLiveValue, routeId, laneId, paramTarget],
  )

  const sourceRoute    = allRoutes.find(r => r.id === sourceRouteId) ?? null
  // Any lane (active or not) can be a source: a source now stays visible and audible
  // in its own section while its geographic data also drives this automation curve.
  // A merged lane has no per-stop geography of its own, so it can't be a source.
  const pickableRoutes = allRoutes.filter(r => r.id !== instRoute.id && !r.isMerged)

  // Target options, grouped by .group, filtered to what's valid for this synth type.
  const groupedTargets = useMemo(() => {
    const groups = {}
    for (const t of availableAutomationTargets(synthType, activeFxTracks ?? [], granularEnabled)) {
      const g = t.group ?? 'Other'
      ;(groups[g] ??= []).push(t)
    }
    return groups
  }, [synthType, activeFxTracks, granularEnabled])

  return (
    <div className="automation-lane">
      <div className="auto-lane-label">
        <span className="auto-lane-badge">AUTO</span>
      </div>

      <div className="auto-lane-controls">
        <select className="auto-select auto-select--source-line" value={sourceRouteId}
          onChange={e => onUpdate({ sourceRouteId: e.target.value })}>
          <option value="">— pick line —</option>
          {pickableRoutes.map(r => {
            // Some cities (e.g. NYC/MTA) carry paragraph-length descriptions; native <option>
            // text can't be CSS-truncated, so cap it here or the dropdown popup overflows.
            const desc = r.desc && r.desc.length > 48 ? `${r.desc.slice(0, 48).trimEnd()}…` : r.desc
            return (
              <option key={r.id} value={r.id}>
                {r.name}{desc ? ` · ${desc}` : ''}
              </option>
            )
          })}
        </select>

        <select className="auto-select" value={paramTarget}
          onChange={e => onUpdate({ paramTarget: e.target.value })}>
          {Object.entries(groupedTargets).map(([group, targets]) => (
            <optgroup key={group} label={group}>
              {targets.map(t => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </optgroup>
          ))}
        </select>

        <button className="auto-remove-btn" onClick={onRemove} title="Remove lane">×</button>

        <div className="speed-row auto-speed-row">
          <span className="speed-label">SPEED</span>
          <div className="speed-btns">
            {SPEED_OPTIONS.map(opt => (
              <button
                key={opt.value}
                className={`speed-btn ${speed === opt.value ? 'active' : ''}`}
                style={speed === opt.value ? { borderColor: instRoute.color, color: instRoute.color } : {}}
                onClick={() => onUpdate({ speed: opt.value })}
                title={opt.title}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="glide-row auto-glide-row">
          <span className="glide-label">GLIDE</span>
          <input
            type="range" min="0" max="1" step="0.01"
            value={glide}
            aria-label="Automation glide"
            aria-valuetext={`${Math.round(glide * 100)}%`}
            onChange={e => onUpdate({ glide: parseFloat(e.target.value) })}
            {...useResetGesture(() => onUpdate({ glide: 0 }))}
            className="glide-slider"
            style={{ accentColor: instRoute.color }}
          />
          <span className="glide-val" style={{ color: instRoute.color }}>{Math.round(glide * 1000)}ms</span>
        </div>
      </div>

      <AutoCurveRail
        route={sourceRoute}
        laneId={laneId}
        points={points}
        spec={findTargetSpec(paramTarget, synthType)}
        started={started}
        visible={visible}
        speed={speed}
        loopRegion={effectiveRegion}
        gridResolution={srcGridResolution}
        onLoopRegion={region => onUpdate({ loopRegion: region })}
        onUpdate={onUpdate}
        onActiveValue={handleActiveValue}
      />
    </div>
  )
}

// ── Automation source track (data-only, shown inside instrument's track-group) ─
function AutomationSourceTrack({ srcRoute, instRoute, automationCfg, srcGridResolution }) {
  if (!srcRoute) return null

  // Lanes on this instrument driven by this source line
  const lanes = Object.entries(automationCfg?.[instRoute.id] ?? {})
    .filter(([, lc]) => lc?.sourceRouteId === srcRoute.id)
  const driven = lanes.map(([, lc]) => lc.paramTarget).filter(Boolean).join(', ')

  // Mirror the first lane's authored curve onto the source line's stop-rail so the
  // DATA rail dots sit at the same Y as the automation points (override or hash default).
  const mirror = lanes[0]
  const automationValues = mirror
    ? Object.fromEntries((srcRoute.stops ?? []).map(s => {
        const ov = mirror[1].points?.[s.id]
        return [s.id, (typeof ov === 'number') ? ov : hashStopValue(mirror[0], s.id)]
      }))
    : null

  return (
    <div className="line-track line-track--auto-source">
      <div className="lt-top">
        <div className="line-label" style={{ borderColor: srcRoute.color }}>
          <div className="line-label-top">
            <span className="line-badge" style={{ background: srcRoute.color, color: srcRoute.textColor }}>
              {srcRoute.name}
            </span>
            <span className="auto-src-label">DATA</span>
          </div>
          {driven && (
            <span className="auto-src-info">→ {instRoute.name}: {driven}</span>
          )}
        </div>
      </div>
      <StopRail route={srcRoute} mode="mock" vehicles={[]} automationValues={automationValues} gridResolution={srcGridResolution} />
    </div>
  )
}

const AUTO_PAD = 0.1   // vertical padding so dots at value 0/1 stay inside the rail

// y% (0..100, top→bottom) for a 0..1 automation value, matching StopRail's padding.
function autoValueToY(value) {
  return (AUTO_PAD + (1 - value) * (1 - AUTO_PAD * 2)) * 100
}
// Inverse: a clientY fraction (0 top .. 1 bottom) back to a clamped 0..1 value.
function autoYToValue(frac) {
  const v = 1 - (frac - AUTO_PAD) / (1 - AUTO_PAD * 2)
  return Math.max(0, Math.min(1, v))
}

// Resolve a control's automation state from a route's `autoTargets` map.
// `ids` may be a single target id or a list (a control owned by either of several ids,
// e.g. the amp-env "A" slider is locked by both `synth.attack` and `adsr.attack`).
// Returns { disabled, display }: disabled iff any id is targeted by an armed lane (so the
// control greys whenever automation owns it, playing or not); display is the denormalized
// live value (in the control's own unit, via `divide`) only while a value is flowing.
function autoCtl(autoTargets, ids, { divide = 1 } = {}) {
  for (const id of [].concat(ids)) {
    const a = autoTargets?.[id]
    if (!a) continue
    const { spec, value } = a
    const display = (value == null || !spec) ? null
      : ((spec.curve === 'exp'
          ? denormalizeExp(value, spec.min, spec.max)
          : denormalizeToRange(value, spec.min, spec.max)) / divide)
    return { disabled: true, display }
  }
  return { disabled: false, display: null }
}

// Draggable per-stop automation curve. X = the chosen line's stops (snapped to the
// same grid as instrument notes); Y = the authored value (override or hash default).
function AutoCurveRail({ route, laneId, points, spec, started = false, visible = true, speed = 1, loopRegion, gridResolution, onLoopRegion, onUpdate, onActiveValue }) {
  const noteStepsPerBar = GRID_RESOLUTION_STEPS_PER_BAR[gridResolution ?? DEFAULT_GRID_RESOLUTION] ?? GRID_STEPS_PER_BAR
  const noteTotalCells  = GRID_BARS * noteStepsPerBar
  const railRef = useRef(null)
  const needleRef = useRef(null)
  const stopPointsRef = useRef([])
  const [dragId, setDragId] = useState(null)

  // Playhead — mirrors StopRail, driven by the source line's loop region + speed
  // so the needle sweeps the automation curve in sync with playback.
  const startCell = Math.max(0, Math.min(GRID_TOTAL_CELLS - 1, Math.round(loopRegion?.startCell ?? 0)))
  const endCell   = Math.max(startCell + 1, Math.min(GRID_TOTAL_CELLS, Math.round(loopRegion?.endCell ?? GRID_TOTAL_CELLS)))
  const regionLen = endCell - startCell
  const startPct  = (startCell / GRID_TOTAL_CELLS) * 100
  const endPct    = (endCell   / GRID_TOTAL_CELLS) * 100

  // Dot elements + their x, cached after each render rather than queried per
  // frame. A render may also have rewritten the dots' classNames, so drop the
  // applied highlight and let the next frame reapply it.
  const dotsRef       = useRef([])
  const lastActiveRef = useRef(-1)
  useLayoutEffect(() => {
    dotsRef.current = railRef.current
      ? [...railRef.current.querySelectorAll('.auto-dot')].map(el => ({ el, x: parseFloat(el.dataset.x) }))
      : []
    lastActiveRef.current = -2  // forces a reapply without re-reporting the same value
  })

  useEffect(() => {
    const el = needleRef.current
    if (!el) return undefined
    const clearActive = () => dotsRef.current.forEach(d => d.el.classList.remove('active'))
    if (!started || !visible) {
      el.style.transform = `translateX(${startPct}%)`
      clearActive()
      lastActiveRef.current = -1
      if (!started) onActiveValue?.(null)
      return undefined
    }
    let reported = -1
    const unsubscribe = subscribePlayhead(() => {
      const bpm = Tone.Transport.bpm.value || 120
      const loopSec = (16 / bpm) * 60
      const partLoopSec = (regionLen / GRID_TOTAL_CELLS) * loopSec / (speed || 1)
      const t = Tone.getTransport().seconds
      const local = partLoopSec > 0 ? ((t % partLoopSec) + partLoopSec) % partLoopSec / partLoopSec : 0
      const playLeft = startPct + local * (endPct - startPct)
      el.style.transform = `translateX(${playLeft}%)`
      // Highlight the point currently in effect: the last dot the needle has passed.
      const ds = dotsRef.current
      let active = -1
      for (let i = 0; i < ds.length; i++) {
        if (ds[i].x <= playLeft) active = i
      }
      if (active !== lastActiveRef.current) {
        ds.forEach((d, i) => d.el.classList.toggle('active', i === active))
        lastActiveRef.current = active
      }
      if (active !== reported) {
        reported = active
        // Surface the value now in effect so the parent can drive the instrument control.
        onActiveValue?.(active >= 0 ? (stopPointsRef.current[active]?.value ?? null) : null)
      }
    })
    return () => { unsubscribe(); clearActive(); lastActiveRef.current = -1; onActiveValue?.(null) }
  }, [started, visible, speed, startPct, endPct, regionLen, onActiveValue])

  // ── Loop handles (shared with StopRail) ───────────────────────────────────
  const loopHandleProps = useLoopHandles({ railRef, startCell, endCell, onLoopRegion })
  // Double-click a handle clears the per-lane override → inherit the source region.
  const handleReset = (e) => { e?.preventDefault?.(); e?.stopPropagation?.(); onLoopRegion?.(null) }
  // Loop handles are drag targets *and* reset targets, so the drag and the
  // long-press detector both have to see every pointer event — spreading one
  // set of props over the other would silently drop a handler. Delete or
  // Backspace is the keyboard reset.
  const resetGesture = useResetGesture(handleReset)
  const handleProps = (edge) => {
    const merged = mergeHandlers(resetGesture, loopHandleProps(edge))
    const onKeyDown = merged.onKeyDown
    return {
      ...merged,
      onKeyDown: (e) => {
        if (e.key === 'Delete' || e.key === 'Backspace') { handleReset(e); return }
        onKeyDown(e)
      },
    }
  }

  const stopPoints = useMemo(() => {
    if (!route?.stops?.length) return []
    const gridStops = snapStopsToGrid(route.stops, route.totalDist, noteTotalCells, noteStepsPerBar)
    return gridStops.map((stop) => {
      const override = points?.[stop.id]
      const value = (typeof override === 'number') ? override : hashStopValue(laneId, stop.id)
      const x = (stop.cellIdx / noteTotalCells) * 100
      return { id: stop.id, name: stop.name, x, y: autoValueToY(value), value }
    })
  }, [route, laneId, points, noteTotalCells, noteStepsPerBar])
  stopPointsRef.current = stopPoints

  const polylinePoints = stopPoints.map(p => `${p.x},${p.y}`).join(' ')

  const valueFromEvent = useCallback((clientY) => {
    const el = railRef.current
    if (!el) return null
    const r = el.getBoundingClientRect()
    if (r.height <= 0) return null
    return autoYToValue((clientY - r.top) / r.height)
  }, [])

  const onDotDown = useCallback((e, stopId) => {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    setDragId(stopId)
  }, [])
  const onDotMove = useCallback((e, stopId) => {
    if (dragId !== stopId) return
    const v = valueFromEvent(e.clientY)
    if (v == null) return
    onUpdate({ points: { ...points, [stopId]: v } })
  }, [dragId, points, onUpdate, valueFromEvent])
  const onDotUp = useCallback((e, stopId) => {
    if (dragId !== stopId) return
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    setDragId(null)
  }, [dragId])

  const unit = spec?.unit ?? ''
  // The point's value as the parameter reads it (Hz, dB, %…), for tooltips and
  // screen readers alike.
  const formatValue = (v) => (spec
    ? `${(spec.curve === 'exp' ? denormalizeExp(v, spec.min, spec.max) : denormalizeToRange(v, spec.min, spec.max)).toFixed(2)}${unit}`
    : `${Math.round(v * 100)}%`)
  // Keyboard: Up/Down nudge 5%, Shift 1%, PageUp/PageDown 25%, Home/End to the limits.
  const onDotKey = (e, p) => {
    const fine = e.shiftKey ? 0.01 : 0.05
    let next = null
    switch (e.key) {
      case 'ArrowUp': case 'ArrowRight': next = p.value + fine; break
      case 'ArrowDown': case 'ArrowLeft': next = p.value - fine; break
      case 'PageUp': next = p.value + 0.25; break
      case 'PageDown': next = p.value - 0.25; break
      case 'Home': next = 0; break
      case 'End': next = 1; break
      default: return
    }
    e.preventDefault()
    e.stopPropagation()
    onUpdate({ points: { ...points, [p.id]: Math.max(0, Math.min(1, next)) } })
  }
  const maxLabel = spec ? `${spec.max}${unit}` : ''
  const minLabel = spec ? `${spec.min}${unit}` : ''

  if (!route) {
    return (
      <div className="auto-curve-rail">
        <div className="auto-curve-live-hint">pick a line →</div>
      </div>
    )
  }

  return (
    <div className="auto-curve-rail" ref={railRef}>
      {spec && (
        <>
          <div className="auto-axis-label auto-axis-label--top">{maxLabel}</div>
          <div className="auto-axis-label auto-axis-label--bot">{minLabel}</div>
        </>
      )}

      {/* Dim regions outside the loop band */}
      {startPct > 0 && (
        <div className="loop-region-dim" style={{ left: 0, width: `${startPct}%` }} />
      )}
      {endPct < 100 && (
        <div className="loop-region-dim" style={{ left: `${endPct}%`, width: `${100 - endPct}%` }} />
      )}

      {/* Draggable loop-region handles (double-click to inherit source region) */}
      {onLoopRegion && (
        <>
          <div
            className="loop-handle loop-handle--start"
            style={{ left: `${startPct}%`, '--line-color': route.color }}
            {...handleProps('start')}
            title={`Loop start · cell ${startCell}/${GRID_TOTAL_CELLS} — drag to move, double-click or long-press to reset`}
          />
          <div
            className="loop-handle loop-handle--end"
            style={{ left: `${endPct}%`, '--line-color': route.color }}
            {...handleProps('end')}
            title={`Loop end · cell ${endCell}/${GRID_TOTAL_CELLS} — drag to move, double-click or long-press to reset`}
          />
        </>
      )}

      <svg className="auto-curve-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
        <polyline points={polylinePoints} fill="none" stroke={route.color} strokeWidth="1.5" opacity="0.45" />
      </svg>
      <div
        className={`lane-playhead auto-playhead ${started ? 'active' : ''}`}
        style={{ '--line-color': route.color }}
      >
        <div ref={needleRef} className="lane-playhead-track" />
      </div>
      {stopPoints.map((p) => (
        <button
          key={p.id}
          type="button"
          data-x={p.x}
          className={`auto-dot ${dragId === p.id ? 'dragging' : ''}`}
          style={{ left: `${p.x}%`, top: `${p.y}%`, '--line-color': route.color }}
          title={`${p.name} · ${formatValue(p.value)}`}
          role="slider"
          aria-label={`Automation at ${p.name}`}
          aria-orientation="vertical"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(p.value * 100)}
          aria-valuetext={formatValue(p.value)}
          onKeyDown={e => onDotKey(e, p)}
          onPointerDown={e => onDotDown(e, p.id)}
          onPointerMove={e => onDotMove(e, p.id)}
          onPointerUp={e => onDotUp(e, p.id)}
          onPointerCancel={e => onDotUp(e, p.id)}
          onLostPointerCapture={e => onDotUp(e, p.id)}
        />
      ))}
    </div>
  )
}

// ── DAW Footer ────────────────────────────────────────────────────────────────
function DawFooter({
  activeFxTracks, masterVolume, masterChain, onMasterChain,
  fxBusWet, fxBusMuted, fxBusSoloed, fxBusParams,
  onMasterVolume, onFxBusWet, onFxBusMute, onFxBusSolo, onFxBusParam, onFxBusCustomIR,
  onAddFxTrack, onRemoveFxTrack,
}) {
  return (
    <footer className="daw-footer" data-tour="footer">
      <div className="daw-footer-inner">
        <MasterStrip volume={masterVolume} onVolume={onMasterVolume} />
        {masterChain && onMasterChain && (
          <MasterChainCard settings={masterChain} onChange={onMasterChain} />
        )}
        {activeFxTracks.map(busId => {
          const bus = FX_BUSES.find(b => b.id === busId)
          if (!bus) return null
          return (
            <FxTrackCard
              key={busId}
              bus={bus}
              wet={fxBusWet?.[busId] ?? 1.0}
              muted={fxBusMuted?.[busId] ?? false}
              soloed={fxBusSoloed?.[busId] ?? false}
              params={fxBusParams?.[busId]}
              onWet={v => onFxBusWet(busId, v)}
              onMute={() => onFxBusMute(busId)}
              onSolo={() => onFxBusSolo(busId)}
              onParam={(paramId, value) => onFxBusParam(busId, paramId, value)}
              onCustomIR={buf => onFxBusCustomIR?.(busId, buf)}
              onRemove={() => onRemoveFxTrack(busId)}
            />
          )
        })}
        <FxAddButton activeFxTracks={activeFxTracks} onAdd={onAddFxTrack} />
      </div>
    </footer>
  )
}

function MasterStrip({ volume, onVolume }) {
  return (
    <div className="master-strip">
      <span className="master-strip-label">Master</span>
      <div className="master-vol-row">
        <span className="master-vol-label">Vol</span>
        <input
          type="range" min="-40" max="0" step="1"
          value={volume}
          onChange={e => onVolume(Number(e.target.value))}
          aria-label="Master volume"
          aria-valuetext={`${volume} dB`}
          className="master-vol-slider"
        />
        <span className="master-vol-val">{volume}dB</span>
      </div>
    </div>
  )
}

// The hidden master bus (lib/masterBus.js) made visible: what's on it, how hard
// its two dynamics stages are working, and a few narrow-range controls
// (lib/masterChain.js). "Off" falls back to the classic compressor + limiter, so
// the output is never left unprotected.
const MASTER_METER_POLL_MS = 100
const MASTER_METER_RANGE_DB = 8

function MasterChainCard({ settings, onChange }) {
  const { enabled } = settings
  const [meter, setMeter] = useState(null)

  useEffect(() => {
    if (!enabled) { setMeter(null); return }
    const bus = getMasterBus()
    const id = setInterval(() => {
      if (document.hidden) return
      const next = bus.status()
      // Only re-render when the shown reading (0.1 dB) actually moves; an idle
      // master otherwise re-rendered this card ten times a second for nothing.
      setMeter(prev => (
        prev
        && prev.limiter === next.limiter
        && Math.round((prev.glueReductionDb ?? 0) * 10) === Math.round((next.glueReductionDb ?? 0) * 10)
        && Math.round((prev.limiterReductionDb ?? 0) * 10) === Math.round((next.limiterReductionDb ?? 0) * 10)
      ) ? prev : next)
    }, MASTER_METER_POLL_MS)
    return () => clearInterval(id)
  }, [enabled])

  const isDefault = isDefaultMasterChain(settings)

  return (
    <div className={`fx-track-card master-chain-card ${enabled ? '' : 'fx-track-card--muted'}`}>
      <div className="fx-track-card-header">
        <span className="fx-track-name master-chain-name">Mastering</span>
        <span className="master-chain-flow" aria-label="Signal chain">
          {MASTER_CHAIN_STAGES.map((st, i) => (
            <span key={st.id}>{i > 0 && <span className="master-chain-arrow">›</span>}{st.label}</span>
          ))}
        </span>
        <button
          type="button"
          className="master-chain-reset"
          onClick={() => onChange({ ...MASTER_CHAIN_DEFAULTS, enabled })}
          disabled={isDefault}
          title="Reset mastering to defaults"
          aria-label="Reset mastering to defaults"
        >↺</button>
        <button
          type="button"
          className={`master-chain-toggle ${enabled ? 'active' : ''}`}
          onClick={() => onChange({ enabled: !enabled })}
          aria-pressed={enabled}
          title={enabled ? 'Turn mastering off (keeps a safety limiter)' : 'Turn mastering on'}
        >{enabled ? 'On' : 'Off'}</button>
      </div>
      <div className="fx-track-params master-chain-params">
        {MASTER_CHAIN_SPECS.map(spec => (
          <FxParamControl
            key={spec.id}
            spec={spec}
            value={settings[spec.id]}
            onChange={v => onChange({ [spec.id]: v })}
            disabled={!enabled}
            disabledText={null}
          />
        ))}
      </div>
      <div className="master-chain-meters">
        {enabled ? (
          <>
            <GainReductionMeter label="Glue" db={meter?.glueReductionDb} />
            <GainReductionMeter
              label="Limit"
              title={meter?.limiter === 'true-peak worklet' ? 'True-peak limiter gain reduction' : 'Limiter gain reduction'}
              db={meter?.limiterReductionDb}
            />
          </>
        ) : (
          <span className="master-chain-off-note">Off: safety limiter only</span>
        )}
      </div>
    </div>
  )
}

function GainReductionMeter({ label, db, title = `${label} gain reduction` }) {
  const gr = Math.min(0, db ?? 0)
  const frac = Math.min(1, -gr / MASTER_METER_RANGE_DB)
  return (
    <div className="gr-meter" title={title}>
      <span className="fx-param-label">{label}</span>
      <div className="gr-meter-track">
        <div className="gr-meter-fill" style={{ transform: `scaleX(${frac})` }} />
      </div>
      <span className="fx-param-val">{gr === 0 ? '0.0' : gr.toFixed(1)} dB</span>
    </div>
  )
}

function FxTrackCard({ bus, wet, muted, soloed, params, onWet, onMute, onSolo, onParam, onCustomIR, onRemove }) {
  const specs = FX_PARAM_SPECS[bus.id] ?? []
  // When tempo-synced, the raw ms/Hz slider for the synced param is inert.
  const syncTarget = FX_SYNC_TARGETS[bus.id]
  const synced = (params?.sync ?? bus.defaults?.sync ?? 'free') !== 'free'
  return (
    <div className={`fx-track-card ${muted ? 'fx-track-card--muted' : ''}`}>
      <div className="fx-track-card-header">
        <span className="fx-track-name">{bus.label}</span>
        <button className={`mute-btn ${muted ? 'active' : ''}`} onClick={onMute} aria-pressed={muted} aria-label={`Mute ${bus.label}`} title="Mute">M</button>
        <button className={`solo-btn ${soloed ? 'active' : ''}`} onClick={onSolo} aria-pressed={soloed} aria-label={`Solo ${bus.label}`} title="Solo">S</button>
        <input
          type="range" min="0" max="1" step="0.01"
          value={wet}
          onChange={e => onWet(parseFloat(e.target.value))}
          aria-label={`${bus.label} return level`}
          aria-valuetext={`${Math.round(wet * 100)}%`}
          className="fx-track-wet-slider"
        />
        <span className="fx-track-wet-val">{Math.round(wet * 100)}%</span>
        <button className="fx-track-remove-btn" onClick={onRemove} title="Remove FX track" aria-label={`Remove ${bus.label}`}>×</button>
      </div>
      {specs.length > 0 && (
        <div className="fx-track-params">
          {specs.map(spec => (
            <FxParamControl
              key={spec.id}
              spec={spec}
              value={params?.[spec.id] ?? bus.defaults?.[spec.id]}
              onChange={v => onParam(spec.id, v)}
              disabled={synced && spec.id === syncTarget}
            />
          ))}
          {bus.id === 'reverb' && onCustomIR && (
            <CustomIRPicker onCustomIR={onCustomIR} />
          )}
        </div>
      )}
    </div>
  )
}

function CustomIRPicker({ onCustomIR }) {
  const inputRef = useRef(null)
  const [name, setName] = useState(null)
  const [error, setError] = useState(null)

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    try {
      const buf = await file.arrayBuffer()
      const audioBuffer = await Tone.getContext().rawContext.decodeAudioData(buf)
      setName(file.name)
      onCustomIR(audioBuffer)
    } catch (err) {
      console.error('Custom IR decode failed:', err)
      setError('decode failed')
    }
  }

  return (
    <div className="fx-param-row">
      <span className="fx-param-label">Load IR</span>
      <button
        type="button"
        className="fx-param-select"
        onClick={() => inputRef.current?.click()}
      >
        {error ?? name ?? 'Choose WAV…'}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="audio/wav,audio/x-wav,audio/wave,.wav"
        style={{ display: 'none' }}
        onChange={handleFile}
      />
    </div>
  )
}

function SamplerUploadRow({ onSamplerUpload }) {
  const inputRef = useRef(null)
  const [note, setNote] = useState('C4')
  const [name, setName] = useState(null)
  const [error, setError] = useState(null)
  const baseNotes = ['C2', 'C3', 'C4', 'C5', 'A3', 'A4']

  function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    try {
      setName(file.name)
      onSamplerUpload?.(file, note)
    } catch (err) {
      console.error('Sampler upload failed:', err)
      setError('failed')
    }
  }

  return (
    <div className="sp-row sp-row--select">
      <span className="sp-label">File</span>
      <select className="sp-select" value={note} onChange={e => setNote(e.target.value)}
        title="Base note for the uploaded sample">
        {baseNotes.map(n => <option key={n} value={n}>{n}</option>)}
      </select>
      <button type="button" className="sp-select" onClick={() => inputRef.current?.click()}>
        {error ?? name ?? 'Choose…'}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="audio/*"
        style={{ display: 'none' }}
        onChange={handleFile}
      />
    </div>
  )
}

// `disabledText` replaces the value readout while disabled (a tempo-synced delay
// time reads "synced"); null keeps showing the value.
function FxParamControl({ spec, value, onChange, disabled = false, disabledText = 'synced' }) {
  if (spec.kind === 'enum') {
    return (
      <div className="fx-param-row">
        <span className="fx-param-label">{spec.label}</span>
        <select
          className="fx-param-select"
          value={value ?? spec.values[0]}
          onChange={e => onChange(e.target.value)}
        >
          {spec.values.map(v => (
            <option key={v} value={v}>{spec.valueLabels?.[v] ?? v}</option>
          ))}
        </select>
      </div>
    )
  }

  const v = value ?? spec.min
  const scale = spec.displayScale ?? 1
  const displayVal = v * scale
  const decimals = spec.decimals ?? (spec.step < 0.01 ? 3 : spec.step < 1 ? 2 : 0)
  return (
    <div className={`fx-param-row ${disabled ? 'fx-param-row--disabled' : ''}`}>
      <span className="fx-param-label">{spec.label}</span>
      <input
        type="range"
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={v}
        aria-label={spec.label}
        disabled={disabled}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="fx-param-slider"
      />
      <span className="fx-param-val">
        {disabled && disabledText != null ? disabledText : `${displayVal.toFixed(decimals)}${spec.unit ? ` ${spec.unit}` : ''}`}
      </span>
    </div>
  )
}

function FxAddButton({ activeFxTracks, onAdd }) {
  const available = FX_BUSES.filter(b => !activeFxTracks.includes(b.id))
  if (available.length === 0) return null

  return (
    <div className="fx-add-area">
      <select
        className="fx-add-select"
        value=""
        onChange={e => { if (e.target.value) onAdd(e.target.value) }}
      >
        <option value="">+ Add FX…</option>
        {available.map(bus => (
          <option key={bus.id} value={bus.id}>{bus.label}</option>
        ))}
      </select>
    </div>
  )
}

// ── Synth Panel: redesigned per-synth parameter editor ───────────────────────

const ALL_ENV_CURVES  = ['linear', 'exponential', 'bounce', 'cosine', 'ripple', 'sine', 'step']
const DECAY_ENV_CURVES = ['linear', 'exponential']

function AdsrVisualizer({ attack = 0.1, decay = 0.1, sustain = 0.5, release = 1.0 }) {
  const W = 200, H = 44, P = 3
  const peakY = P, floorY = H - P
  const sustY = peakY + (1 - Math.max(0, Math.min(1, sustain))) * (floorY - peakY)
  const inner = W - P * 2
  const ax = P + inner * 0.27
  const dx = ax + inner * 0.21
  const sx = dx + inner * 0.21
  const ex = sx + inner * 0.31

  const fill = `M${P},${floorY} L${ax},${peakY} L${dx},${sustY} L${sx},${sustY} L${ex},${floorY} Z`
  const line = `M${P},${floorY} L${ax},${peakY} L${dx},${sustY} L${sx},${sustY} L${ex},${floorY}`

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="sp-viz" preserveAspectRatio="none">
      <path d={fill} className="sp-viz-fill" />
      <path d={line} className="sp-viz-line" />
    </svg>
  )
}

function SpSection({ label }) {
  return <div className="sp-section">{label}</div>
}

function SpSlider({ label, min, max, step, value, onChange, unit, disabled = false }) {
  const decimals = step < 0.01 ? 3 : step < 1 ? 2 : 0
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div className={`sp-row ${disabled ? 'sp-row--auto' : ''}`}>
      <span className="sp-label">{label}</span>
      <div className="sp-track">
        <div className="sp-fill" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
        <input type="range" min={min} max={max} step={step} value={value} disabled={disabled}
          aria-label={typeof label === 'string' ? label : undefined}
          className="sp-slider" onChange={e => onChange(Number(e.target.value))} />
      </div>
      <span className="sp-val">{Number(value).toFixed(decimals)}{unit ?? ''}</span>
    </div>
  )
}

function SpSelect({ label, value, options, onChange }) {
  return (
    <div className="sp-row sp-row--select">
      <span className="sp-label">{label}</span>
      <select className="sp-select" value={value} onChange={e => onChange(e.target.value)}>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  )
}

function SpCurve({ value, options, onChange }) {
  return (
    <select className="sp-curve" value={value} onChange={e => onChange(e.target.value)}
      title="Curve shape">
      {options.map(o => <option key={o} value={o}>{o.slice(0, 4)}</option>)}
    </select>
  )
}

function SpSliderWithCurve({ label, min, max, step, value, onChange, curveValue, curveOptions, onCurve, disabled = false }) {
  const decimals = step < 0.01 ? 3 : step < 1 ? 2 : 0
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div className={`sp-row sp-row--curvy ${disabled ? 'sp-row--auto' : ''}`}>
      <span className="sp-label">{label}</span>
      <div className="sp-track">
        <div className="sp-fill" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
        <input type="range" min={min} max={max} step={step} value={value} disabled={disabled}
          aria-label={typeof label === 'string' ? label : undefined}
          className="sp-slider" onChange={e => onChange(Number(e.target.value))} />
      </div>
      <span className="sp-val">{Number(value).toFixed(decimals)}</span>
      <SpCurve value={curveValue} options={curveOptions} onChange={onCurve} />
    </div>
  )
}

const AMP_ENV_KEYS = new Set(['attack', 'decay', 'sustain', 'release'])

function EnvPanel({ synthType, adsr, onADSR, onSamplerPreset, onDrumVoice, onSamplerUpload, autoTargets = {} }) {
  const def = SYNTH_DEFAULTS[synthType] ?? SYNTH_DEFAULTS['Synth']
  const p = { ...def, ...adsr }

  // An EnvPanel slider's onADSR({ key }) maps to automation id `synth.<key>`; the amp-env
  // A/D/S/R are also driven by `adsr.<key>`. Returns { disabled, value } to spread onto the
  // slider — value falls back to the stored param when no live automation value is flowing.
  const a = (key, stored) => {
    const ids = AMP_ENV_KEYS.has(key) ? [`synth.${key}`, `adsr.${key}`] : [`synth.${key}`]
    const r = autoCtl(autoTargets, ids)
    return { disabled: r.disabled, value: r.display ?? stored }
  }

  if (synthType === 'Drums') {
    const voiceId = p.drumVoice ?? 'kick'
    return (
    <div className="sp-panel">
      <SpSection label="DRUMS" />
      <div className="sp-row sp-row--select">
        <span className="sp-label">Voice</span>
        <select className="sp-select" value={voiceId}
          onChange={e => onDrumVoice?.(e.target.value)}>
          {DRUM_VOICES.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
        </select>
      </div>
      <div className="sp-row sp-row--credits" title={DRUM_VOICE_LICENSE.attribution}>
        <span className="sp-label">©</span>
        <span className="sp-credits-text">
          {DRUM_VOICE_LICENSE.license} · {DRUM_VOICE_LICENSE.attribution}
          {' · '}
          <a className="sp-credits-link" href={DRUM_VOICE_LICENSE.source} target="_blank" rel="noopener noreferrer">source ↗</a>
        </span>
      </div>
      <SpSection label="ENV" />
      <SpSlider label="A" min={0} max={0.5} step={0.001} value={p.attack ?? 0.001} onChange={v => onADSR({ attack: v })} />
      <SpSlider label="R" min={0.02} max={3} step={0.01} value={p.release ?? 0.6} onChange={v => onADSR({ release: v })} />
    </div>
    )
  }

  if (synthType === 'Sampler') {
    const presetId = p.samplerPreset ?? 'piano'
    const preset   = SAMPLER_PRESETS[presetId]
    return (
    <div className="sp-panel">
      <SpSection label="SAMPLER" />
      <div className="sp-row sp-row--select">
        <span className="sp-label">Inst</span>
        <select className="sp-select" value={presetId}
          onChange={e => onSamplerPreset?.(e.target.value)}>
          {SAMPLER_PRESET_LIST.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </div>
      {preset?.license && (
        <div className="sp-row sp-row--credits" title={preset.attribution}>
          <span className="sp-label">©</span>
          <span className="sp-credits-text">
            {preset.license} · {preset.attribution}
            {preset.source && (
              <> · <a className="sp-credits-link" href={preset.source} target="_blank" rel="noopener noreferrer">source ↗</a></>
            )}
          </span>
        </div>
      )}
      <SpSection label="ENV" />
      <SpSlider label="A" min={0} max={2} step={0.001} value={p.attack ?? 0.01} onChange={v => onADSR({ attack: v })} />
      <SpSlider label="R" min={0.01} max={6} step={0.01} value={p.release ?? 1.0} onChange={v => onADSR({ release: v })} />
      <SpSection label="UPLOAD" />
      <SamplerUploadRow onSamplerUpload={onSamplerUpload} />
    </div>
    )
  }

  const envBlock = (hasViz = true) => (
    <>
      {hasViz && <AdsrVisualizer attack={p.attack} decay={p.decay} sustain={p.sustain} release={p.release} />}
      <SpSliderWithCurve
        label="A" min={0.001} max={2} step={0.001} {...a('attack', p.attack ?? 0.005)} onChange={v => onADSR({ attack: v })}
        curveValue={p.attackCurve ?? 'exponential'} curveOptions={ALL_ENV_CURVES} onCurve={v => onADSR({ attackCurve: v })}
      />
      <SpSliderWithCurve
        label="D" min={0.001} max={2} step={0.001} {...a('decay', p.decay ?? 0.1)} onChange={v => onADSR({ decay: v })}
        curveValue={p.decayCurve ?? 'exponential'} curveOptions={DECAY_ENV_CURVES} onCurve={v => onADSR({ decayCurve: v })}
      />
      <SpSlider label="S" min={0} max={1} step={0.01} {...a('sustain', p.sustain ?? 0.5)} onChange={v => onADSR({ sustain: v })} />
      <SpSliderWithCurve
        label="R" min={0.01} max={4} step={0.01} {...a('release', p.release ?? 1.0)} onChange={v => onADSR({ release: v })}
        curveValue={p.releaseCurve ?? 'exponential'} curveOptions={ALL_ENV_CURVES} onCurve={v => onADSR({ releaseCurve: v })}
      />
    </>
  )

  if (synthType === 'PluckSynth') return (
    <div className="sp-panel">
      <SpSlider label="Noise" min={0.1} max={20} step={0.1}  {...a('attackNoise', p.attackNoise ?? 1)}  onChange={v => onADSR({ attackNoise: v })} />
      <SpSlider label="Damp"  min={200} max={8000} step={10} {...a('dampening', p.dampening ?? 4000)}   onChange={v => onADSR({ dampening: v })} unit="Hz" />
      <SpSlider label="Res"   min={0} max={0.98} step={0.01} {...a('resonance', p.resonance ?? 0.7)}    onChange={v => onADSR({ resonance: v })} />
    </div>
  )

  if (synthType === 'NoiseSynth') return (
    <div className="sp-panel">
      <SpSection label="NOISE" />
      <SpSelect label="Type" value={p.noiseType ?? 'white'} options={NOISE_TYPES} onChange={v => onADSR({ noiseType: v })} />
      <SpSection label="ENV" />
      {envBlock()}
    </div>
  )

  if (synthType === 'MembraneSynth') return (
    <div className="sp-panel">
      <SpSection label="DRUM" />
      <SpSlider label="Decay"  min={0.001} max={0.5} step={0.001} {...a('pitchDecay', p.pitchDecay ?? 0.05)}  onChange={v => onADSR({ pitchDecay: v })} />
      <SpSlider label="Octav"  min={1}     max={20}  step={0.5}   {...a('membOctaves', p.membOctaves ?? 10)}  onChange={v => onADSR({ membOctaves: v })} />
      <SpSection label="ENV" />
      {envBlock()}
    </div>
  )

  if (synthType === 'MetalSynth') return (
    <div className="sp-panel">
      <SpSection label="METAL" />
      <SpSlider label="Harm"   min={0.1}  max={20}    step={0.1}  {...a('metalHarmonicity', p.metalHarmonicity ?? 5.1)} onChange={v => onADSR({ metalHarmonicity: v })} />
      <SpSlider label="ModIdx" min={1}    max={100}   step={1}    {...a('metalModIndex', p.metalModIndex ?? 32)}        onChange={v => onADSR({ metalModIndex: v })} />
      <SpSlider label="Octav"  min={0.1}  max={5}     step={0.1}  {...a('metalOctaves', p.metalOctaves ?? 1.5)}         onChange={v => onADSR({ metalOctaves: v })} />
      <SpSlider label="Res"    min={100}  max={10000} step={10}   {...a('resonance', p.resonance ?? 4000)}              onChange={v => onADSR({ resonance: v })} unit="Hz" />
      <SpSection label="ENV" />
      {envBlock()}
    </div>
  )

  if (synthType === 'MonoSynth') return (
    <div className="sp-panel">
      <SpSection label="OSC" />
      <SpSelect label="Type"  value={p.oscillatorType ?? 'sawtooth'} options={OSC_TYPES}   onChange={v => onADSR({ oscillatorType: v })} />
      <SpSlider label="Phase" min={0} max={360} step={1}              value={p.phase ?? 0}  onChange={v => onADSR({ phase: v })} unit="°" />
      <SpSlider label="Dtn"   min={-200} max={200} step={1}           {...a('detune', p.detune ?? 0)} onChange={v => onADSR({ detune: v })} unit="¢" />
      <SpSection label="ENV" />
      {envBlock()}
      <SpSection label="FILTER" />
      <SpSelect label="Type"   value={p.filterType ?? 'lowpass'}        options={FILTER_TYPES}               onChange={v => onADSR({ filterType: v })} />
      <SpSelect label="Roll"   value={String(p.filterRolloff ?? -12)}   options={FILTER_ROLLOFFS.map(String)} onChange={v => onADSR({ filterRolloff: Number(v) })} />
      <SpSlider label="Q"      min={0.1} max={20}   step={0.1}          {...a('filterQ', p.filterQ ?? 1)}                   onChange={v => onADSR({ filterQ: v })} />
      <SpSection label="FILTER ENV" />
      <SpSlider label="A"      min={0.001} max={2}  step={0.001}        {...a('filterEnvAttack', p.filterEnvAttack ?? 0.001)}  onChange={v => onADSR({ filterEnvAttack: v })} />
      <SpSlider label="D"      min={0.001} max={2}  step={0.001}        {...a('filterEnvDecay', p.filterEnvDecay ?? 0.3)}      onChange={v => onADSR({ filterEnvDecay: v })} />
      <SpSlider label="S"      min={0} max={1}      step={0.01}         {...a('filterEnvSustain', p.filterEnvSustain ?? 0.3)}  onChange={v => onADSR({ filterEnvSustain: v })} />
      <SpSlider label="R"      min={0.01} max={4}   step={0.01}         {...a('filterEnvRelease', p.filterEnvRelease ?? 0.8)}  onChange={v => onADSR({ filterEnvRelease: v })} />
      <SpSlider label="Base"   min={20}  max={5000} step={10}           {...a('filterEnvBaseFreq', p.filterEnvBaseFreq ?? 200)} onChange={v => onADSR({ filterEnvBaseFreq: v })} unit="Hz" />
      <SpSlider label="Oct"    min={0}   max={8}    step={0.5}          {...a('filterEnvOctaves', p.filterEnvOctaves ?? 3)}    onChange={v => onADSR({ filterEnvOctaves: v })} />
      <SpSlider label="Exp"    min={0.1} max={8}    step={0.1}          value={p.filterEnvExponent ?? 2}     onChange={v => onADSR({ filterEnvExponent: v })} />
    </div>
  )

  if (synthType === 'FMSynth') return (
    <div className="sp-panel">
      <SpSection label="CARRIER OSC" />
      <SpSelect label="Type"   value={p.oscillatorType ?? 'sine'}     options={OSC_TYPES} onChange={v => onADSR({ oscillatorType: v })} />
      <SpSlider label="Phase"  min={0} max={360} step={1}              value={p.phase ?? 0}              onChange={v => onADSR({ phase: v })} unit="°" />
      <SpSlider label="Dtn"    min={-200} max={200} step={1}           {...a('detune', p.detune ?? 0)}             onChange={v => onADSR({ detune: v })} unit="¢" />
      <SpSection label="MODULATOR" />
      <SpSelect label="Type"   value={p.modulationOscType ?? 'sine'}  options={OSC_TYPES} onChange={v => onADSR({ modulationOscType: v })} />
      <SpSlider label="Harm"   min={0.1} max={20}  step={0.1}          {...a('harmonicity', p.harmonicity ?? 3)}        onChange={v => onADSR({ harmonicity: v })} />
      <SpSlider label="Idx"    min={0}   max={100} step={0.5}          {...a('modulationIndex', p.modulationIndex ?? 0)} onChange={v => onADSR({ modulationIndex: v })} />
      <SpSection label="MOD ENV" />
      <SpSlider label="A"      min={0.001} max={2} step={0.001}        {...a('modAttack', p.modAttack ?? 0.5)}        onChange={v => onADSR({ modAttack: v })} />
      <SpSlider label="D"      min={0.001} max={2} step={0.001}        {...a('modDecay', p.modDecay ?? 0.1)}          onChange={v => onADSR({ modDecay: v })} />
      <SpSlider label="S"      min={0} max={1}     step={0.01}         {...a('modSustain', p.modSustain ?? 1.0)}      onChange={v => onADSR({ modSustain: v })} />
      <SpSlider label="R"      min={0.01} max={4}  step={0.01}         {...a('modRelease', p.modRelease ?? 1.4)}      onChange={v => onADSR({ modRelease: v })} />
      <SpSection label="AMP ENV" />
      {envBlock()}
    </div>
  )

  if (synthType === 'AMSynth') return (
    <div className="sp-panel">
      <SpSection label="CARRIER OSC" />
      <SpSelect label="Type"   value={p.oscillatorType ?? 'sine'}      options={OSC_TYPES} onChange={v => onADSR({ oscillatorType: v })} />
      <SpSlider label="Phase"  min={0} max={360} step={1}               value={p.phase ?? 0}             onChange={v => onADSR({ phase: v })} unit="°" />
      <SpSlider label="Dtn"    min={-200} max={200} step={1}            {...a('detune', p.detune ?? 0)}            onChange={v => onADSR({ detune: v })} unit="¢" />
      <SpSection label="MODULATOR" />
      <SpSelect label="Type"   value={p.modulationOscType ?? 'square'}  options={OSC_TYPES} onChange={v => onADSR({ modulationOscType: v })} />
      <SpSlider label="Harm"   min={0.1} max={20}  step={0.1}           {...a('harmonicity', p.harmonicity ?? 3)}     onChange={v => onADSR({ harmonicity: v })} />
      <SpSection label="MOD ENV" />
      <SpSlider label="A"      min={0.001} max={2} step={0.001}         {...a('modAttack', p.modAttack ?? 0.5)}       onChange={v => onADSR({ modAttack: v })} />
      <SpSlider label="D"      min={0.001} max={2} step={0.001}         {...a('modDecay', p.modDecay ?? 0.0)}         onChange={v => onADSR({ modDecay: v })} />
      <SpSlider label="S"      min={0} max={1}     step={0.01}          {...a('modSustain', p.modSustain ?? 1.0)}     onChange={v => onADSR({ modSustain: v })} />
      <SpSlider label="R"      min={0.01} max={4}  step={0.01}          {...a('modRelease', p.modRelease ?? 0.5)}     onChange={v => onADSR({ modRelease: v })} />
      <SpSection label="AMP ENV" />
      {envBlock()}
    </div>
  )

  if (synthType === 'DuoSynth') return (
    <div className="sp-panel">
      <SpSection label="OSC" />
      <SpSelect label="Osc 1"   value={p.voice0OscType ?? 'sawtooth'} options={OSC_TYPES} onChange={v => onADSR({ voice0OscType: v })} />
      <SpSelect label="Osc 2"   value={p.voice1OscType ?? p.voice0OscType ?? 'sawtooth'} options={OSC_TYPES} onChange={v => onADSR({ voice1OscType: v })} />
      <SpSlider label="Dtn"     min={-200} max={200} step={1}          {...a('detune', p.detune ?? 0)}              onChange={v => onADSR({ detune: v })} unit="¢" />
      <SpSlider label="Harm"    min={0.1} max={6}    step={0.1}        {...a('duoHarmonicity', p.duoHarmonicity ?? 1.5)}  onChange={v => onADSR({ duoHarmonicity: v })} />
      <SpSection label="VIBRATO" />
      <SpSlider label="Rate"    min={0.1} max={20}   step={0.1}        {...a('vibratoRate', p.vibratoRate ?? 5)}          onChange={v => onADSR({ vibratoRate: v })} unit="Hz" />
      <SpSlider label="Amt"     min={0}   max={1}    step={0.01}       {...a('vibratoAmount', p.vibratoAmount ?? 0.5)}    onChange={v => onADSR({ vibratoAmount: v })} />
      <SpSection label="ENV" />
      {envBlock()}
    </div>
  )

  // Default: basic Synth
  return (
    <div className="sp-panel">
      <SpSection label="OSC" />
      <SpSelect label="Type"  value={p.oscillatorType ?? 'sine'} options={OSC_TYPES} onChange={v => onADSR({ oscillatorType: v })} />
      <SpSlider label="Phase" min={0} max={360} step={1}          value={p.phase ?? 0}  onChange={v => onADSR({ phase: v })} unit="°" />
      <SpSlider label="Dtn"   min={-200} max={200} step={1}       {...a('detune', p.detune ?? 0)} onChange={v => onADSR({ detune: v })} unit="¢" />
      <SpSection label="ENV" />
      {envBlock()}
    </div>
  )
}

function FilterPanel({ filter, onFilter, autoTargets = {} }) {
  const p = { ...DEFAULT_FILTER, ...filter }
  const aFreq = autoCtl(autoTargets, 'filter.frequency')
  const aQ    = autoCtl(autoTargets, 'filter.Q')
  return (
    <div className="sp-panel">
      <SpSelect label="Type" value={p.type}      options={FILTER_TYPES} onChange={v => onFilter({ type: v })} />
      <SpSlider label="Freq" min={20}  max={20000} step={10}  value={aFreq.display ?? p.frequency} onChange={v => onFilter({ frequency: v })} unit="Hz" disabled={aFreq.disabled} />
      <SpSlider label="Q"    min={0.1} max={20}    step={0.1} value={aQ.display ?? p.Q}            onChange={v => onFilter({ Q: v })} disabled={aQ.disabled} />
    </div>
  )
}

// 8-band parametric EQ via the weq8 <weq8-ui> web component (raw Web Audio),
// bound to the route's persistent WEQ8Runtime from the engine. The runtime is
// mutated directly by the curve editor; the engine mirrors changes into React
// state (setOnRouteEqChange). Mounted only while the rack is open, so at most a
// few analyser loops run at once.
function EqPanel({ getRuntime }) {
  const hostRef  = useRef(null)
  const boundRef = useRef(null)
  const [ready, setReady] = useState(false)
  // <weq8-ui> is a 300×360px drag-to-place curve editor from a third-party
  // package — precision pointer work we don't control the internals of. Below
  // 768px we don't load or mount it at all.
  //
  // The EQ *runtime* is unaffected: it lives on the engine and is created by
  // MixerTab's getEqRuntime, so a song saved with EQ on desktop still filters
  // audio here — only the curve editor is missing.
  const isPhone = useIsPhone()

  // Register the custom element once (client-only; never during SSR).
  useEffect(() => {
    if (isPhone) return undefined
    let cancelled = false
    import('weq8/ui').then(() => { if (!cancelled) setReady(true) })
      .catch(e => console.warn('weq8/ui failed to load', e))
    return () => { cancelled = true }
  }, [isPhone])

  // Bind the route's EQ runtime to the element once both exist (guarded so we
  // don't re-assign the same runtime on every render).
  useEffect(() => {
    if (!ready) return
    const el = hostRef.current
    const rt = getRuntime?.()
    if (el && rt && boundRef.current !== rt) {
      el.runtime = rt
      boundRef.current = rt
    }
  })

  if (isPhone) {
    return (
      <div className="sp-panel eq-weq8 eq-weq8--stub">
        <p className="eq-stub-note">
          This lane&rsquo;s EQ is still applied. Editing the curve needs a
          pointer — open Leið on a desktop browser.
        </p>
      </div>
    )
  }

  return (
    <div className="sp-panel eq-weq8">
      {ready
        ? <weq8-ui ref={hostRef} />
        : <div className="eq-loading">Loading EQ…</div>}
    </div>
  )
}

// Bar labels rendered once per rail: "1", "2", "3", "4" at bar boundaries
const BAR_LABELS = Array.from({ length: GRID_BARS }, (_, i) => ({
  bar: i + 1,
  pct: (i / GRID_BARS) * 100,
}))

// ── Stop rail: stops quantized to 4-bar × 16th-note grid (64 cells) ──────────
function StopRail({
  route, visible = true, speed = 1, started = false, mode = 'mock', vehicles = [],
  trackScale = { root: 'C', scaleType: 'major' }, octaveShift = 0, semitoneShift = 0,
  loopRegion, onLoopRegion, gridResolution, automationValues = null,
  pitchVariety = null,
  stopVelocities = null, perStopSteps = null, onStopOpen = null,
  laneChance = 1, stopChances = null, loopPattern = null,
}) {
  const needleRef = useRef(null)
  const railRef   = useRef(null)
  const noteStepsPerBar = GRID_RESOLUTION_STEPS_PER_BAR[gridResolution ?? DEFAULT_GRID_RESOLUTION] ?? GRID_STEPS_PER_BAR
  const noteTotalCells  = GRID_BARS * noteStepsPerBar

  const startCell = Math.max(0, Math.min(GRID_TOTAL_CELLS - 1, Math.round(loopRegion?.startCell ?? 0)))
  const endCell   = Math.max(startCell + 1, Math.min(GRID_TOTAL_CELLS, Math.round(loopRegion?.endCell ?? GRID_TOTAL_CELLS)))
  const regionLen = endCell - startCell
  const startPct  = (startCell / GRID_TOTAL_CELLS) * 100
  const endPct    = (endCell   / GRID_TOTAL_CELLS) * 100

  // Active-stop highlight targets: in-region stops (or merged chord cells) with
  // their position inside the loop, ascending. Rebuilt on each render (below);
  // the ticker toggles `.active` on the DOM so playback never re-renders the rail.
  // After any render React may have rewritten the dots' classNames, so forget
  // the applied key and let the next frame put the highlight back.
  const activeTargetsRef = useRef([])
  const activeKeyRef     = useRef(null)
  useLayoutEffect(() => { activeKeyRef.current = null })

  // Drive the playhead from the track's local part progress so a shrunk
  // section visibly loops at its own (faster) rate.
  useEffect(() => {
    const el   = needleRef.current
    const rail = railRef.current
    if (!el || !rail) return undefined
    const setActive = (key) => {
      if (key === activeKeyRef.current) return
      rail.querySelectorAll('.stop-dot.active').forEach(d => d.classList.remove('active'))
      if (key != null) {
        rail.querySelectorAll(`.stop-dot[data-akey="${CSS.escape(key)}"]`).forEach(d => d.classList.add('active'))
      }
      activeKeyRef.current = key
    }
    if (!started || !visible) {
      el.style.transform = `translateX(${startPct}%)`
      setActive(null)
      return undefined
    }
    const unsubscribe = subscribePlayhead(() => {
      const bpm = Tone.Transport.bpm.value || 120
      const loopSec = (16 / bpm) * 60  // 4 bars
      const partLoopSec = (regionLen / GRID_TOTAL_CELLS) * loopSec / (speed || 1)
      const t = Tone.getTransport().seconds
      const local = partLoopSec > 0 ? ((t % partLoopSec) + partLoopSec) % partLoopSec / partLoopSec : 0
      const x = startPct + local * (endPct - startPct)
      // The needle is a full-width track, so translateX(x%) is x% of the rail.
      el.style.transform = `translateX(${x}%)`
      // Active stop: the last in-region target whose loop position <= local progress.
      if (mode === 'mock') {
        let key = null
        for (const target of activeTargetsRef.current) {
          if (target.rel <= local) key = target.key
          else break
        }
        setActive(key)
      }
      // Dim the rail while its loop pattern sits this pass out. Toggled on the
      // DOM, not via state, so the per-frame tick doesn't re-render the rail.
      // Counted in ticks like the engine's _laneGate (a Part's loop is fixed in
      // ticks, so BPM changes don't shift it); MixerTab anchors Parts at 0.
      const rail = railRef.current
      if (rail && loopPattern?.rest) {
        const transport = Tone.getTransport()
        const loopTicks = (regionLen / GRID_TOTAL_CELLS) * 16 * transport.PPQ / (speed || 1)
        rail.classList.toggle('stop-rail--resting',
          !loopPlays(loopIndexAt(transport.ticks, 0, loopTicks), loopPattern))
      } else {
        rail.classList.remove('stop-rail--resting')
      }
    })
    return () => {
      unsubscribe()
      setActive(null)
      rail.classList.remove('stop-rail--resting')
    }
  }, [started, visible, mode, speed, startPct, endPct, regionLen, loopPattern])

  // ── Loop handles (pointer + keyboard, shared with AutoCurveRail) ─────────
  const loopHandleProps = useLoopHandles({ railRef, startCell, endCell, onLoopRegion })

  if (!route.stops.length) return <div className="stop-rail stop-rail--empty" />

  const total = route.totalDist || route.stops[route.stops.length - 1]?.dist || 1
  const PAD   = 0.1  // keep dots 10% from top/bottom edges

  const scaleIntervals = SCALES[trackScale.scaleType] ?? SCALES.major

  // Snap all stops to grid cells — this is the canonical X position
  const gridStops = snapStopsToGrid(route.stops, total, noteTotalCells, noteStepsPerBar)

  // Always compute lat range for vehicle markers in live mode
  const lats     = route.stops.map(s => s.lat).filter(v => v != null)
  const minLat   = lats.length ? Math.min(...lats) : 0
  const maxLat   = lats.length ? Math.max(...lats) : 1
  const latRange = Math.max(maxLat - minLat, 0.0001)

  // Two-axis geographic pitch map — same mapping the engine plays (engine.js):
  // latitude → scale degree, longitude → octave register, plus the lane's
  // pitch-variety opts, then the per-track octave and chromatic shifts. The
  // y-axis renders it piano-roll style.
  // Shared with the phone lane sheet via lib/laneNotes.js, so both views resolve
  // notes in the same order the engine does (offset → octave → transpose).
  const { pitchMap, geoDisplayMap } = buildLanePitchMaps(route, {
    scale: trackScale, pitchVariety, perStopSteps, octaveShift, semitoneShift,
  })
  const stopPoints = (() => {
    const midis     = pitchMap.map(n => noteToMidi(n))
    const midiMin   = Math.min(...midis)
    const midiMax   = Math.max(...midis)
    const midiRange = Math.max(midiMax - midiMin, 1)
    return gridStops.map((stop) => {
      const x        = (stop.cellIdx / noteTotalCells) * 100
      // Automation-mirror mode: position dots by the lane's authored value, not pitch.
      if (automationValues) {
        const v = automationValues[stop.id] ?? 0.5
        return { ...stop, x, y: autoValueToY(v), noteName: `${Math.round(v * 100)}%` }
      }
      const noteName = pitchMap[stop.originalIdx] ?? '—'
      const midi     = noteToMidi(noteName)
      const y        = (PAD + (1 - (midi - midiMin) / midiRange) * (1 - PAD * 2)) * 100
      return { ...stop, x, y, noteName }
    })
  })()

  // Merged (PolySynth chord) lane: overlay EVERY source lane's notes on one shared
  // pitch axis, so simultaneous notes read as vertically-stacked chords at the same x.
  // Mirrors the engine's _buildMergedRoutePart exactly — every source is re-pitched
  // through THIS merged lane's scale + octave, then bucketed by grid cell.
  const isMergedRail = !!route.isMerged && route.sourceRoutes?.length > 0
  // Clicking a dot opens the stop editor (pitch + velocity). Not on merged rails
  // (stacked chord sources) or automation-mirror rails.
  const canEdit = !!onStopOpen && !automationValues && !isMergedRail
  const mergedPoints = (() => {
    if (!isMergedRail) return null
    const raw = []
    route.sourceRoutes.forEach((src, si) => {
      if (!src?.stops?.length) return
      const srcTotal = src.totalDist || src.stops[src.stops.length - 1]?.dist || 1
      const srcPitch = generatePitchMap(src.stops, noteToMidi(`${trackScale.root}3`), scaleIntervals, 3,
        { ...(pitchVariety ?? {}), routeId: src.id })
      const srcGrid  = snapStopsToGrid(src.stops, srcTotal, noteTotalCells, noteStepsPerBar)
      for (const stop of srcGrid) {
        const noteName = shiftSemitones(
          shiftOctaveNote(srcPitch[stop.originalIdx] ?? 'C3', octaveShift),
          semitoneShift,
        )
        raw.push({
          key: `${src.id}_${stop.id}_${stop.cellIdx}`, si,
          x: (stop.cellIdx / noteTotalCells) * 100, cellIdx: stop.cellIdx,
          midi: noteToMidi(noteName), noteName,
          color: src.color, srcName: src.name, stopName: stop.name,
        })
      }
    })
    if (!raw.length) return null
    const midis = raw.map(p => p.midi)
    const midiMin = Math.min(...midis), midiMax = Math.max(...midis)
    const midiRange = Math.max(midiMax - midiMin, 1)
    for (const p of raw) p.y = (PAD + (1 - (p.midi - midiMin) / midiRange) * (1 - PAD * 2)) * 100
    return raw
  })()
  // Faint contour polyline per source so each lane's melodic shape stays legible.
  const mergedSourceLines = mergedPoints ? (() => {
    const bySrc = new Map()
    for (const p of mergedPoints) {
      if (!bySrc.has(p.si)) bySrc.set(p.si, { color: p.color, pts: [] })
      bySrc.get(p.si).pts.push(p)
    }
    return [...bySrc.values()].map(({ color, pts }) => ({
      color,
      points: pts.slice().sort((a, b) => a.cellIdx - b.cellIdx).map(p => `${p.x},${p.y}`).join(' '),
    }))
  })() : null

  // Highlight targets for the ticker: a stop id (every dot sharing it lights), or
  // on a merged lane the chord cell (every stacked dot at that cell lights).
  const inRegion = (cellIdx) => cellIdx >= startCell && cellIdx < endCell
  const activeKeyOf = (p) => (mergedPoints ? `c${p.cellIdx}` : String(p.id))
  const targetsByKey = new Map()
  for (const p of (mergedPoints ?? stopPoints)) {
    if (!inRegion(p.cellIdx)) continue
    const key = activeKeyOf(p)
    if (!targetsByKey.has(key)) targetsByKey.set(key, { key, rel: (p.cellIdx - startCell) / regionLen })
  }
  activeTargetsRef.current = [...targetsByKey.values()].sort((a, b) => a.rel - b.rel)

  // Keyboard for editable stop dots: Enter/Space opens the editor (same as a
  // click); arrows move focus along the rail, Home/End to either end.
  const onStopDotKey = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      e.currentTarget.click()
      return
    }
    const dots = [...(railRef.current?.querySelectorAll('.stop-dot--editable') ?? [])]
    const i = dots.indexOf(e.currentTarget)
    let next = null
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = dots[i + 1]
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = dots[i - 1]
    else if (e.key === 'Home') next = dots[0]
    else if (e.key === 'End') next = dots[dots.length - 1]
    else return
    e.preventDefault()
    if (!next) return
    dots.forEach(d => { d.tabIndex = d === next ? 0 : -1 })
    next.focus()
  }

  const vehicleMarkers = mode === 'live'
    ? vehicles.map(v => {
        const ph = resolvePlayhead(route, v.lat, v.lng)
        if (!ph) return null
        const y = v.lat != null
          ? (PAD + (1 - (v.lat - minLat) / latRange) * (1 - PAD * 2)) * 100
          : 50
        return { ...v, pct: ph.pct, y }
      }).filter(Boolean)
    : []

  const polylinePoints = stopPoints.map(p => `${p.x},${p.y}`).join(' ')

  return (
    <div
      className="stop-rail"
      ref={railRef}
      style={{ '--cells-total': noteTotalCells, '--cells-per-beat': noteStepsPerBar / 4 }}
    >
      {/* Dim regions outside the loop band */}
      {startPct > 0 && (
        <div
          className="loop-region-dim"
          style={{ left: 0, width: `${startPct}%` }}
        />
      )}
      {endPct < 100 && (
        <div
          className="loop-region-dim"
          style={{ left: `${endPct}%`, width: `${100 - endPct}%` }}
        />
      )}

      {/* Draggable loop-region handles */}
      <div
        className="loop-handle loop-handle--start"
        style={{ left: `${startPct}%`, '--line-color': route.color }}
        {...loopHandleProps('start')}
        title={`Loop start · cell ${startCell}/${GRID_TOTAL_CELLS}`}
      />
      <div
        className="loop-handle loop-handle--end"
        style={{ left: `${endPct}%`, '--line-color': route.color }}
        {...loopHandleProps('end')}
        title={`Loop end · cell ${endCell}/${GRID_TOTAL_CELLS}`}
      />

      <div
        className={`lane-playhead ${started ? 'active' : ''}`}
        style={{ '--line-color': route.color }}
      >
        <div ref={needleRef} className="lane-playhead-track" />
      </div>

      {/* Bar number labels */}
      {BAR_LABELS.map(({ bar, pct }) => (
        <span
          key={bar}
          className="stop-rail-bar-label"
          style={{ left: `${pct}%` }}
        >
          {bar}
        </span>
      ))}

      <svg className="stop-rail-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
        {mergedSourceLines
          ? mergedSourceLines.map((ln, i) => (
              <polyline key={i} points={ln.points} fill="none" stroke={ln.color} strokeWidth="1.5" opacity="0.2" />
            ))
          : (
            <polyline
              points={polylinePoints}
              fill="none"
              stroke={route.color}
              strokeWidth="1.5"
              opacity="0.25"
            />
          )}
      </svg>

      {mergedPoints
        ? mergedPoints.map((p) => (
            <div
              key={p.key}
              data-akey={activeKeyOf(p)}
              className="stop-dot stop-dot--merged"
              style={{ '--pos': `${p.x}%`, '--y-pos': `${p.y}%`, '--line-color': p.color }}
              title={`${p.srcName} · ${p.stopName} · ${p.noteName}`}
            >
              <span className="stop-note-label">{p.noteName}</span>
            </div>
          ))
        : stopPoints.map((stop, i) => {
        const vel = stopVelocities?.[stop.id]
        const velSuffix = vel != null ? ` · vel ${Math.round(vel * 100)}%` : ''
        const stopChance = stopChances?.[stop.id]
        const chance     = stopChance ?? laneChance
        const chanceSuffix = chance < 1 || stopChance != null ? ` · ${Math.round(chance * 100)}% chance` : ''
        return (
        <div
          key={`${stop.id}_${i}`}
          data-akey={activeKeyOf(stop)}
          className={[
            'stop-dot',
            mode === 'live' ? 'stop-dot--ref' : '',
            canEdit ? 'stop-dot--editable' : '',
            chance < 1 ? 'stop-dot--chance' : '',
          ].filter(Boolean).join(' ')}
          style={{
            '--pos': `${stop.x}%`,
            '--y-pos': `${stop.y}%`,
            '--line-color': route.color,
            '--vel': vel ?? 1,
            '--chance': chance,
          }}
          title={canEdit
            ? `${stop.name} · ${stop.noteName}${velSuffix}${chanceSuffix} — click to edit pitch, velocity & chance`
            : `${stop.name} · bar ${stop.bar + 1} beat ${stop.beat + 1} step ${stop.sixteenth + 1}${velSuffix}${chanceSuffix}`}
          {...(canEdit ? {
            role: 'button',
            // Roving tabindex: one Tab stop per rail, arrows walk the stops.
            tabIndex: i === 0 ? 0 : -1,
            'aria-label': `${stop.name}, ${stop.noteName}${velSuffix}${chanceSuffix}. Edit pitch, velocity and chance`,
            onKeyDown: onStopDotKey,
          } : {})}
          onClick={canEdit
            ? () => onStopOpen({
                routeId: route.id,
                stopId: stop.id,
                stopName: stop.name,
                geoNote: geoDisplayMap[stop.originalIdx],
                degrees: perStopSteps?.[stop.id] ?? 0,
                velocity: vel ?? 1,
                chance: stopChance ?? null,
                laneChance,
                root: trackScale.root,
                scaleType: trackScale.scaleType,
                semitoneShift,
              })
            : undefined}
        >
          <span className="stop-label">{stop.name}</span>
          <span className="stop-note-label">{stop.noteName}</span>
        </div>
        )
      })}

      {vehicleMarkers.map((vm, i) => (
        <div
          key={vm.vehicleId ?? i}
          className="vehicle-marker"
          style={{ '--pos': `${vm.pct}%`, '--y-pos': `${vm.y}%`, '--line-color': route.color }}
          title={`${vm.routeShortName} · ${vm.vehicleId}`}
        />
      ))}
    </div>
  )
}
