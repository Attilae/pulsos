import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as Tone from 'tone'
import { TransitEngine, SYNTH_DEFAULTS } from '../engine.js'
import { FX_BUSES } from '../fxTrack.js'
import { randomFromScale, latToNote, shiftOctaveNote, SCALES } from '../mappings.js'
import DawView from '../DawView.jsx'
import MapView from '../MapView.jsx'

const MAX_EVENTS = 80

const DEFAULT_ROUTE_IDS = new Set([
  '5100', '5200', '5300', '5400',           // M1 M2 M3 M4
  '3010', '3020', '3040', '3060', '3170', '3190', // Tram 1, 2, 4, 6, 17, 19
])

export default function MixerTab() {
  const engineRef = useRef(null)

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
  const [trackPitchMaps,  setTrackPitchMaps]  = useState({})

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

  const [activeFxTracks, setActiveFxTracks] = useState([])

  const [masterVolume, setMasterVolume] = useState(0)

  const [trackOctaves,    setTrackOctaves]    = useState({})
  const [trackGlides,     setTrackGlides]     = useState({})
  const [trackDroneModes, setTrackDroneModes] = useState({})
  const [trackDroneRoots, setTrackDroneRoots] = useState({})

  const [liveSnapshot,    setLiveSnapshot]    = useState(null)
  const [snapshotLoading, setSnapshotLoading] = useState(false)

  useEffect(() => {
    fetch('/data/lines.json')
      .then(r => r.json())
      .then(d => {
        const routes = d.routes.filter(r => DEFAULT_ROUTE_IDS.has(r.id))
        setRoutes(routes)
        setTrackPitchMaps(
          Object.fromEntries(
            routes.map(r => [r.id, r.stops.map(() => randomFromScale('C', 'major'))])
          )
        )
      })
  }, [])

  useEffect(() => {
    const engine = new TransitEngine((ev) => {
      setEvents(prev => [ev, ...prev].slice(0, MAX_EVENTS))
    })
    engine.init()
    engineRef.current = engine
    return () => engine.dispose()
  }, [])

  const fetchSnapshot = useCallback(async () => {
    setSnapshotLoading(true)
    try {
      const res  = await fetch('http://localhost:3005/api/snapshot')
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
      engine.stopMock()
      setStarted(false)
    } else {
      await engine.start()

      const smMap = {}
      for (const [rid, m] of Object.entries(trackSoundModes)) {
        smMap[rid] = { mode: m, scale: trackScales[rid] ?? { root: 'C', scaleType: 'major' } }
      }

      for (const [rid, notes] of Object.entries(trackPitchMaps)) {
        engine.setPitchMap(rid, notes)
      }

      if (mode === 'mock') {
        engine.startMock(routes ?? [], smMap, bpm, trackSynthTypes, trackADSRs)
      } else {
        engine.startLive(routes ?? [], smMap, bpm, trackSynthTypes, trackADSRs)
      }
      setStarted(true)
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
    const pitchMap = trackPitchMaps[routeId]
    const route = routes?.find(r => r.id === routeId)
    const stopIdx = stopId != null && route ? route.stops.findIndex(s => s.id === stopId) : -1

    let rawNote
    if (pitchMap && stopIdx >= 0 && pitchMap[stopIdx]) {
      rawNote = pitchMap[stopIdx]
    } else if (lat != null) {
      const scaleIntervals = SCALES[scaleType] ?? SCALES.major
      const rootMidi = 62 + octave * 12
      rawNote = latToNote(lat, rootMidi, scaleIntervals)
    } else {
      rawNote = randomFromScale(root, scaleType)
    }
    const note = pitchMap && stopIdx >= 0
      ? shiftOctaveNote(rawNote, octave)
      : rawNote

    engineRef.current?.triggerLiveNote(routeId, routeType, note)
  }, [trackScales, trackOctaves, trackPitchMaps, routes])

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
    engineRef.current?.setScale(routeId, scale)
    setTrackSoundModes(s => {
      engineRef.current?.setSoundMode(routeShortName, s[routeId] ?? 'harmonic', scale)
      return s
    })
    setRoutes(rs => {
      const route = rs?.find(r => r.id === routeId)
      if (route) {
        const notes = route.stops.map(() => randomFromScale(scale.root, scale.scaleType))
        setTrackPitchMaps(m => ({ ...m, [routeId]: notes }))
        engineRef.current?.setPitchMap(routeId, notes)
      }
      return rs
    })
  }

  const handleRandomizePitches = useCallback((routeId) => {
    setRoutes(rs => {
      const route = rs?.find(r => r.id === routeId)
      if (route) {
        setTrackScales(sc => {
          const { root = 'C', scaleType = 'major' } = sc[routeId] ?? {}
          const notes = route.stops.map(() => randomFromScale(root, scaleType))
          setTrackPitchMaps(m => ({ ...m, [routeId]: notes }))
          engineRef.current?.setPitchMap(routeId, notes)
          return sc
        })
      }
      return rs
    })
  }, [])

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

  return (
    <div className={`daw ${view === 'map' ? 'daw--map' : ''}`}>
      <header className="daw-header">
        <h2 className="daw-subtitle">Map</h2>
        <p className="daw-sub">Budapest public transport → generative music</p>

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
        trackPitchMaps={trackPitchMaps}
        onRandomizePitches={handleRandomizePitches}
      />
    </div>
  )
}
