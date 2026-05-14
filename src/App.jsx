import { useCallback, useEffect, useRef, useState } from 'react'
import { TransitEngine, LINE_TYPES, SYNTH_DEFAULTS, EFFECT_DEFAULTS } from './engine.js'
import { randomFromScale } from './mappings.js'
import DawView from './DawView.jsx'
import MapView from './MapView.jsx'
import './app.css'

const MAX_EVENTS = 80

export default function App() {
  const engineRef = useRef(null)
  const chipIdRef = useRef(0)

  const [view,    setView]    = useState('daw')   // 'map' | 'daw'
  const [mode,    setMode]    = useState('mock')  // 'mock' | 'live'
  const [started, setStarted] = useState(false)
  const [events,  setEvents]  = useState([])

  const [volumes, setVolumes] = useState(() =>
    Object.fromEntries(LINE_TYPES.map(t => [t, 0]))
  )
  const [muted, setMuted] = useState(() =>
    Object.fromEntries(LINE_TYPES.map(t => [t, false]))
  )

  // Per-route sound mode selectors (keyed by route.id from lines.json)
  const [trackSoundModes, setTrackSoundModes] = useState({})   // routeId → 'percussive'|'harmonic'
  const [trackScales,     setTrackScales]     = useState({})   // routeId → { root: 'C', scaleType: 'major' }
  const [trackSynthTypes, setTrackSynthTypes] = useState({})   // routeId → synth type string
  const [trackADSRs,      setTrackADSRs]      = useState({})   // routeId → envelope/param object
  const [trackEffects,    setTrackEffects]    = useState({})   // routeId → { type, params }

  // Routes lifted from lines.json
  const [routes, setRoutes] = useState(null)

  // Solo state
  const [soloRoutes, setSoloRoutes] = useState(() => new Set())

  // BPM
  const [bpm, setBpm] = useState(120)

  // Live snapshot
  const [liveSnapshot,    setLiveSnapshot]    = useState(null)
  const [snapshotLoading, setSnapshotLoading] = useState(false)

  // ── Load routes once ────────────────────────────────────────────────────────
  useEffect(() => {
    fetch('/data/lines.json')
      .then(r => r.json())
      .then(d => setRoutes(d.routes))
  }, [])

  // ── Engine init (once) ──────────────────────────────────────────────────────
  useEffect(() => {
    const engine = new TransitEngine((ev) => {
      setEvents(prev => [ev, ...prev].slice(0, MAX_EVENTS))
    })
    engine.init()
    engineRef.current = engine
    return () => engine.dispose()
  }, [])

  // ── Fetch live snapshot ─────────────────────────────────────────────────────
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

  // Auto-fetch when switching to live mode
  useEffect(() => {
    if (mode === 'live') fetchSnapshot()
  }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Play / Stop ─────────────────────────────────────────────────────────────
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

      if (mode === 'mock') {
        engine.startMock(routes ?? [], smMap, bpm, trackSynthTypes, trackADSRs, trackEffects)
      } else {
        engine.startLive(routes ?? [], smMap, bpm, trackSynthTypes, trackADSRs, trackEffects)
      }
      setStarted(true)
    }
  }

  // ── Solo ─────────────────────────────────────────────────────────────────────
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

  // ── Live crossing callback ───────────────────────────────────────────────────
  const handleVehicleCrossed = useCallback((routeId, routeType) => {
    const { root = 'C', scaleType = 'major' } = trackScales[routeId] ?? {}
    const note = randomFromScale(root, scaleType)
    engineRef.current?.triggerLiveNote(routeId, routeType, note)
  }, [trackScales])

  // ── Effect slot ──────────────────────────────────────────────────────────────
  const handleEffect = useCallback((routeId, routeType, effectType) => {
    const params = { ...EFFECT_DEFAULTS[effectType] }
    setTrackEffects(e => ({ ...e, [routeId]: { type: effectType, params } }))
    engineRef.current?.setEffect(routeId, routeType, effectType, params)
  }, [])

  const handleEffectParams = useCallback((routeId, params) => {
    setTrackEffects(e => {
      const next = { ...e, [routeId]: { ...e[routeId], params: { ...e[routeId]?.params, ...params } } }
      engineRef.current?.setEffectParams(routeId, next[routeId].params)
      return next
    })
  }, [])

  // ── Synth type ───────────────────────────────────────────────────────────────
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

  // ── Sound mode / scale ──────────────────────────────────────────────────────
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
  }

  // ── Volume / mute ────────────────────────────────────────────────────────────
  const handleVolume = (type, val) => {
    const db = Number(val)
    setVolumes(v => ({ ...v, [type]: db }))
    engineRef.current?.setVolume(type, db)
  }

  const handleMute = (type) => {
    setMuted(m => {
      const next = !m[type]
      engineRef.current?.setMute(type, next)
      return { ...m, [type]: next }
    })
  }

  return (
    <div className={`daw ${view === 'map' ? 'daw--map' : ''}`}>
      <header className="daw-header">
        <h1>Transit DAW</h1>
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

      {view === 'map'
        ? <MapView mockActive={{}} />
        : <DawView
            mode={mode}
            started={started}
            events={events}
            routes={routes}
            volumes={volumes}
            muted={muted}
            soloRoutes={soloRoutes}
            bpm={bpm}
            liveSnapshot={liveSnapshot}
            snapshotLoading={snapshotLoading}
            trackSoundModes={trackSoundModes}
            trackScales={trackScales}
            trackSynthTypes={trackSynthTypes}
            trackADSRs={trackADSRs}
            trackEffects={trackEffects}
            onVolume={handleVolume}
            onMute={handleMute}
            onSolo={handleSolo}
            onSoundMode={handleSoundMode}
            onScale={handleScale}
            onSynthType={handleSynthType}
            onADSR={handleADSR}
            onEffect={handleEffect}
            onEffectParams={handleEffectParams}
            onRefetch={fetchSnapshot}
            onVehicleCrossed={handleVehicleCrossed}
          />
      }
    </div>
  )
}
