import * as Tone from 'tone'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SYNTH_DEFAULTS, availableAutomationTargets, findTargetSpec, SAMPLER_PRESET_LIST, SAMPLER_PRESETS, DRUM_VOICES, DRUM_VOICE_LICENSE, ARP_STYLES, ARP_RATES, DEFAULT_ARP } from '@/lib/engine.js'
import { FX_BUSES, AUTOMATION_TARGETS, FX_PARAM_SPECS, FX_SYNC_TARGETS } from '@/lib/fxTrack.js'
import { generatePitchMap, shiftOctaveNote, noteToMidi, SCALES, hashStopValue, snapStopsToGrid, GRID_TOTAL_CELLS, GRID_BARS, denormalizeToRange, denormalizeExp } from '@/lib/mappings.js'
import './DawView.css'

const SYNTH_TYPES = [
  'Synth', 'FMSynth', 'AMSynth', 'MonoSynth',
  'MembraneSynth', 'MetalSynth', 'NoiseSynth', 'PluckSynth', 'DuoSynth',
  'Sampler', 'Drums',
]

export const NOTE_ROOTS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
export const SCALE_TYPES = [
  ['major',           'Major'],
  ['minor',           'Minor'],
  ['pentatonic',      'Pent.'],
  ['pentatonicMinor', 'Pent. Min'],
  ['dorian',          'Dorian'],
  ['phrygian',        'Phrygian'],
  ['lydian',          'Lydian'],
  ['mixolydian',      'Mixolyd.'],
]

const DRONE_NOTES = NOTE_ROOTS.flatMap(n => [1, 2, 3, 4, 5].map(oct => `${n}${oct}`))

const SPEED_OPTIONS = [
  { value: 0.25, label: '÷4',   title: '0.25× speed — one pass every 4 loops' },
  { value: 0.5,  label: '÷2',   title: '0.5× speed — one pass every 2 loops' },
  { value: 1,    label: '1×',   title: 'Normal speed' },
  { value: 1.5,  label: '×1.5', title: '1.5× speed — 3:2 polyrhythm' },
  { value: 2,    label: '×2',   title: '2× speed — two passes per loop' },
  { value: 3,    label: '×3',   title: '3× speed — three passes per loop' },
  { value: 4,    label: '×4',   title: '4× speed — four passes per loop' },
]

// Arpeggiator display labels (values come from ARP_STYLES / ARP_RATES in engine/mappings)
const ARP_STYLE_LABELS = {
  up: 'Up', down: 'Dn', updown: 'Up/Dn', downup: 'Dn/Up',
  converge: 'Conv', diverge: 'Div', random: 'Rnd',
}
const ARP_RATE_LABELS = {
  '4n': '1/4', '8n': '1/8', '8t': '1/8T', '16n': '1/16', '16t': '1/16T', '32n': '1/32',
}

const OSC_TYPES = ['sine', 'triangle', 'square', 'sawtooth', 'fatsine', 'fattriangle', 'fatsquare', 'fatsawtooth', 'pulse', 'pwm']
const FILTER_TYPES = ['lowpass', 'highpass', 'bandpass', 'notch']
const FILTER_ROLLOFFS = [-12, -24, -48, -96]
const NOISE_TYPES = ['white', 'pink', 'brown']

const DEFAULT_FILTER = { type: 'lowpass', frequency: 20000, Q: 4 }
const DEFAULT_EQ     = { low: 0, mid: 0, high: 0, lowFrequency: 400, highFrequency: 2500 }

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

export default function DawView({
  className = '',
  mode, started, events, routes, onRepickType,
  volumes, muted, pans, soloRoutes,
  liveSnapshot, snapshotLoading,
  trackSoundModes, trackScales, trackSynthTypes, trackADSRs, trackFilters, trackEqs,
  sendMatrix, automationCfg, automationSourceIds,
  fxBusWet, activeFxTracks, masterVolume, trackOctaves, trackGlides, trackLegatos, trackArps, trackSpeeds, trackLoopRegions,
  trackDroneModes, trackDroneRoots, onDroneMode, onDroneRoot,
  onVolume, onMute, onPan, onSolo,
  onSoundMode, onScale, onSynthType, onADSR, onSamplerPreset, onDrumVoice, onSamplerUpload, onFilter, onEq,
  onSendLevel, onFxBusWet, fxBusMuted, fxBusSoloed, onFxBusMute, onFxBusSolo,
  fxBusParams, onFxBusParam, onFxBusCustomIR,
  onAddFxTrack, onRemoveFxTrack, onMasterVolume,
  onOctaveShift, onGlide, onLegato, onArp, onTrackSpeed, onTrackLoopRegion,
  onAddAutomationLane, onRemoveAutomationLane, onUpdateAutomationLane,
  onRefetch, onVehicleCrossed, onExportRouteMidi,
}) {
  const tracksRef             = useRef(null)
  const animRef               = useRef(null)
  const lastProgressRef       = useRef(0)
  const lastProgressUpdateRef = useRef(0)
  const [playheadProgress, setPlayheadProgress] = useState(0)

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

  useEffect(() => {
    if (!started) {
      cancelAnimationFrame(animRef.current)
      setPlayheadProgress(0)
      lastProgressRef.current = 0
      return
    }

    const tick = () => {
      const progress = Tone.getTransport().progress

      const now = performance.now()
      if (now - lastProgressUpdateRef.current > 66) {
        setPlayheadProgress(progress)
        lastProgressUpdateRef.current = now
      }

      if (mode === 'live' && routes && liveSnapshot) {
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
      }

      lastProgressRef.current = progress
      animRef.current = requestAnimationFrame(tick)
    }

    animRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(animRef.current)
  }, [started, mode, routes, liveSnapshot, vehiclesByRoute, onVehicleCrossed])

  const srcIds = automationSourceIds ?? new Set()

  // sourceRouteId → first instrument routeId that uses it
  const sourceToInst = useMemo(() => {
    const map = {}
    for (const [instId, lanes] of Object.entries(automationCfg ?? {}))
      for (const lane of Object.values(lanes))
        if (lane?.sourceRouteId && !map[lane.sourceRouteId])
          map[lane.sourceRouteId] = instId
    return map
  }, [automationCfg])

  // Source routes rendered inside their instrument's track-group, not their own section
  const SECTIONS = [
    { type: 'metro',   label: 'Metro' },
    { type: 'tram',    label: 'Tram' },
    { type: 'trolley', label: 'Trolley' },
    { type: 'bus',     label: 'Bus' },
  ]
  const routesByType = Object.fromEntries(
    SECTIONS.map(s => [s.type, routes?.filter(r => r.type === s.type && !srcIds.has(r.id)) ?? []])
  )
  // All routes by id for source picker lookups
  const routeById = useMemo(() => {
    const map = {}
    for (const r of routes ?? []) map[r.id] = r
    return map
  }, [routes])

  return (
    <div className={`daw-body${className ? ` ${className}` : ''}`}>
      <main className="daw-tracks" ref={tracksRef}>

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
                    progress={playheadProgress}
                    volume={volumes[route.id] ?? 0}
                    muted={muted[route.id] ?? false}
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
                    onMute={() => onMute(route.id)}
                    onPan={v => onPan(route.id, v)}
                    onSolo={() => onSolo(route.id)}
                    octaveShift={trackOctaves?.[route.id] ?? 0}
                    glide={trackGlides?.[route.id] ?? 0}
                    legato={trackLegatos?.[route.id] ?? false}
                    arp={trackArps?.[route.id]}
                    speed={trackSpeeds?.[route.id] ?? 1}
                    loopRegion={trackLoopRegions?.[route.id]}
                    onLoopRegion={r => onTrackLoopRegion(route.id, r)}
                    onSoundMode={m => onSoundMode(route.id, route.name, m)}
                    onScale={s => onScale(route.id, route.name, s)}
                    onSynthType={st => onSynthType(route.id, route.type, st)}
                    onADSR={p => onADSR(route.id, p)}
                    onSamplerPreset={id => onSamplerPreset(route.id, route.type, id)}
                    onDrumVoice={id => onDrumVoice(route.id, route.type, id)}
                    onSamplerUpload={(file, note) => onSamplerUpload(route.id, file, note)}
                    filter={trackFilters?.[route.id] ?? DEFAULT_FILTER}
                    eq={trackEqs?.[route.id] ?? DEFAULT_EQ}
                    onFilter={p => onFilter(route.id, p)}
                    onEq={p => onEq(route.id, p)}
                    onOctaveShift={shift => onOctaveShift(route.id, shift)}
                    onGlide={s => onGlide(route.id, s)}
                    onLegato={en => onLegato(route.id, en)}
                    onArp={params => onArp(route.id, params)}
                    onSpeed={m => onTrackSpeed(route.id, m)}
                    onDroneMode={en => onDroneMode(route.id, en)}
                    onDroneRoot={n => onDroneRoot(route.id, n)}
                    onAddLane={() => onAddAutomationLane(route.id)}
                    onExportRouteMidi={onExportRouteMidi}
                  />
                  {attachedSrcIds.map(srcId => (
                    <AutomationSourceTrack
                      key={srcId}
                      srcRoute={routeById[srcId]}
                      instRoute={route}
                      automationCfg={automationCfg}
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
                      synthType={trackSynthTypes?.[route.id] ?? 'Synth'}
                      started={started}
                      srcLoopRegion={trackLoopRegions?.[laneCfg.sourceRouteId]}
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

      </main>

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

      <DawFooter
        activeFxTracks={activeFxTracks ?? []}
        masterVolume={masterVolume ?? 0}
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
    </div>
  )
}

// ── Individual instrument track row ──────────────────────────────────────────
function LineTrack({
  route, mode, started, progress, volume, muted, pan, isSoloed,
  vehicles, soundMode, trackScale, synthType, adsr,
  filter, eq,
  droneMode, droneRoot,
  laneCount, autoTargets = {}, activeFxTracks, sendMatrix, octaveShift, glide, legato, arp, speed,
  loopRegion, onLoopRegion,
  onVolume, onMute, onPan, onSolo, onSoundMode, onScale, onSynthType, onADSR,
  onSamplerPreset, onDrumVoice, onSamplerUpload,
  onFilter, onEq,
  onSendLevel, onOctaveShift, onGlide, onLegato, onArp, onSpeed, onDroneMode, onDroneRoot, onAddLane,
  onExportRouteMidi,
}) {
  const [rackOpen, setRackOpen] = useState(false)

  // Automation locks: when a lane targets one of these, the control greys out and (during
  // playback) reads the swept value. Pan/glide convert from the spec unit to the slider unit.
  const aVol = autoCtl(autoTargets, 'volume')
  const aPan = autoCtl(autoTargets, 'pan',   { divide: 100 })
  const aGli = autoCtl(autoTargets, 'glide', { divide: 1000 })
  const volDisp = aVol.display != null ? Math.round(aVol.display) : volume
  const panDisp = aPan.display != null ? aPan.display : pan
  const gliDisp = aGli.display != null ? aGli.display : (glide ?? 0)

  return (
    <div className={`line-track ${muted ? 'line-track--muted' : ''} ${rackOpen ? 'line-track--open' : ''}`}>
      <div className="lt-top">
        <div className="line-label" style={{ borderColor: route.color }}>
          <div className="line-label-top">
            <span className="line-badge" style={{ background: route.color, color: route.textColor }}>
              {route.name}
            </span>
            <button
              className={`add-lane-btn ${laneCount > 0 ? 'has-lanes' : ''}`}
              onClick={onAddLane}
              title="Add automation lane"
            >
              {laneCount > 0 ? `+${laneCount}` : '+'}
            </button>
          </div>
          <span className="line-desc">{route.desc}</span>
        </div>

        <div className="lt-mix">
          <button className={`mute-btn ${muted ? 'active' : ''}`} onClick={onMute} title={muted ? 'Unmute' : 'Mute'}>M</button>
          <button className={`solo-btn ${isSoloed ? 'active' : ''}`} onClick={onSolo} title="Solo">S</button>
          <input type="range" min="-40" max="6" step="1"
            value={volDisp} onChange={e => onVolume(Number(e.target.value))}
            disabled={aVol.disabled} className="volume-slider" />
          <span className="volume-val">{volDisp}dB</span>
          <span className="lt-mix-sep" />
          <span className="pan-label">PAN</span>
          <input type="range" min="-1" max="1" step="0.01"
            value={panDisp} onChange={e => onPan(parseFloat(e.target.value))}
            onDoubleClick={() => !aPan.disabled && onPan(0)}
            disabled={aPan.disabled} className="pan-slider" />
          <span className="pan-val">
            {panDisp === 0 ? 'C' : panDisp < 0 ? `L${Math.round(-panDisp * 100)}` : `R${Math.round(panDisp * 100)}`}
          </span>
          <span className="lt-mix-sep" />
          <button
            type="button"
            className="midi-export-btn"
            onClick={() => onExportRouteMidi?.(route.id)}
            disabled={!route.stops?.length}
            title="Download MIDI for this line (session if recorded, else 4-bar loop)"
          >↓</button>
        </div>

        <div className="lt-spacer" />

        <button
          className={`rack-toggle ${rackOpen ? 'active' : ''}`}
          onClick={() => setRackOpen(o => !o)}
          title={rackOpen ? 'Collapse device rack' : 'Expand device rack'}
        >
          DEVICE RACK
          <span className={`rack-chevron ${rackOpen ? 'up' : ''}`}>▾</span>
        </button>
      </div>

      <StopRail
        route={route}
        progress={progress}
        speed={speed ?? 1}
        started={started}
        mode={mode}
        vehicles={vehicles}
        trackScale={trackScale}
        octaveShift={octaveShift ?? 0}
        loopRegion={loopRegion}
        onLoopRegion={onLoopRegion}
      />

      {rackOpen && (
        <div className="device-rack">
          <div className="rack-card">
            <div className="rack-card-head">Instrument</div>
            <select className="synth-select" value={synthType} onChange={e => onSynthType(e.target.value)}>
              {SYNTH_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <div className="sound-mode-row">
              <button className={`sound-mode-btn ${droneMode ? 'active' : ''}`}
                onClick={() => onDroneMode(!droneMode)}
                title={droneMode ? 'Switch to note mode' : 'Switch to drone mode'}>
                {droneMode ? 'Drone' : 'Note'}
              </button>
              {droneMode ? (
                <select className="scale-root-select" value={droneRoot ?? 'C3'}
                  onChange={e => onDroneRoot(e.target.value)}>
                  {DRONE_NOTES.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              ) : (
                <>
                  <button className={`sound-mode-btn ${soundMode === 'percussive' ? 'active' : ''}`}
                    onClick={() => onSoundMode('percussive')}>Perc</button>
                  <button className={`sound-mode-btn ${soundMode === 'harmonic' ? 'active' : ''}`}
                    onClick={() => onSoundMode('harmonic')}>Harm</button>
                  {soundMode === 'harmonic' && (
                    <>
                      <select className="scale-root-select" value={trackScale.root}
                        onChange={e => onScale({ ...trackScale, root: e.target.value })}>
                        {NOTE_ROOTS.map(n => <option key={n} value={n}>{n}</option>)}
                      </select>
                      <select className="scale-type-select" value={trackScale.scaleType}
                        onChange={e => onScale({ ...trackScale, scaleType: e.target.value })}>
                        {SCALE_TYPES.map(([key, label]) => (
                          <option key={key} value={key}>{label}</option>
                        ))}
                      </select>
                    </>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="rack-card">
            <div className="rack-card-head">{synthType}</div>
            <EnvPanel synthType={synthType} adsr={adsr} onADSR={onADSR} onSamplerPreset={onSamplerPreset} onDrumVoice={onDrumVoice} onSamplerUpload={onSamplerUpload} autoTargets={autoTargets} />
          </div>

          <div className="rack-card">
            <div className="rack-card-head">Filter</div>
            <FilterPanel filter={filter} onFilter={onFilter} autoTargets={autoTargets} />
          </div>

          <div className="rack-card">
            <div className="rack-card-head">EQ</div>
            <EqPanel eq={eq} onEq={onEq} />
          </div>

          <div className="rack-card">
            <div className="rack-card-head">Motion</div>
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
                onChange={e => onGlide(parseFloat(e.target.value))}
                onDoubleClick={() => !aGli.disabled && onGlide(0)}
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
          </div>

          {(() => {
            const ag = { ...DEFAULT_ARP, ...arp }
            const arpOn = !!ag.enabled
            const dim = arpOn ? {} : { opacity: 0.4, pointerEvents: 'none' }
            return (
              <div className="rack-card">
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
                    onChange={e => onArp({ gate: parseFloat(e.target.value) })}
                    onDoubleClick={() => onArp({ gate: 0.5 })}
                    className="glide-slider"
                  />
                  <span className="glide-val">{Math.round(ag.gate * 100)}%</span>
                </div>
              </div>
            )
          })()}

          {activeFxTracks?.length > 0 && (
            <div className="rack-card">
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
      )}
    </div>
  )
}

// ── Automation lane (sub-row below instrument track) ─────────────────────────
function AutomationLane({ laneId, instRoute, laneCfg, allRoutes, activeFxTracks, synthType = 'Synth', started = false, srcLoopRegion, onUpdate, onRemove, onLiveValue }) {
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
  const pickableRoutes = allRoutes.filter(r => r.id !== instRoute.id)

  // Target options, grouped by .group, filtered to what's valid for this synth type.
  const groupedTargets = useMemo(() => {
    const groups = {}
    for (const t of availableAutomationTargets(synthType, activeFxTracks ?? [])) {
      const g = t.group ?? 'Other'
      ;(groups[g] ??= []).push(t)
    }
    return groups
  }, [synthType, activeFxTracks])

  return (
    <div className="automation-lane">
      <div className="auto-lane-label">
        <span className="auto-lane-badge">AUTO</span>
      </div>

      <div className="auto-lane-controls">
        <select className="auto-select auto-select--source-line" value={sourceRouteId}
          onChange={e => onUpdate({ sourceRouteId: e.target.value })}>
          <option value="">— pick line —</option>
          {pickableRoutes.map(r => (
            <option key={r.id} value={r.id}>{r.name} {r.desc ? `· ${r.desc}` : ''}</option>
          ))}
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
            onChange={e => onUpdate({ glide: parseFloat(e.target.value) })}
            onDoubleClick={() => onUpdate({ glide: 0 })}
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
        speed={speed}
        loopRegion={effectiveRegion}
        onLoopRegion={region => onUpdate({ loopRegion: region })}
        onUpdate={onUpdate}
        onActiveValue={handleActiveValue}
      />
    </div>
  )
}

// ── Automation source track (data-only, shown inside instrument's track-group) ─
function AutomationSourceTrack({ srcRoute, instRoute, automationCfg }) {
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
      <StopRail route={srcRoute} progress={0} mode="mock" vehicles={[]} automationValues={automationValues} />
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
function AutoCurveRail({ route, laneId, points, spec, started = false, speed = 1, loopRegion, onLoopRegion, onUpdate, onActiveValue }) {
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

  useEffect(() => {
    const el = needleRef.current
    if (!el) return
    const dots = () => (railRef.current ? [...railRef.current.querySelectorAll('.auto-dot')] : [])
    const clearActive = () => dots().forEach(d => d.classList.remove('active'))
    if (!started) { el.style.left = `${startPct}%`; clearActive(); onActiveValue?.(null); return }
    let rafId
    let lastActive = -1
    const tick = () => {
      const bpm = Tone.Transport.bpm.value || 120
      const loopSec = (16 / bpm) * 60
      const partLoopSec = (regionLen / GRID_TOTAL_CELLS) * loopSec / (speed || 1)
      const t = Tone.getTransport().seconds
      const local = partLoopSec > 0 ? ((t % partLoopSec) + partLoopSec) % partLoopSec / partLoopSec : 0
      const playLeft = startPct + local * (endPct - startPct)
      el.style.left = `${playLeft}%`
      // Highlight the point currently in effect: the last dot the needle has passed.
      const ds = dots()
      let active = -1
      for (let i = 0; i < ds.length; i++) {
        if (parseFloat(ds[i].dataset.x) <= playLeft) active = i
      }
      if (active !== lastActive) {
        ds.forEach((d, i) => d.classList.toggle('active', i === active))
        lastActive = active
        // Surface the value now in effect so the parent can drive the instrument control.
        onActiveValue?.(active >= 0 ? (stopPointsRef.current[active]?.value ?? null) : null)
      }
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(rafId); clearActive(); onActiveValue?.(null) }
  }, [started, speed, startPct, endPct, regionLen, onActiveValue])

  // ── Loop-handle drag (mirrors StopRail) ───────────────────────────────────
  const cellFromClientX = useCallback((clientX) => {
    const rect = railRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return 0
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    return Math.round(frac * GRID_TOTAL_CELLS)
  }, [])

  const dragRef = useRef(null)  // 'start' | 'end' | null
  useEffect(() => {
    const onMove = (e) => {
      if (!dragRef.current || !onLoopRegion) return
      const cell = cellFromClientX(e.clientX)
      if (dragRef.current === 'start') {
        const newStart = Math.max(0, Math.min(endCell - 1, cell))
        if (newStart !== startCell) onLoopRegion({ startCell: newStart, endCell })
      } else {
        const newEnd = Math.max(startCell + 1, Math.min(GRID_TOTAL_CELLS, cell))
        if (newEnd !== endCell) onLoopRegion({ startCell, endCell: newEnd })
      }
    }
    const onUp = () => { dragRef.current = null }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup',   onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup',   onUp)
    }
  }, [startCell, endCell, cellFromClientX, onLoopRegion])

  const handlePointerDown = (which) => (e) => {
    e.preventDefault()
    e.stopPropagation()
    dragRef.current = which
  }
  // Double-click a handle clears the per-lane override → inherit the source region.
  const handleReset = (e) => { e.preventDefault(); e.stopPropagation(); onLoopRegion?.(null) }

  const stopPoints = useMemo(() => {
    if (!route?.stops?.length) return []
    const gridStops = snapStopsToGrid(route.stops, route.totalDist)
    return gridStops.map((stop) => {
      const override = points?.[stop.id]
      const value = (typeof override === 'number') ? override : hashStopValue(laneId, stop.id)
      const x = ((stop.cellIdx + 0.5) / GRID_TOTAL_CELLS) * 100
      return { id: stop.id, name: stop.name, x, y: autoValueToY(value), value }
    })
  }, [route, laneId, points])
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
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    setDragId(null)
  }, [dragId])

  const unit = spec?.unit ?? ''
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
            onPointerDown={handlePointerDown('start')}
            onDoubleClick={handleReset}
            title={`Loop start · cell ${startCell}/${GRID_TOTAL_CELLS} (double-click to reset)`}
          />
          <div
            className="loop-handle loop-handle--end"
            style={{ left: `${endPct}%`, '--line-color': route.color }}
            onPointerDown={handlePointerDown('end')}
            onDoubleClick={handleReset}
            title={`Loop end · cell ${endCell}/${GRID_TOTAL_CELLS} (double-click to reset)`}
          />
        </>
      )}

      <svg className="auto-curve-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
        <polyline points={polylinePoints} fill="none" stroke={route.color} strokeWidth="1.5" opacity="0.45" />
      </svg>
      <div
        ref={needleRef}
        className={`lane-playhead auto-playhead ${started ? 'active' : ''}`}
        style={{ '--line-color': route.color }}
      />
      {stopPoints.map((p) => (
        <button
          key={p.id}
          type="button"
          data-x={p.x}
          className={`auto-dot ${dragId === p.id ? 'dragging' : ''}`}
          style={{ left: `${p.x}%`, top: `${p.y}%`, '--line-color': route.color }}
          title={`${p.name} · ${spec ? `${(spec.curve === 'exp' ? denormalizeExp(p.value, spec.min, spec.max) : denormalizeToRange(p.value, spec.min, spec.max)).toFixed(2)}${unit}` : `${Math.round(p.value * 100)}%`}`}
          onPointerDown={e => onDotDown(e, p.id)}
          onPointerMove={e => onDotMove(e, p.id)}
          onPointerUp={e => onDotUp(e, p.id)}
          onPointerCancel={e => onDotUp(e, p.id)}
        />
      ))}
    </div>
  )
}

// ── DAW Footer ────────────────────────────────────────────────────────────────
function DawFooter({
  activeFxTracks, masterVolume,
  fxBusWet, fxBusMuted, fxBusSoloed, fxBusParams,
  onMasterVolume, onFxBusWet, onFxBusMute, onFxBusSolo, onFxBusParam, onFxBusCustomIR,
  onAddFxTrack, onRemoveFxTrack,
}) {
  return (
    <footer className="daw-footer">
      <div className="daw-footer-inner">
        <MasterStrip volume={masterVolume} onVolume={onMasterVolume} />
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
          className="master-vol-slider"
        />
        <span className="master-vol-val">{volume}dB</span>
      </div>
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
        <button className={`mute-btn ${muted ? 'active' : ''}`} onClick={onMute} title="Mute">M</button>
        <button className={`solo-btn ${soloed ? 'active' : ''}`} onClick={onSolo} title="Solo">S</button>
        <input
          type="range" min="0" max="1" step="0.01"
          value={wet}
          onChange={e => onWet(parseFloat(e.target.value))}
          className="fx-track-wet-slider"
        />
        <span className="fx-track-wet-val">{Math.round(wet * 100)}%</span>
        <button className="fx-track-remove-btn" onClick={onRemove} title="Remove FX track">×</button>
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

function FxParamControl({ spec, value, onChange, disabled = false }) {
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
  const decimals = spec.step < 0.01 ? 3 : spec.step < 1 ? 2 : 0
  return (
    <div className={`fx-param-row ${disabled ? 'fx-param-row--disabled' : ''}`}>
      <span className="fx-param-label">{spec.label}</span>
      <input
        type="range"
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={v}
        disabled={disabled}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="fx-param-slider"
      />
      <span className="fx-param-val">
        {disabled ? 'synced' : `${displayVal.toFixed(decimals)}${spec.unit ? ` ${spec.unit}` : ''}`}
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
      <SpSlider label="Noise" min={0} max={1}    step={0.01} {...a('attackNoise', p.attackNoise ?? 1)}  onChange={v => onADSR({ attackNoise: v })} />
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
      <SpSlider label="Freq"   min={20}  max={20000} step={10}          {...a('filterFrequency', p.filterFrequency ?? 800)} onChange={v => onADSR({ filterFrequency: v })} unit="Hz" />
      <SpSelect label="Roll"   value={String(p.filterRolloff ?? -12)}   options={FILTER_ROLLOFFS.map(String)} onChange={v => onADSR({ filterRolloff: Number(v) })} />
      <SpSlider label="Q"      min={0.1} max={20}   step={0.1}          {...a('filterQ', p.filterQ ?? 1)}                   onChange={v => onADSR({ filterQ: v })} />
      <SpSection label="FILTER ENV" />
      <SpSlider label="A"      min={0.001} max={2}  step={0.001}        {...a('filterEnvAttack', p.filterEnvAttack ?? 0.001)}  onChange={v => onADSR({ filterEnvAttack: v })} />
      <SpSlider label="D"      min={0.001} max={2}  step={0.001}        {...a('filterEnvDecay', p.filterEnvDecay ?? 0.3)}      onChange={v => onADSR({ filterEnvDecay: v })} />
      <SpSlider label="S"      min={0} max={1}      step={0.01}         {...a('filterEnvSustain', p.filterEnvSustain ?? 0.3)}  onChange={v => onADSR({ filterEnvSustain: v })} />
      <SpSlider label="R"      min={0.01} max={4}   step={0.01}         {...a('filterEnvRelease', p.filterEnvRelease ?? 0.8)}  onChange={v => onADSR({ filterEnvRelease: v })} />
      <SpSlider label="Base"   min={20}  max={20000} step={10}          value={p.filterEnvBaseFreq ?? 200}   onChange={v => onADSR({ filterEnvBaseFreq: v })} unit="Hz" />
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
      <SpSelect label="Type"    value={p.voice0OscType ?? 'sawtooth'} options={OSC_TYPES} onChange={v => onADSR({ voice0OscType: v })} />
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

function EqPanel({ eq, onEq }) {
  const p = { ...DEFAULT_EQ, ...eq }
  return (
    <div className="sp-panel">
      <SpSlider label="Low"   min={-24} max={24}   step={0.5} value={p.low}           onChange={v => onEq({ low: v })}  unit="dB" />
      <SpSlider label="Mid"   min={-24} max={24}   step={0.5} value={p.mid}           onChange={v => onEq({ mid: v })}  unit="dB" />
      <SpSlider label="High"  min={-24} max={24}   step={0.5} value={p.high}          onChange={v => onEq({ high: v })} unit="dB" />
      <SpSlider label="LoFq"  min={100} max={1000} step={10}  value={p.lowFrequency}  onChange={v => onEq({ lowFrequency: v })}  unit="Hz" />
      <SpSlider label="HiFq"  min={1000} max={8000} step={50} value={p.highFrequency} onChange={v => onEq({ highFrequency: v })} unit="Hz" />
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
  route, progress = 0, speed = 1, started = false, mode = 'mock', vehicles = [],
  trackScale = { root: 'C', scaleType: 'major' }, octaveShift = 0,
  loopRegion, onLoopRegion, automationValues = null,
}) {
  const needleRef = useRef(null)
  const railRef   = useRef(null)

  const startCell = Math.max(0, Math.min(GRID_TOTAL_CELLS - 1, Math.round(loopRegion?.startCell ?? 0)))
  const endCell   = Math.max(startCell + 1, Math.min(GRID_TOTAL_CELLS, Math.round(loopRegion?.endCell ?? GRID_TOTAL_CELLS)))
  const regionLen = endCell - startCell
  const startPct  = (startCell / GRID_TOTAL_CELLS) * 100
  const endPct    = (endCell   / GRID_TOTAL_CELLS) * 100

  // Drive the playhead from the track's local part progress so a shrunk
  // section visibly loops at its own (faster) rate.
  useEffect(() => {
    const el = needleRef.current
    if (!el) return
    if (!started) {
      el.style.left = `${startPct}%`
      return
    }
    let rafId
    const tick = () => {
      const bpm = Tone.Transport.bpm.value || 120
      const loopSec = (16 / bpm) * 60  // 4 bars
      const partLoopSec = (regionLen / GRID_TOTAL_CELLS) * loopSec / (speed || 1)
      const t = Tone.getTransport().seconds
      const local = partLoopSec > 0 ? ((t % partLoopSec) + partLoopSec) % partLoopSec / partLoopSec : 0
      const x = startPct + local * (endPct - startPct)
      el.style.left = `${x}%`
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [started, speed, startPct, endPct, regionLen])

  // ── Loop-handle drag ──────────────────────────────────────────────────────
  const cellFromClientX = useCallback((clientX) => {
    const rect = railRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return 0
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    return Math.round(frac * GRID_TOTAL_CELLS)
  }, [])

  const dragRef = useRef(null)  // 'start' | 'end' | null
  useEffect(() => {
    const onMove = (e) => {
      if (!dragRef.current || !onLoopRegion) return
      const cell = cellFromClientX(e.clientX)
      if (dragRef.current === 'start') {
        const newStart = Math.max(0, Math.min(endCell - 1, cell))
        if (newStart !== startCell) onLoopRegion({ startCell: newStart, endCell })
      } else {
        const newEnd = Math.max(startCell + 1, Math.min(GRID_TOTAL_CELLS, cell))
        if (newEnd !== endCell) onLoopRegion({ startCell, endCell: newEnd })
      }
    }
    const onUp = () => { dragRef.current = null }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup',   onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup',   onUp)
    }
  }, [startCell, endCell, cellFromClientX, onLoopRegion])

  const handlePointerDown = (which) => (e) => {
    e.preventDefault()
    e.stopPropagation()
    dragRef.current = which
  }

  if (!route.stops.length) return <div className="stop-rail stop-rail--empty" />

  const total = route.totalDist || route.stops[route.stops.length - 1]?.dist || 1
  const PAD   = 0.1  // keep dots 10% from top/bottom edges

  const scaleIntervals = SCALES[trackScale.scaleType] ?? SCALES.major

  // Snap all stops to grid cells — this is the canonical X position
  const gridStops = snapStopsToGrid(route.stops, total)

  // Always compute lat range for vehicle markers in live mode
  const lats     = route.stops.map(s => s.lat).filter(v => v != null)
  const minLat   = lats.length ? Math.min(...lats) : 0
  const maxLat   = lats.length ? Math.max(...lats) : 1
  const latRange = Math.max(maxLat - minLat, 0.0001)

  // Two-axis geographic pitch map — same mapping the engine plays (engine.js):
  // latitude → scale degree, longitude → octave register, then the per-track
  // octave shift. The y-axis renders it piano-roll style.
  const pitchMap = generatePitchMap(route.stops, noteToMidi(`${trackScale.root}3`), scaleIntervals)
    .map(n => shiftOctaveNote(n, octaveShift))
  const stopPoints = (() => {
    const midis     = pitchMap.map(n => noteToMidi(n))
    const midiMin   = Math.min(...midis)
    const midiMax   = Math.max(...midis)
    const midiRange = Math.max(midiMax - midiMin, 1)
    return gridStops.map((stop) => {
      const x        = ((stop.cellIdx + 0.5) / GRID_TOTAL_CELLS) * 100
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

  // Per-track local progress (0..1) inside the loop region — wraps at the
  // shrunken loop length so a 1-bar section completes a cycle in 1 bar.
  const bpm = Tone.Transport.bpm.value || 120
  const loopSec = (16 / bpm) * 60
  const partLoopSec = (regionLen / GRID_TOTAL_CELLS) * loopSec / (speed || 1)
  const transportSec = started ? Tone.getTransport().seconds : 0
  const localProgress = partLoopSec > 0
    ? ((transportSec % partLoopSec) + partLoopSec) % partLoopSec / partLoopSec
    : 0

  // Active stop: last in-region stop whose relative position <= local progress
  const activeStopId = mode === 'mock'
    ? [...stopPoints]
        .filter(s => s.cellIdx >= startCell && s.cellIdx < endCell)
        .reverse()
        .find(s => ((s.cellIdx - startCell) / regionLen) <= localProgress)?.id
    : null

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
    <div className="stop-rail" ref={railRef}>
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
        onPointerDown={handlePointerDown('start')}
        title={`Loop start · cell ${startCell}/${GRID_TOTAL_CELLS}`}
      />
      <div
        className="loop-handle loop-handle--end"
        style={{ left: `${endPct}%`, '--line-color': route.color }}
        onPointerDown={handlePointerDown('end')}
        title={`Loop end · cell ${endCell}/${GRID_TOTAL_CELLS}`}
      />

      <div
        ref={needleRef}
        className={`lane-playhead ${started ? 'active' : ''}`}
        style={{ '--line-color': route.color }}
      />

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
        <polyline
          points={polylinePoints}
          fill="none"
          stroke={route.color}
          strokeWidth="1.5"
          opacity="0.25"
        />
      </svg>

      {stopPoints.map((stop, i) => (
        <div
          key={`${stop.id}_${i}`}
          className={[
            'stop-dot',
            stop.id === activeStopId ? 'active' : '',
            mode === 'live' ? 'stop-dot--ref' : '',
          ].filter(Boolean).join(' ')}
          style={{
            '--pos': `${stop.x}%`,
            '--y-pos': `${stop.y}%`,
            '--line-color': route.color,
          }}
          title={`${stop.name} · bar ${stop.bar + 1} beat ${stop.beat + 1}.${stop.sixteenth + 1}`}
        >
          <span className="stop-label">{stop.name}</span>
          <span className="stop-note-label">{stop.noteName}</span>
        </div>
      ))}

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
