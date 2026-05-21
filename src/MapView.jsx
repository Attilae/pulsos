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

function routeOpacity(route, muted, soloRoutes) {
  return isRouteActive(route, muted, soloRoutes)
    ? (route.type === 'metro' ? 0.92 : 0.8)
    : 0.08
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
  const rafRef   = useRef(null)
  const mutedRef = useRef(muted)
  const soloRef  = useRef(soloRoutes)

  useEffect(() => { mutedRef.current = muted },      [muted])
  useEffect(() => { soloRef.current  = soloRoutes }, [soloRoutes])

  const metro     = routes?.filter(r => r.type === 'metro') ?? []
  const trams     = routes?.filter(r => r.type === 'tram')  ?? []
  const allRoutes = [...metro, ...trams]

  // rAF loop — only runs in mock mode while playing
  useEffect(() => {
    if (!started || mode !== 'mock' || !routes) {
      setPlayheadPositions({})
      return
    }

    let lastUpdate = 0

    function tick(ts) {
      rafRef.current = requestAnimationFrame(tick)
      if (ts - lastUpdate < 33) return  // ~30fps
      lastUpdate = ts

      const progress = Tone.getTransport().progress
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

        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://carto.com/">CARTO</a>'
          maxZoom={19}
        />

        <LayersControl position="topright">
          {/* ── Metro layer ── */}
          <LayersControl.Overlay checked name="Metro">
            <>
              {metro.map(route => {
                const op = routeOpacity(route, muted, soloRoutes)
                const wt = isRouteActive(route, muted, soloRoutes) ? 5 : 3
                return route.polylines.map(pl => (
                  <Polyline
                    key={`${route.id}_${pl.direction}`}
                    positions={pl.coords}
                    color={route.color}
                    weight={wt}
                    opacity={op}
                  >
                    <Tooltip sticky>{route.name} — {route.desc}</Tooltip>
                  </Polyline>
                ))
              })}
              {metro.map(route =>
                route.stops.map(stop => (
                  <CircleMarker
                    key={stop.id}
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

          {/* ── Tram layer ── */}
          <LayersControl.Overlay checked name="Tram">
            <>
              {trams.map(route => {
                const op = routeOpacity(route, muted, soloRoutes)
                const wt = isRouteActive(route, muted, soloRoutes) ? 3 : 2
                return route.polylines.map(pl => (
                  <Polyline
                    key={`${route.id}_${pl.direction}`}
                    positions={pl.coords}
                    color={route.color}
                    weight={wt}
                    opacity={op}
                  >
                    <Tooltip sticky>{route.name} — {route.desc}</Tooltip>
                  </Polyline>
                ))
              })}
            </>
          </LayersControl.Overlay>
        </LayersControl>

        {/* ── Mock mode: playhead dot per route ── */}
        {mode === 'mock' && Object.entries(playheadPositions).map(([routeId, { lat, lng }]) => {
          const route = allRoutes.find(r => r.id === routeId)
          if (!route) return null
          return <PlayheadMarker key={routeId} lat={lat} lng={lng} color={route.color} />
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

function PlayheadMarker({ lat, lng, color }) {
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
      />
      <CircleMarker
        center={[lat, lng]}
        radius={7}
        color={color}
        fillColor="#ffffff"
        fillOpacity={0.95}
        weight={2.5}
        className="map-playhead-dot"
      />
    </>
  )
}
