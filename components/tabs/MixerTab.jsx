import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as Tone from 'tone'
import { TransitEngine, SYNTH_DEFAULTS } from '@/lib/engine.js'
import { FX_BUSES } from '@/lib/fxTrack.js'
import { randomFromScale, shiftOctaveNote, geoToMidi, routeBounds, midiToNote, noteToMidi, SCALES, MODES } from '@/lib/mappings.js'
import DawView, { NOTE_ROOTS, SCALE_TYPES } from '../DawView.jsx'
import MapView from '../MapView.jsx'
import AIComposerPanel from '../AIComposerPanel.jsx'
import SongMenu from '../SongMenu.jsx'
import { useSongPersistence } from '../../lib/useSongPersistence.js'
import {
  MidiSessionRecorder, exportRouteMidi, exportMixMidi,
  isRouteExportable, isRouteAudible, buildLoopMidiEvents,
} from '@/lib/midiExport.js'

const MAX_EVENTS = 80

const STARTUP_PICKS = { tram: 5, trolley: 5, bus: 5 }

function pickStartupRoutes(allRoutes) {
  const byType = {}
  for (const r of allRoutes) {
    if (!r.stops?.length) continue
    if (!byType[r.type]) byType[r.type] = []
    byType[r.type].push(r)
  }
  const picked = [...(byType.metro ?? [])]
  for (const [type, n] of Object.entries(STARTUP_PICKS)) {
    const pool = [...(byType[type] ?? [])]
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[pool[i], pool[j]] = [pool[j], pool[i]]
    }
    picked.push(...pool.slice(0, n))
  }
  return picked
}

export default function MixerTab() {
  const engineRef        = useRef(null)
  const stoppingRef      = useRef(false)
  const midiRecorderRef  = useRef(null)
  const [hasMidiSession, setHasMidiSession] = useState(false)

  const [view,    setView]    = useState('daw')   // 'map' | 'daw'
  const [mode,    setMode]    = useState('mock')  // 'mock' | 'live'
  const [started, setStarted] = useState(false)
  const [events,  setEvents]  = useState([])

  const [volumes, setVolumes] = useState({})
  const [muted,   setMuted]   = useState({})
  const [pans,    setPans]    = useState({})

  const [trackSoundModes, setTrackSoundModes] = useState({})
  const [trackScales,     setTrackScales]     = useState({})
  const [trackSynthTypes, setTrackSynthTypes] = useState({})
  const [trackADSRs,      setTrackADSRs]      = useState({})
  const [trackFilters,    setTrackFilters]    = useState({})
  const [trackEqs,        setTrackEqs]        = useState({})

  const [sendMatrix, setSendMatrix] = useState({})

  const [automationCfg, setAutomationCfg] = useState({})

  const automationSourceIds = useMemo(() => {
    const ids = new Set()
    for (const lanes of Object.values(automationCfg))
      for (const lane of Object.values(lanes))
        if (lane?.sourceRouteId) ids.add(lane.sourceRouteId)
    return ids
  }, [automationCfg])

  const [fxBusWet, setFxBusWet] = useState(() =>
    Object.fromEntries(FX_BUSES.map(b => [b.id, b.defaults?.wet ?? 1.0]))
  )
  const [fxBusMuted,  setFxBusMuted]  = useState({})
  const [fxBusSoloed, setFxBusSoloed] = useState({})
  const [fxBusParams, setFxBusParams] = useState({})

  const [routes, setRoutes] = useState(null)

  const [soloRoutes, setSoloRoutes] = useState(() => new Set())

  const [bpm, setBpm] = useState(120)

  // Last harmony applied via the global selector (shown when lanes diverge)
  const [globalHarmony, setGlobalHarmony] = useState({ root: 'C', scaleType: 'major' })

  const [activeFxTracks, setActiveFxTracks] = useState([])

  const [masterVolume, setMasterVolume] = useState(0)

  const [trackOctaves,    setTrackOctaves]    = useState({})
  const [trackGlides,     setTrackGlides]     = useState({})
  const [trackLegatos,    setTrackLegatos]    = useState({})
  const [trackDroneModes, setTrackDroneModes] = useState({})
  const [trackDroneRoots, setTrackDroneRoots] = useState({})
  const [trackSpeeds,     setTrackSpeeds]     = useState({})
  const [trackLoopRegions, setTrackLoopRegions] = useState({})

  const [liveSnapshot,    setLiveSnapshot]    = useState(null)
  const [snapshotLoading, setSnapshotLoading] = useState(false)

  useEffect(() => {
    fetch('/data/lines.json')
      .then(r => r.json())
      .then(d => {
        const routes = pickStartupRoutes(d.routes)
        setRoutes(routes)
      })
  }, [])

  useEffect(() => {
    const recorder = new MidiSessionRecorder()
    midiRecorderRef.current = recorder
    const engine = new TransitEngine((ev) => {
      setEvents(prev => [ev, ...prev].slice(0, MAX_EVENTS))
    })
    engine.init()
    engine.setMidiRecorder(recorder)
    engineRef.current = engine
    return () => engine.dispose()
  }, [])

  const fetchSnapshot = useCallback(async () => {
    setSnapshotLoading(true)
    try {
      const res  = await fetch('/api/snapshot')
      const data = await res.json()
      setLiveSnapshot(data)
    } catch (e) {
      console.error('snapshot failed', e)
    } finally {
      setSnapshotLoading(false)
    }
  }, [])

  useEffect(() => {
    if (mode === 'live') fetchSnapshot()
  }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps

  const handlePlayPause = async () => {
    const engine = engineRef.current
    if (!engine) return

    if (started) {
      if (stoppingRef.current) return
      stoppingRef.current = true

      const FADE_OUT = 0.35
      Tone.getDestination().volume.rampTo(-80, FADE_OUT)
      setTimeout(() => {
        engine.stopMock()
        Tone.getDestination().volume.value = masterVolume
        setStarted(false)
        setHasMidiSession(midiRecorderRef.current?.hasData() ?? false)
        stoppingRef.current = false
      }, FADE_OUT * 1000 + 60)
    } else {
      await engine.start()

      // Start silent, fade in after transport starts
      Tone.getDestination().volume.value = -80

      const smMap = {}
      for (const [rid, m] of Object.entries(trackSoundModes)) {
        smMap[rid] = { mode: m, scale: trackScales[rid] ?? { root: 'C', scaleType: 'major' } }
      }

      if (mode === 'mock') {
        engine.startMock(routes ?? [], smMap, bpm, trackSynthTypes, trackADSRs)
      } else {
        engine.startLive(routes ?? [], smMap, bpm, trackSynthTypes, trackADSRs)
      }
      setStarted(true)

      Tone.getDestination().volume.rampTo(masterVolume, 0.5)
    }
  }

  const handleSolo = useCallback((routeId) => {
    setSoloRoutes(prev => {
      const next = new Set(prev)
      if (next.has(routeId)) {
        next.delete(routeId)
        engineRef.current?.setSolo(routeId, false)
      } else {
        next.add(routeId)
        engineRef.current?.setSolo(routeId, true)
      }
      return next
    })
  }, [])

  const handleVehicleCrossed = useCallback((routeId, routeType, lat, stopId) => {
    const { root = 'C', scaleType = 'major' } = trackScales[routeId] ?? {}
    const octave = trackOctaves[routeId] ?? 0
    const route = routes?.find(r => r.id === routeId)
    const stop = stopId != null && route ? route.stops.find(s => s.id === stopId) : null
    const stopLat = lat ?? stop?.lat
    const stopLng = stop?.lon ?? stop?.lng

    let rawNote
    if (stopLat != null) {
      // Two-axis geographic pitch — same mapping the mock rail uses (engine.js),
      // normalized to this line's own lat/lon range so the melody is dynamic.
      const modeScale = SCALES[scaleType] ?? MODES.dorian
      const rootMidi  = noteToMidi(`${root}3`)
      const bounds    = route?.stops ? routeBounds(route.stops) : null
      rawNote = midiToNote(geoToMidi(stopLat, stopLng, rootMidi, modeScale, 3, bounds))
    } else {
      rawNote = randomFromScale(root, scaleType)
    }
    const note = shiftOctaveNote(rawNote, octave)

    engineRef.current?.triggerLiveNote(routeId, routeType, note)
  }, [trackScales, trackOctaves, routes])

  const handleSynthType = useCallback((routeId, routeType, synthType) => {
    setTrackSynthTypes(s => ({ ...s, [routeId]: synthType }))
    const defaults = { ...SYNTH_DEFAULTS[synthType] }
    setTrackADSRs(a => ({ ...a, [routeId]: defaults }))
    engineRef.current?.setSynthType(routeId, routeType, synthType, defaults)
  }, [])

  const handleADSR = useCallback((routeId, params) => {
    setTrackADSRs(a => {
      const next = { ...a, [routeId]: { ...a[routeId], ...params } }
      engineRef.current?.updateEnvelope(routeId, next[routeId])
      return next
    })
  }, [])

  const handleSamplerPreset = useCallback((routeId, routeType, presetId) => {
    setTrackADSRs(a => {
      const next = { ...a, [routeId]: { ...a[routeId], samplerPreset: presetId } }
      engineRef.current?.setSynthType(routeId, routeType, 'Sampler', next[routeId])
      return next
    })
  }, [])

  const handleSamplerUpload = useCallback(async (routeId, file, note) => {
    if (!file) return
    try {
      const buf = await file.arrayBuffer()
      const audioBuffer = await Tone.getContext().rawContext.decodeAudioData(buf)
      engineRef.current?.setSamplerBuffer(routeId, note, audioBuffer)
    } catch (err) {
      console.error('Sampler sample decode failed:', err)
    }
  }, [])

  const handleFilter = useCallback((routeId, params) => {
    setTrackFilters(f => {
      const next = { ...f, [routeId]: { ...f[routeId], ...params } }
      engineRef.current?.setRouteFilter(routeId, params)
      return next
    })
  }, [])

  const handleEq = useCallback((routeId, params) => {
    setTrackEqs(e => {
      const next = { ...e, [routeId]: { ...e[routeId], ...params } }
      engineRef.current?.setRouteEq(routeId, params)
      return next
    })
  }, [])

  const handleSoundMode = (routeId, routeShortName, m) => {
    setTrackSoundModes(s => ({ ...s, [routeId]: m }))
    setTrackScales(s => {
      const scale = s[routeId] ?? { root: 'C', scaleType: 'major' }
      engineRef.current?.setSoundMode(routeShortName, m, scale)
      return s
    })
  }

  const handleScale = (routeId, routeShortName, scale) => {
    setTrackScales(s => ({ ...s, [routeId]: scale }))
    // setScale rebuilds the route's Part, which re-derives the geographic pitch map
    // from the new harmony — no manual pitch map to regenerate.
    engineRef.current?.setScale(routeId, scale)
    setTrackSoundModes(s => {
      engineRef.current?.setSoundMode(routeShortName, s[routeId] ?? 'harmonic', scale)
      return s
    })
  }

  // Apply one harmony to every lane at once.
  const handleGlobalHarmony = (scale) => {
    setGlobalHarmony(scale)
    for (const route of routes ?? []) {
      handleScale(route.id, route.name, scale)
    }
  }

  // Do all lanes currently share one harmony? `common` is that shared value
  // when unified; when lanes diverge, `mixed` is true and the global selector
  // falls back to showing the last globally-applied harmony.
  const { harmonyMixed, harmonyCommon } = useMemo(() => {
    const ids = routes?.map(r => r.id) ?? []
    if (ids.length === 0) return { harmonyMixed: false, harmonyCommon: null }
    const first = trackScales[ids[0]] ?? { root: 'C', scaleType: 'major' }
    for (const id of ids) {
      const sc = trackScales[id] ?? { root: 'C', scaleType: 'major' }
      if (sc.root !== first.root || sc.scaleType !== first.scaleType) {
        return { harmonyMixed: true, harmonyCommon: null }
      }
    }
    return { harmonyMixed: false, harmonyCommon: first }
  }, [routes, trackScales])

  const harmonyValue = harmonyMixed ? globalHarmony : (harmonyCommon ?? globalHarmony)

  const handleSendLevel = useCallback((instRouteId, fxBusId, level) => {
    const key = `${instRouteId}:${fxBusId}`
    setSendMatrix(m => ({ ...m, [key]: level }))
    engineRef.current?.setSendLevel(instRouteId, fxBusId, level)
  }, [])

  const handleFxBusWet = useCallback((busId, value) => {
    setFxBusWet(w => ({ ...w, [busId]: value }))
    engineRef.current?.setFxBusWet(busId, value)
  }, [])

  const handleFxBusMute = useCallback((busId) => {
    setFxBusMuted(m => {
      const next = { ...m, [busId]: !m[busId] }
      engineRef.current?.setFxBusMute(busId, !!next[busId])
      return next
    })
  }, [])

  const handleFxBusParam = useCallback((busId, paramId, value) => {
    setFxBusParams(p => ({
      ...p,
      [busId]: { ...(p[busId] ?? {}), [paramId]: value },
    }))
    engineRef.current?.setFxBusParam(busId, paramId, value)
  }, [])

  const handleFxBusCustomIR = useCallback((busId, audioBuffer) => {
    setFxBusParams(p => ({
      ...p,
      [busId]: { ...(p[busId] ?? {}), irType: 'custom' },
    }))
    engineRef.current?.setFxBusCustomIR(busId, audioBuffer)
  }, [])

  const handleFxBusSolo = useCallback((busId) => {
    setFxBusSoloed(s => {
      const next = { ...s, [busId]: !s[busId] }
      engineRef.current?.setFxBusSolo(busId, !!next[busId])
      return next
    })
  }, [])

  const handleMasterVolume = useCallback((db) => {
    setMasterVolume(db)
    Tone.getDestination().volume.value = db
  }, [])

  const handleOctaveShift = useCallback((routeId, shift) => {
    setTrackOctaves(o => ({ ...o, [routeId]: shift }))
    engineRef.current?.setOctaveShift(routeId, shift)
  }, [])

  const handleGlide = useCallback((routeId, seconds) => {
    setTrackGlides(g => ({ ...g, [routeId]: seconds }))
    engineRef.current?.setGlide(routeId, seconds)
  }, [])

  const handleLegato = useCallback((routeId, enabled) => {
    setTrackLegatos(l => ({ ...l, [routeId]: enabled }))
    engineRef.current?.setLegato(routeId, enabled)
  }, [])

  const handleDroneMode = useCallback((routeId, enabled) => {
    setTrackDroneModes(m => ({ ...m, [routeId]: enabled }))
    setTrackDroneRoots(r => {
      const root = r[routeId] ?? 'C3'
      engineRef.current?.setDroneMode(routeId, enabled, root)
      return r
    })
  }, [])

  const handleDroneRoot = useCallback((routeId, note) => {
    setTrackDroneRoots(r => ({ ...r, [routeId]: note }))
    engineRef.current?.setDroneRoot(routeId, note)
  }, [])

  const handleTrackSpeed = useCallback((routeId, multiplier) => {
    setTrackSpeeds(s => ({ ...s, [routeId]: multiplier }))
    engineRef.current?.setTrackSpeed(routeId, multiplier)
  }, [])

  const handleTrackLoopRegion = useCallback((routeId, region) => {
    setTrackLoopRegions(r => ({ ...r, [routeId]: region }))
    engineRef.current?.setTrackLoopRegion(routeId, region)
  }, [])

  const handleAddFxTrack = useCallback((busId) => {
    setActiveFxTracks(prev => prev.includes(busId) ? prev : [...prev, busId])
  }, [])

  const handleRemoveFxTrack = useCallback((busId) => {
    setActiveFxTracks(prev => prev.filter(id => id !== busId))
    if (routes) {
      for (const route of routes) {
        const key = `${route.id}:${busId}`
        setSendMatrix(m => ({ ...m, [key]: 0 }))
        engineRef.current?.setSendLevel(route.id, busId, 0)
      }
    }
  }, [routes])

  const handleAddAutomationLane = useCallback((routeId) => {
    const laneId = `lane_${Date.now()}`
    const cfg = { sourceRouteId: '', source: 'arrival.delay', paramTarget: 'send.reverb', mode: 'live' }
    setAutomationCfg(a => ({
      ...a,
      [routeId]: { ...(a[routeId] ?? {}), [laneId]: cfg },
    }))
    engineRef.current?.addAutomationLane(routeId, laneId, cfg)
  }, [])

  const handleRemoveAutomationLane = useCallback((routeId, laneId) => {
    setAutomationCfg(a => {
      const lanes = { ...(a[routeId] ?? {}) }
      delete lanes[laneId]
      return { ...a, [routeId]: lanes }
    })
    engineRef.current?.removeAutomationLane(routeId, laneId)
  }, [])

  const handleUpdateAutomationLane = useCallback((routeId, laneId, cfg) => {
    setAutomationCfg(a => ({
      ...a,
      [routeId]: {
        ...(a[routeId] ?? {}),
        [laneId]: { ...(a[routeId]?.[laneId] ?? {}), ...cfg },
      },
    }))
    engineRef.current?.updateAutomationLane(routeId, laneId, cfg)
  }, [])

  const handleVolume = (routeId, val) => {
    const db = Number(val)
    setVolumes(v => ({ ...v, [routeId]: db }))
    engineRef.current?.setRouteVolume(routeId, db)
  }

  const handleMute = (routeId) => {
    setMuted(m => {
      const next = !m[routeId]
      engineRef.current?.setRouteMute(routeId, next)
      return { ...m, [routeId]: next }
    })
  }

  const handlePan = (routeId, value) => {
    setPans(p => ({ ...p, [routeId]: value }))
    engineRef.current?.setRoutePan(routeId, value)
  }

  // Apply a validated AI Composer plan by replaying the same handlers a human
  // would click. Order matters: harmony before per-track scale, scale before
  // pitch strategy (handleScale rewrites the manual pitch map), FX track added
  // before its wet/params/sends are set.
  const applyAIPlan = useCallback((plan) => {
    if (!plan) return

    if (plan.bpm != null)          setBpm(plan.bpm)
    if (plan.masterVolume != null) handleMasterVolume(plan.masterVolume)
    if (plan.harmony)              handleGlobalHarmony(plan.harmony)

    for (const t of plan.tracks ?? []) {
      const route = routes?.find(r => r.id === t.routeId)
      if (!route) continue

      if (t.synthType)    handleSynthType(t.routeId, route.type, t.synthType)
      if (t.samplerPreset) handleSamplerPreset(t.routeId, route.type, t.samplerPreset)
      if (t.volume != null) handleVolume(t.routeId, t.volume)
      if (t.pan != null)    handlePan(t.routeId, t.pan)
      if (t.octave != null) handleOctaveShift(t.routeId, t.octave)
      if (t.glide != null)  handleGlide(t.routeId, t.glide)
      if (t.legato != null) handleLegato(t.routeId, t.legato)
      if (t.scale)          handleScale(t.routeId, route.name, t.scale)
      if (t.drone) {
        handleDroneMode(t.routeId, !!t.drone.enabled)
        if (t.drone.root) handleDroneRoot(t.routeId, t.drone.root)
      }
    }

    for (const f of plan.fx ?? []) {
      handleAddFxTrack(f.busId)
      if (f.wet != null) handleFxBusWet(f.busId, f.wet)
      for (const [paramId, value] of Object.entries(f.params ?? {})) {
        handleFxBusParam(f.busId, paramId, value)
      }
      for (const s of f.sends ?? []) {
        handleSendLevel(s.routeId, f.busId, s.level)
      }
    }
  }, [
    routes, handleMasterVolume, handleSynthType, handleSamplerPreset,
    handleOctaveShift, handleGlide, handleLegato,
    handleDroneMode, handleDroneRoot, handleAddFxTrack, handleFxBusWet,
    handleFxBusParam, handleSendLevel,
  ])

  const midiExportCtx = useMemo(() => ({
    bpm,
    muted,
    soloRoutes,
    trackScales,
    trackOctaves,
    trackSoundModes,
    trackLegatos,
    trackSpeeds,
    trackLoopRegions,
    trackDroneModes,
    automationSourceIds,
    recorder: midiRecorderRef.current,
  }), [
    bpm, muted, soloRoutes, trackScales, trackOctaves, trackSoundModes,
    trackLegatos, trackSpeeds, trackLoopRegions, trackDroneModes,
    automationSourceIds, hasMidiSession,
  ])

  const canExportMix = useMemo(() => {
    if (!routes?.length) return false
    const ctx = { ...midiExportCtx, recorder: midiRecorderRef.current }
    if (midiRecorderRef.current?.hasData()) {
      return routes.some(r =>
        isRouteExportable(r, r.id, ctx) && midiRecorderRef.current.getRouteEvents(r.id).length,
      )
    }
    return routes.some(r =>
      isRouteExportable(r, r.id, ctx) && isRouteAudible(r.id, ctx) && buildLoopMidiEvents(r, ctx).length,
    )
  }, [routes, midiExportCtx])

  const handleExportRouteMidi = useCallback((routeId) => {
    const route = routes?.find(r => r.id === routeId)
    if (!route) return
    exportRouteMidi(route, { ...midiExportCtx, recorder: midiRecorderRef.current })
  }, [routes, midiExportCtx])

  const handleExportMixMidi = useCallback(() => {
    exportMixMidi(routes ?? [], { ...midiExportCtx, recorder: midiRecorderRef.current })
  }, [routes, midiExportCtx])

  const songState = useMemo(() => ({
    bpm, mode, view, masterVolume,
    volumes, muted, pans, soloRoutes,
    trackSoundModes, trackScales, trackSynthTypes, trackADSRs,
    trackFilters, trackEqs,
    trackOctaves, trackGlides, trackDroneModes, trackDroneRoots, trackSpeeds, trackLoopRegions,
    activeFxTracks, fxBusWet, fxBusMuted, fxBusSoloed, fxBusParams,
    sendMatrix, automationCfg,
  }), [
    bpm, mode, view, masterVolume,
    volumes, muted, pans, soloRoutes,
    trackSoundModes, trackScales, trackSynthTypes, trackADSRs,
    trackFilters, trackEqs,
    trackOctaves, trackGlides, trackDroneModes, trackDroneRoots, trackSpeeds, trackLoopRegions,
    activeFxTracks, fxBusWet, fxBusMuted, fxBusSoloed, fxBusParams,
    sendMatrix, automationCfg,
  ])

  const songSetters = useMemo(() => ({
    setBpm, setMode, setView, setMasterVolume,
    setVolumes, setMuted, setPans, setSoloRoutes,
    setTrackSoundModes, setTrackScales, setTrackSynthTypes, setTrackADSRs,
    setTrackFilters, setTrackEqs,
    setTrackOctaves, setTrackGlides, setTrackDroneModes, setTrackDroneRoots, setTrackSpeeds, setTrackLoopRegions,
    setActiveFxTracks, setFxBusWet, setFxBusMuted, setFxBusSoloed, setFxBusParams,
    setSendMatrix, setAutomationCfg,
  }), [])

  const song = useSongPersistence({
    state:   songState,
    setters: songSetters,
    engineRef,
    routes,
  })

  return (
    <div className={`daw ${view === 'map' ? 'daw--map' : ''}`}>
      <header className="daw-header">
        <h2 className="daw-subtitle">Map</h2>
        <p className="daw-sub">Budapest public transport → generative music</p>

        <SongMenu {...song} />

        <div className="view-toggle">
          <button
            className={`mode-btn ${view === 'map' ? 'active' : ''}`}
            onClick={() => setView('map')}
          >Map</button>
          <button
            className={`mode-btn ${view === 'daw' ? 'active' : ''}`}
            onClick={() => setView('daw')}
          >DAW</button>
        </div>

        <div className="mode-toggle">
          <button
            className={`mode-btn ${mode === 'mock' ? 'active' : ''}`}
            onClick={() => { if (started) { engineRef.current?.stopMock(); setStarted(false) }; setMode('mock') }}
          >Mock</button>
          <button
            className={`mode-btn ${mode === 'live' ? 'active' : ''}`}
            onClick={() => { if (started) { engineRef.current?.stopMock(); setStarted(false) }; setMode('live') }}
          >BKK Live</button>
        </div>

        <div className="harmony-control">
          <label>Harmony</label>
          <select
            className="scale-root-select"
            value={harmonyValue.root}
            onChange={e => handleGlobalHarmony({ ...harmonyValue, root: e.target.value })}
          >
            {NOTE_ROOTS.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <select
            className="scale-type-select"
            value={harmonyValue.scaleType}
            onChange={e => handleGlobalHarmony({ ...harmonyValue, scaleType: e.target.value })}
          >
            {SCALE_TYPES.map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
          {harmonyMixed && (
            <span
              className="harmony-mixed-indicator"
              title="Lanes are not all in the same harmony — pick a value to re-sync them all"
            >● Mixed</span>
          )}
        </div>

        <button
          type="button"
          className={`midi-export-btn midi-export-btn--global${hasMidiSession ? ' has-session' : ''}`}
          onClick={handleExportMixMidi}
          disabled={!canExportMix}
          title="Download multi-track MIDI (session if recorded, else 4-bar loop of audible lines)"
        >↓ MIDI</button>

        <div className="bpm-control">
          <label>BPM</label>
          <input
            type="number" min="40" max="240"
            value={bpm}
            onChange={e => setBpm(Number(e.target.value))}
            disabled={started}
          />
        </div>

        <button
          className={`transport-btn ${started ? 'stop' : 'play'}`}
          onClick={handlePlayPause}
        >
          {started ? '⏹ Stop' : '▶ Play'}
        </button>
      </header>

      <MapView
        className={view !== 'map' ? 'view-hidden' : ''}
        active={view === 'map'}
        routes={routes}
        started={started}
        mode={mode}
        muted={muted}
        soloRoutes={soloRoutes}
        liveSnapshot={liveSnapshot}
      />
      <AIComposerPanel
        className={view !== 'map' && view !== 'daw' ? 'view-hidden' : ''}
        routes={routes}
        started={started}
        onApply={applyAIPlan}
      />
      <DawView
        className={view !== 'daw' ? 'view-hidden' : ''}
        mode={mode}
        started={started}
        events={events}
        routes={routes}
        volumes={volumes}
        muted={muted}
        pans={pans}
        soloRoutes={soloRoutes}
        bpm={bpm}
        liveSnapshot={liveSnapshot}
        snapshotLoading={snapshotLoading}
        trackSoundModes={trackSoundModes}
        trackScales={trackScales}
        trackSynthTypes={trackSynthTypes}
        trackADSRs={trackADSRs}
        trackFilters={trackFilters}
        trackEqs={trackEqs}
        sendMatrix={sendMatrix}
        automationCfg={automationCfg}
        automationSourceIds={automationSourceIds}
        fxBusWet={fxBusWet}
        activeFxTracks={activeFxTracks}
        masterVolume={masterVolume}
        trackOctaves={trackOctaves}
        trackGlides={trackGlides}
        onGlide={handleGlide}
        trackLegatos={trackLegatos}
        onLegato={handleLegato}
        trackSpeeds={trackSpeeds}
        onTrackSpeed={handleTrackSpeed}
        trackLoopRegions={trackLoopRegions}
        onTrackLoopRegion={handleTrackLoopRegion}
        trackDroneModes={trackDroneModes}
        trackDroneRoots={trackDroneRoots}
        onDroneMode={handleDroneMode}
        onDroneRoot={handleDroneRoot}
        onVolume={handleVolume}
        onMute={handleMute}
        onPan={handlePan}
        onSolo={handleSolo}
        onSoundMode={handleSoundMode}
        onScale={handleScale}
        onSynthType={handleSynthType}
        onADSR={handleADSR}
        onSamplerPreset={handleSamplerPreset}
        onSamplerUpload={handleSamplerUpload}
        onFilter={handleFilter}
        onEq={handleEq}
        onSendLevel={handleSendLevel}
        onFxBusWet={handleFxBusWet}
        fxBusMuted={fxBusMuted}
        fxBusSoloed={fxBusSoloed}
        onFxBusMute={handleFxBusMute}
        onFxBusSolo={handleFxBusSolo}
        fxBusParams={fxBusParams}
        onFxBusParam={handleFxBusParam}
        onFxBusCustomIR={handleFxBusCustomIR}
        onAddFxTrack={handleAddFxTrack}
        onRemoveFxTrack={handleRemoveFxTrack}
        onMasterVolume={handleMasterVolume}
        onOctaveShift={handleOctaveShift}
        onAddAutomationLane={handleAddAutomationLane}
        onRemoveAutomationLane={handleRemoveAutomationLane}
        onUpdateAutomationLane={handleUpdateAutomationLane}
        onRefetch={fetchSnapshot}
        onVehicleCrossed={handleVehicleCrossed}
        onExportRouteMidi={handleExportRouteMidi}
      />
    </div>
  )
}
