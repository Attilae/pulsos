import { useCallback, useEffect, useRef, useState } from 'react'
import { TransitEngine, LINE_TYPES } from './engine.js'
import { LINES, latToNote } from './mockData.js'
import { LiveClient } from './liveClient.js'
import MapView from './MapView.jsx'
import DawView from './DawView.jsx'
import './app.css'

const MAX_EVENTS = 80
const MAX_LANE_CHIPS = 12

// Label / color for each type track
const TYPE_META = {
  metro: { label: 'Metro',  color: '#E2001A' },
  tram:  { label: 'Tram',   color: '#FFD700' },
  bus:   { label: 'Bus',    color: '#0066CC' },
  hev:   { label: 'HÉV',   color: '#009640' },
}

// For mock mode: which LINES belong to which type
const LINE_BY_TYPE = {}
for (const line of LINES) {
  if (!LINE_BY_TYPE[line.type]) LINE_BY_TYPE[line.type] = []
  LINE_BY_TYPE[line.type].push(line)
}

export default function App() {
  const engineRef    = useRef(null)
  const clientRef    = useRef(null)
  const chipIdRef    = useRef(0)

  const [view,       setView]       = useState('daw')    // 'map' | 'daw'
  const [mode,       setMode]       = useState('mock')   // 'mock' | 'live'
  const [started,    setStarted]    = useState(false)
  const [wsStatus,   setWsStatus]   = useState('idle')   // 'idle'|'connected'|'disconnected'|'error'
  const [events,     setEvents]     = useState([])        // event log
  const [laneChips,  setLaneChips]  = useState(() =>      // per-type arrival chips for live lane
    Object.fromEntries(LINE_TYPES.map(t => [t, []]))
  )
  const [volumes,    setVolumes]    = useState(() =>
    Object.fromEntries(LINE_TYPES.map(t => [t, 0]))
  )
  const [muted,      setMuted]      = useState(() =>
    Object.fromEntries(LINE_TYPES.map(t => [t, false]))
  )
  // For mock mode: track active stop per named line
  const [mockActive, setMockActive] = useState({})

  // --- engine init (once) ---
  useEffect(() => {
    const engine = new TransitEngine((ev) => {
      setEvents(prev => [ev, ...prev].slice(0, MAX_EVENTS))
    })
    engine.onMockActive = (lineId, stopId, lat, lng) => {
      setMockActive(prev => ({ ...prev, [lineId]: { stopId, lat, lng } }))
    }
    engine.init()
    engineRef.current = engine
    return () => engine.dispose()
  }, [])

  // --- live vehicle_update handler (primary for new engine) ---
  const onVehicleUpdate = useCallback((ev) => {
    engineRef.current?.handleVehicleUpdate(ev)
  }, [])

  // --- backward-compat arrival handler (used for lane chips + event log) ---
  const onArrival = useCallback((ev) => {
    const id = ++chipIdRef.current
    setLaneChips(prev => {
      const chips = [{ ...ev, id }, ...prev[ev.lineType ?? 'bus']].slice(0, MAX_LANE_CHIPS)
      return { ...prev, [ev.lineType ?? 'bus']: chips }
    })
    setEvents(prev => [ev, ...prev].slice(0, MAX_EVENTS))
  }, [])

  // --- alert update handler ---
  const onAlertUpdate = useCallback((alerts) => {
    engineRef.current?.handleAlertUpdate(alerts)
  }, [])

  // --- mode switching ---
  useEffect(() => {
    const engine = engineRef.current
    if (!engine) return

    if (mode === 'live') {
      engine.stopMock()
      const client = new LiveClient({
        onArrival,
        onVehicleUpdate,
        onAlertUpdate,
        onStatus: setWsStatus,
      })
      clientRef.current = client
      if (started) client.connect()
    } else {
      clientRef.current?.disconnect()
      clientRef.current = null
      setWsStatus('idle')
      setLaneChips(Object.fromEntries(LINE_TYPES.map(t => [t, []])))
      if (started) engine.startMock()
    }
  }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps

  // --- play / stop ---
  const handlePlayPause = async () => {
    const engine = engineRef.current
    if (!engine) return

    if (started) {
      engine.stopMock()
      clientRef.current?.disconnect()
      setStarted(false)
      setMockActive({})
    } else {
      await engine.start()
      if (mode === 'mock') {
        engine.startMock()
      } else {
        clientRef.current?.connect()
      }
      setStarted(true)
    }
  }

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

  const wsStatusLabel = {
    idle:         '',
    connected:    '● Live',
    disconnected: '○ Reconnecting…',
    error:        '○ Error',
  }[wsStatus]

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
            onClick={() => setMode('mock')}
          >Mock</button>
          <button
            className={`mode-btn ${mode === 'live' ? 'active' : ''}`}
            onClick={() => setMode('live')}
          >BKK Live</button>
        </div>

        {mode === 'live' && (
          <span className={`ws-status ws-status--${wsStatus}`}>{wsStatusLabel}</span>
        )}

        <button
          className={`transport-btn ${started ? 'stop' : 'play'}`}
          onClick={handlePlayPause}
        >
          {started ? '⏹ Stop' : '▶ Play'}
        </button>
      </header>

      {view === 'map'
        ? <MapView mockActive={started ? mockActive : {}} />
        : <DawView
            mode={mode}
            started={started}
            events={events}
            laneChips={laneChips}
            volumes={volumes}
            muted={muted}
            mockActive={mockActive}
            onVolume={handleVolume}
            onMute={handleMute}
          />
      }
    </div>
  )
}

// ── Mock lane: shows stop blocks for each named line of this type ─────────────
function MockLane({ type, lines, activeStops, running, lineColor }) {
  if (!lines.length) {
    return <div className="track-lane track-lane--empty"><span>No mock lines for {type}</span></div>
  }
  return (
    <div className="track-lane mock-lane">
      {lines.map(line => {
        const noteStops = line.stops.map(s => ({ ...s, note: latToNote(s.lat) }))
        const activeId  = activeStops[line.id]
        return (
          <div key={line.id} className="mock-subrow">
            <span className="mock-subrow-label" style={{ color: line.color }}>{line.name.replace('Metro ', '').replace('Tram ', '').replace('HÉV ', '')}</span>
            {noteStops.map((stop, i) => {
              const isActive = running && activeId === stop.id
              return (
                <div
                  key={stop.id}
                  className={`stop-block ${isActive ? 'active' : ''}`}
                  style={{
                    '--line-color': line.color,
                    '--pos': `${(i / (noteStops.length - 1)) * 100}%`,
                  }}
                  title={`${stop.name} → ${stop.note}`}
                >
                  <span className="stop-note">{stop.note}</span>
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

// ── Live lane: arrival chips scroll in from right, fade out ───────────────────
function LiveLane({ chips, color }) {
  return (
    <div className="track-lane live-lane">
      {chips.length === 0 && (
        <span className="live-lane-idle">Waiting for arrivals…</span>
      )}
      {chips.map((chip, i) => (
        <div
          key={chip.id}
          className="arrival-chip"
          style={{
            '--color': color,
            '--age': i,
            opacity: Math.max(0.15, 1 - i * 0.08),
          }}
        >
          <span className="chip-route">{chip.routeShortName}</span>
          <span className="chip-note">{chip.note}</span>
        </div>
      ))}
    </div>
  )
}
