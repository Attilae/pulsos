import * as Tone from 'tone'
import { useEffect, useRef, useState } from 'react'
import { MapContainer, TileLayer, Polyline, CircleMarker, Tooltip, LayersControl, useMap } from 'react-leaflet'
import L from 'leaflet'
import './MapView.css'

delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({ iconUrl: '', shadowUrl: '' })

function positionAlongRoute(route, progress) {
  const stops = route.stops
  if (!stops.length || route.totalDist <= 0) return null
  const target = progress * route.totalDist
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i], b = stops[i + 1]
    if (a.dist <= target && b.dist >= target) {
      const span = b.dist - a.dist
      const t = span > 0 ? (target - a.dist) / span : 0
      return { lat: a.lat + t * (b.lat - a.lat), lng: a.lon + t * (b.lon - a.lon) }
    }
  }
  const last = stops.at(-1)
  return { lat: last.lat, lng: last.lon }
}

function isRouteActive(route, muted, soloRoutes) {
  if (muted[route.type]) return false
  if (soloRoutes.size > 0 && !soloRoutes.has(route.id)) return false
  return true
}

function routeStyle(route, muted, soloRoutes) {
  const active = isRouteActive(route, muted, soloRoutes)
  const isMuted = !active
  return {
    opacity:   active ? (route.type === 'metro' ? 0.88 : 0.75) : 0.22,
    weight:    active ? (route.type === 'metro' ? 2.5  : 1.5)  : (route.type === 'metro' ? 1.5 : 1),
    dashArray: isMuted ? '4 7' : null,
  }
}

// Calls map.invalidateSize() when the map becomes visible after being hidden
function MapResizer({ active }) {
  const map = useMap()
  useEffect(() => {
    if (active) {
      const id = setTimeout(() => map.invalidateSize(), 60)
      return () => clearTimeout(id)
    }
  }, [active, map])
  return null
}

// Creates a dedicated Leaflet pane for playhead markers and wires up a ref to it
function PlayheadPaneSetup({ paneRef }) {
  const map = useMap()
  useEffect(() => {
    if (!map.getPane('playhead')) {
      const pane = map.createPane('playhead')
      pane.style.zIndex = '450'
    }
    paneRef.current = map.getPane('playhead') ?? null
  }, [map, paneRef])
  return null
}

export default function MapView({
  className = '',
  active = true,
  routes = null,
  started = false,
  mode = 'mock',
  muted = {},
  soloRoutes = new Set(),
  liveSnapshot = null,
}) {
  const [playheadPositions, setPlayheadPositions] = useState({})
  const rafRef       = useRef(null)
  const mutedRef     = useRef(muted)
  const soloRef      = useRef(soloRoutes)
  const playheadPane = useRef(null)   // DOM div for the playhead Leaflet pane

  useEffect(() => { mutedRef.current = muted },      [muted])
  useEffect(() => { soloRef.current  = soloRoutes }, [soloRoutes])

  const LAYERS = [
    { type: 'metro',   label: 'Metro' },
    { type: 'tram',    label: 'Tram' },
    { type: 'trolley', label: 'Trolley' },
    { type: 'bus',     label: 'Bus' },
  ]
  const routesByType = Object.fromEntries(
    LAYERS.map(l => [l.type, routes?.filter(r => r.type === l.type) ?? []])
  )
  const allRoutes = LAYERS.flatMap(l => routesByType[l.type])

  // rAF loop — only runs in mock mode while playing
  useEffect(() => {
    if (!started || mode !== 'mock' || !routes) {
      setPlayheadPositions({})
      return
    }

    let lastUpdate = 0
    const FADE_ZONE = 0.06

    function tick(ts) {
      rafRef.current = requestAnimationFrame(tick)
      if (ts - lastUpdate < 33) return  // ~30fps
      lastUpdate = ts

      const progress = Tone.getTransport().progress

      // Fade in at start (0→FADE_ZONE), full in middle, fade out at end (1-FADE_ZONE→1).
      // Applied directly to the pane DOM element — no React state, no re-render.
      const fadeOp = progress < FADE_ZONE
        ? progress / FADE_ZONE
        : progress > 1 - FADE_ZONE
          ? (1 - progress) / FADE_ZONE
          : 1
      if (playheadPane.current) {
        playheadPane.current.style.opacity = String(fadeOp)
      }

      const next = {}
      for (const route of routes) {
        if (!isRouteActive(route, mutedRef.current, soloRef.current)) continue
        const pos = positionAlongRoute(route, progress)
        if (pos) next[route.id] = pos
      }
      setPlayheadPositions(next)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(rafRef.current)
      setPlayheadPositions({})
      if (playheadPane.current) playheadPane.current.style.opacity = '1'
    }
  }, [started, mode, routes])

  // Live vehicles indexed by routeShortName
  const vehiclesByRouteName = {}
  if (mode === 'live' && liveSnapshot?.vehicles) {
    for (const v of liveSnapshot.vehicles) {
      if (!vehiclesByRouteName[v.routeShortName]) vehiclesByRouteName[v.routeShortName] = []
      vehiclesByRouteName[v.routeShortName].push(v)
    }
  }

  return (
    <div className={`map-wrapper${className ? ` ${className}` : ''}`}>
      {!routes && <div className="map-loading">Loading line data…</div>}

      {/* ── Track status overlay ── */}
      {routes && (
        <div className="map-track-status">
          {allRoutes.map(route => {
            const active    = isRouteActive(route, muted, soloRoutes)
            const isMuted   = muted[route.type]
            const isSoloed  = soloRoutes.has(route.id)
            return (
              <div key={route.id} className={`map-status-row${active ? '' : ' map-status-row--dim'}`}>
                <span className="map-status-dot" style={{ background: route.color }} />
                <span className="map-status-name">{route.name}</span>
                {isMuted  && <span className="map-status-badge map-status-badge--mute">M</span>}
                {isSoloed && <span className="map-status-badge map-status-badge--solo">S</span>}
              </div>
            )
          })}
        </div>
      )}

      <MapContainer
        center={[47.4979, 19.0402]}
        zoom={12}
        className="map-container"
        zoomControl={true}
      >
        <MapResizer active={active} />
        <PlayheadPaneSetup paneRef={playheadPane} />

        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://carto.com/">CARTO</a>'
          maxZoom={19}
        />

        <LayersControl position="topright">
          {LAYERS.map(({ type, label }) => {
            const layerRoutes = routesByType[type]
            if (!layerRoutes.length) return null
            const showStops = type === 'metro'
            return (
              <LayersControl.Overlay key={type} checked name={label}>
                <>
                  {layerRoutes.map(route => {
                    const { opacity, weight, dashArray } = routeStyle(route, muted, soloRoutes)
                    return route.polylines.map(pl => (
                      <Polyline
                        key={`${route.id}_${pl.direction}`}
                        positions={pl.coords}
                        color={route.color}
                        weight={weight}
                        opacity={opacity}
                        dashArray={dashArray}
                      >
                        <Tooltip sticky>{route.name} — {route.desc}</Tooltip>
                      </Polyline>
                    ))
                  })}
                  {showStops && layerRoutes.map(route =>
                    route.stops.map((stop, i) => (
                      <CircleMarker
                        key={`${route.id}_${stop.id}_${i}`}
                        center={[stop.lat, stop.lon]}
                        radius={4}
                        color={route.color}
                        fillColor={route.color}
                        fillOpacity={isRouteActive(route, muted, soloRoutes) ? 0.9 : 0.1}
                        weight={1.5}
                      >
                        <Tooltip>{stop.name}</Tooltip>
                      </CircleMarker>
                    ))
                  )}
                </>
              </LayersControl.Overlay>
            )
          })}
        </LayersControl>

        {/* ── Mock mode: playhead dot per route (rendered in dedicated pane for fade control) ── */}
        {mode === 'mock' && Object.entries(playheadPositions).map(([routeId, { lat, lng }]) => {
          const route = allRoutes.find(r => r.id === routeId)
          if (!route) return null
          return <PlayheadMarker key={routeId} lat={lat} lng={lng} color={route.color} pane="playhead" />
        })}

        {/* ── Live mode: vehicle dots ── */}
        {mode === 'live' && allRoutes.map(route => {
          if (!isRouteActive(route, muted, soloRoutes)) return null
          return (vehiclesByRouteName[route.name] ?? [])
            .filter(v => v.lat != null && v.lng != null)
            .map(v => (
              <PlayheadMarker key={v.vehicleId} lat={v.lat} lng={v.lng} color={route.color} />
            ))
        })}
      </MapContainer>
    </div>
  )
}

function PlayheadMarker({ lat, lng, color, pane }) {
  const opts = pane ? { pane } : {}
  return (
    <>
      <CircleMarker
        center={[lat, lng]}
        radius={13}
        color={color}
        fillColor={color}
        fillOpacity={0.12}
        weight={2}
        className="map-playhead-pulse"
        {...opts}
      />
      <CircleMarker
        center={[lat, lng]}
        radius={7}
        color={color}
        fillColor="#ffffff"
        fillOpacity={0.95}
        weight={2.5}
        className="map-playhead-dot"
        {...opts}
      />
    </>
  )
}
