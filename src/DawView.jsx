import { useEffect, useState } from 'react'
import './DawView.css'

// Maps mock line IDs (from engine.js mockData) to GTFS route short names
const MOCK_TO_ROUTE_NAMES = {
  'M2':     ['M2'],
  'M3':     ['M3'],
  'T4_6':   ['4', '6'],
  'HEV_H5': [],
}

// Reverse lookup: GTFS route name → mock line ID
const ROUTE_NAME_TO_MOCK = {}
for (const [mockId, names] of Object.entries(MOCK_TO_ROUTE_NAMES)) {
  for (const name of names) ROUTE_NAME_TO_MOCK[name] = mockId
}

// Find the GTFS stop nearest to a given lat/lng, return its rail position (0–100)
function resolvePlayhead(route, lat, lng) {
  if (!route.stops.length || route.totalDist <= 0 || lat == null) return null
  let nearest = route.stops[0]
  let minD = Infinity
  for (const s of route.stops) {
    const d = (s.lat - lat) ** 2 + (s.lon - lng) ** 2
    if (d < minD) { minD = d; nearest = s }
  }
  return { pct: (nearest.dist / route.totalDist) * 100, stopId: nearest.id }
}

export default function DawView({
  mode, started, events, laneChips, volumes, muted, mockActive, onVolume, onMute,
}) {
  const [lines, setLines] = useState(null)

  useEffect(() => {
    fetch('/data/lines.json')
      .then(r => r.json())
      .then(d => setLines(d.routes))
  }, [])

  const metro = lines?.filter(r => r.type === 'metro') ?? []
  const trams = lines?.filter(r => r.type === 'tram')  ?? []

  const lineType = (route) => route.type

  return (
    <div className="daw-body">
      <main className="daw-tracks">
        {!lines && <div className="daw-loading">Loading line data…</div>}

        {/* ── Metro section ── */}
        {metro.length > 0 && (
          <>
            <div className="daw-section-label">Metro</div>
            {metro.map(route => (
              <LineTrack
                key={route.id}
                route={route}
                mode={mode}
                started={started}
                laneChips={laneChips[lineType(route)] ?? []}
                volume={volumes[lineType(route)] ?? 0}
                muted={muted[lineType(route)] ?? false}
                mockActive={mockActive}
                onVolume={v => onVolume(lineType(route), v)}
                onMute={() => onMute(lineType(route))}
              />
            ))}
          </>
        )}

        {/* ── Tram section ── */}
        {trams.length > 0 && (
          <>
            <div className="daw-section-label">Tram</div>
            {trams.map(route => (
              <LineTrack
                key={route.id}
                route={route}
                mode={mode}
                started={started}
                laneChips={laneChips[lineType(route)] ?? []}
                volume={volumes[lineType(route)] ?? 0}
                muted={muted[lineType(route)] ?? false}
                mockActive={mockActive}
                onVolume={v => onVolume(lineType(route), v)}
                onMute={() => onMute(lineType(route))}
              />
            ))}
          </>
        )}
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
    </div>
  )
}

// ── Individual line track row ─────────────────────────────────────────────────
function LineTrack({ route, mode, started, laneChips, volume, muted, mockActive, onVolume, onMute }) {
  return (
    <div className={`line-track ${muted ? 'line-track--muted' : ''}`}>
      <div className="line-label" style={{ borderColor: route.color }}>
        <span className="line-badge" style={{ background: route.color, color: route.textColor }}>
          {route.name}
        </span>
        <span className="line-desc">{route.desc}</span>
      </div>

      <div className="line-controls">
        <button
          className={`mute-btn ${muted ? 'active' : ''}`}
          onClick={onMute}
          title={muted ? 'Unmute' : 'Mute'}
        >M</button>
        <input
          type="range" min="-40" max="6" step="1"
          value={volume}
          onChange={e => onVolume(Number(e.target.value))}
          className="volume-slider"
        />
        <span className="volume-val">{volume}dB</span>
      </div>

      {mode === 'mock'
        ? <StopRail route={route} mockActive={mockActive} started={started} />
        : <LiveChips chips={laneChips} color={route.color} />
      }
    </div>
  )
}

// ── Stop rail: stops positioned by shape_dist_traveled ───────────────────────
function StopRail({ route, mockActive, started }) {
  if (!route.stops.length) return <div className="stop-rail stop-rail--empty" />

  const total = route.totalDist || route.stops[route.stops.length - 1].dist || 1

  // Resolve playhead: find active mock position for this GTFS route
  const mockId  = ROUTE_NAME_TO_MOCK[route.name]
  const active  = started && mockId ? mockActive?.[mockId] : null
  const ph      = active?.lat != null ? resolvePlayhead(route, active.lat, active.lng) : null

  return (
    <div className="stop-rail">
      <div className="stop-rail-line" style={{ '--line-color': route.color }} />

      {/* Playhead — vertical line that jumps between active stops */}
      {ph != null && (
        <div
          className="playhead"
          style={{ '--pos': `${ph.pct}%`, '--line-color': route.color }}
        />
      )}

      {route.stops.map(stop => {
        const pct      = total > 0 ? (stop.dist / total) * 100 : 0
        const isActive = ph?.stopId === stop.id
        return (
          <div
            key={stop.id}
            className={`stop-dot ${isActive ? 'active' : ''}`}
            style={{ '--pos': `${pct}%`, '--line-color': route.color }}
            title={stop.name}
          >
            <span className="stop-label">{stop.name}</span>
          </div>
        )
      })}
    </div>
  )
}

// ── Live chips: arrival events scroll in from right ───────────────────────────
function LiveChips({ chips, color }) {
  return (
    <div className="live-lane">
      {chips.length === 0 && (
        <span className="live-lane-idle">Waiting for arrivals…</span>
      )}
      {chips.map((chip, i) => (
        <div
          key={chip.id}
          className="arrival-chip"
          style={{ '--color': color, opacity: Math.max(0.15, 1 - i * 0.08) }}
        >
          <span className="chip-route">{chip.routeShortName}</span>
          <span className="chip-note">{chip.note}</span>
        </div>
      ))}
    </div>
  )
}
