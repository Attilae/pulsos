import { useEffect, useState } from 'react'
import { MapContainer, TileLayer, Polyline, CircleMarker, Tooltip, LayersControl } from 'react-leaflet'
import L from 'leaflet'
import './MapView.css'

// Fix Leaflet's broken default icon URLs when bundled with Vite
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({ iconUrl: '', shadowUrl: '' })

// Colors for each mock line (used for the active-stop pulse markers)
const MOCK_LINE_COLORS = {
  'M2':     '#E41F18',
  'M3':     '#005CA5',
  'T4_6':   '#FFD700',
  'HEV_H5': '#009640',
}

export default function MapView({ mockActive = {} }) {
  const [lines, setLines] = useState(null)

  useEffect(() => {
    fetch('/data/lines.json')
      .then(r => r.json())
      .then(d => setLines(d.routes))
  }, [])

  const metro = lines?.filter(r => r.type === 'metro') ?? []
  const trams = lines?.filter(r => r.type === 'tram')  ?? []

  // Active mock stops that have a valid lat/lng
  const activeStops = Object.entries(mockActive)
    .filter(([, v]) => v?.lat != null)
    .map(([mockId, { lat, lng }]) => ({ mockId, lat, lng, color: MOCK_LINE_COLORS[mockId] ?? '#fff' }))

  return (
    <div className="map-wrapper">
      {!lines && <div className="map-loading">Loading line data…</div>}
      <MapContainer
        center={[47.4979, 19.0402]}
        zoom={12}
        className="map-container"
        zoomControl={true}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://carto.com/">CARTO</a>'
          maxZoom={19}
        />

        <LayersControl position="topright">
          {/* ── Metro layer ── */}
          <LayersControl.Overlay checked name="Metro">
            <>
              {metro.map(route =>
                route.polylines.map(pl => (
                  <Polyline
                    key={`${route.id}_${pl.direction}`}
                    positions={pl.coords}
                    color={route.color}
                    weight={5}
                    opacity={0.92}
                  >
                    <Tooltip sticky>{route.name} — {route.desc}</Tooltip>
                  </Polyline>
                ))
              )}
              {metro.map(route =>
                route.stops.map(stop => (
                  <CircleMarker
                    key={stop.id}
                    center={[stop.lat, stop.lon]}
                    radius={4}
                    color={route.color}
                    fillColor={route.color}
                    fillOpacity={0.9}
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
              {trams.map(route =>
                route.polylines.map(pl => (
                  <Polyline
                    key={`${route.id}_${pl.direction}`}
                    positions={pl.coords}
                    color={route.color}
                    weight={3}
                    opacity={0.8}
                  >
                    <Tooltip sticky>{route.name} — {route.desc}</Tooltip>
                  </Polyline>
                ))
              )}
            </>
          </LayersControl.Overlay>
        </LayersControl>

        {/* ── Active stop indicators (when playback is running) ── */}
        {activeStops.map(({ mockId, lat, lng, color }) => (
          <ActiveStopMarker key={mockId} lat={lat} lng={lng} color={color} />
        ))}
      </MapContainer>
    </div>
  )
}

// ── Pulsing active stop: outer ring + inner dot ───────────────────────────────
function ActiveStopMarker({ lat, lng, color }) {
  return (
    <>
      {/* Outer pulse ring — animates out and fades */}
      <CircleMarker
        center={[lat, lng]}
        radius={14}
        color={color}
        fillColor={color}
        fillOpacity={0.15}
        weight={2}
        className="active-stop-pulse"
      />
      {/* Inner solid dot */}
      <CircleMarker
        center={[lat, lng]}
        radius={6}
        color={color}
        fillColor={color}
        fillOpacity={1}
        weight={2}
        className="active-stop-dot"
      />
    </>
  )
}
