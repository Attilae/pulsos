import * as Tone from 'tone'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, Polyline, CircleMarker, Tooltip, LayersControl, useMap } from 'react-leaflet'
import L from 'leaflet'
import { maplibreGL } from '@maplibre/maplibre-gl-leaflet'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useIsPhone } from '@/lib/shared/useViewport.js'
import { normalizeLaneTag } from '@/lib/laneTags.js'
import { findTargetSpec } from '@/lib/engine.js'
import { hashStopValue } from '@/lib/mappings.js'
import { lanePlayhead, trailFracs, wrapFade } from '@/lib/mapPlayhead.js'
import { subscribeEvents, getEvents } from '@/lib/shared/eventLogStore.js'
import './MapView.css'

delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({ iconUrl: '', shadowUrl: '' })

// OpenFreeMap: free vector tiles, no key, commercial use allowed. Drawn by
// MapLibre GL inside Leaflet's tile pane; attribution (OpenFreeMap,
// OpenMapTiles, © OpenStreetMap contributors) comes from the style itself.
const BASEMAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/dark'

function BaseMap() {
  const map = useMap()
  useEffect(() => {
    const layer = maplibreGL({ style: BASEMAP_STYLE_URL }).addTo(map)
    // The Map⇄DAW toggle resizes the container without a window resize, so
    // watch it directly. invalidateSize() updates Leaflet, but the binding's
    // resize handler never calls MapLibre's resize(), leaving the GL map on its
    // old viewport — the basemap stays clipped until the next pan. Do both.
    let raf = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        map.invalidateSize()
        layer.getMaplibreMap()?.resize()
      })
    })
    observer.observe(map.getContainer())
    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      layer.remove()
    }
  }, [map])
  return null
}

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

function isRouteActive(route, disabled, soloRoutes) {
  if (disabled[route.id]) return false
  if (soloRoutes.size > 0 && !soloRoutes.has(route.id)) return false
  return true
}

function routeStyle(route, disabled, soloRoutes) {
  const active = isRouteActive(route, disabled, soloRoutes)
  const isInactive = !active
  return {
    opacity:   active ? (route.type === 'metro' ? 0.88 : 0.75) : 0.22,
    weight:    active ? (route.type === 'metro' ? 2.5  : 1.5)  : (route.type === 'metro' ? 1.5 : 1),
    dashArray: isInactive ? '4 7' : null,
  }
}

// Automation identity colour (--automation). Canvas-rendered maps (phones) can't
// read CSS custom properties, so the stroke carries the dark-theme hex and
// .map-auto-line re-points it at the token where SVG is in use.
const AUTOMATION_COLOR = '#e2a53b'

// Route colours come from the data file and end up inside a divIcon's HTML.
const SAFE_COLOR = /^#[0-9a-f]{3,8}$/i
const safeColor = c => (SAFE_COLOR.test(c ?? '') ? c : '#ffffff')

function automationTargetLabel(paramTarget, synthType) {
  const spec = findTargetSpec(paramTarget, synthType)
  return spec?.label?.replace(/^→\s*/, '') ?? paramTarget
}

// Every automation lane that has a source line, as the map draws it: one entry
// per lane, grouped by source so a line read by several lanes is drawn once.
function buildAutomationLinks(automationCfg, routes, trackSynthTypes) {
  const byId = new Map((routes ?? []).map(r => [r.id, r]))
  const links = []
  for (const [destId, lanes] of Object.entries(automationCfg ?? {})) {
    for (const [laneId, cfg] of Object.entries(lanes ?? {})) {
      const src = cfg?.sourceRouteId ? byId.get(cfg.sourceRouteId) : null
      if (!src?.polylines?.length) continue
      links.push({
        key: `${destId}:${laneId}`,
        laneId,
        cfg,
        src,
        destId,
        destName: byId.get(destId)?.name ?? byId.get(destId.split('~dup~')[0])?.name ?? destId,
        target: automationTargetLabel(cfg.paramTarget ?? 'volume', trackSynthTypes?.[destId]),
      })
    }
  }
  const bySource = new Map()
  for (const l of links) {
    if (!bySource.has(l.src.id)) bySource.set(l.src.id, [])
    bySource.get(l.src.id).push(l)
  }
  return { links, bySource }
}

// Calls map.invalidateSize() when the map becomes visible after being hidden,
// and whenever the viewport itself changes shape.
//
// The `active` timeout alone was enough on desktop, where the window rarely
// resizes. On a phone, rotating the device or the URL bar collapsing leaves
// Leaflet sized to the old viewport — a grey half-map that never recovers.
// visualViewport is the one that actually fires for the URL bar; plain
// `resize` doesn't reliably.
function MapResizer({ active }) {
  const map = useMap()

  useEffect(() => {
    if (active) {
      const id = setTimeout(() => map.invalidateSize(), 60)
      return () => clearTimeout(id)
    }
    return undefined
  }, [active, map])

  useEffect(() => {
    if (!active) return undefined
    let raf = 0
    const refresh = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => map.invalidateSize())
    }
    window.addEventListener('resize', refresh)
    window.addEventListener('orientationchange', refresh)
    window.visualViewport?.addEventListener('resize', refresh)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', refresh)
      window.removeEventListener('orientationchange', refresh)
      window.visualViewport?.removeEventListener('resize', refresh)
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
    // Trails sit just under the dots they follow, above the note ripples.
    if (!map.getPane('trails')) {
      const pane = map.createPane('trails')
      pane.style.zIndex = '445'
      pane.style.pointerEvents = 'none'
    }
    paneRef.current = map.getPane('playhead') ?? null
  }, [map, paneRef])
  return null
}

// Computes a lat/lng bounding box from the stops of the currently loaded routes.
// Preferred over the city's whole-network bounds because data-derived city bounds
// can span huge regional areas (e.g. HSL's GTFS reaches ~110 km of commuter rail/
// bus), which would zoom the map out so far that stop dots vanish.
function boundsFromRoutes(routes) {
  let latMin = Infinity, latMax = -Infinity, lngMin = Infinity, lngMax = -Infinity
  for (const r of routes ?? []) {
    for (const s of r.stops ?? []) {
      if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon)) continue
      if (s.lat < latMin) latMin = s.lat
      if (s.lat > latMax) latMax = s.lat
      if (s.lon < lngMin) lngMin = s.lon
      if (s.lon > lngMax) lngMax = s.lon
    }
  }
  return latMin <= latMax ? { latMin, latMax, lngMin, lngMax } : null
}

// Frames the map on what's playing. The MapContainer `center` prop only applies
// on first mount, so this fits the active (enabled / soloed) lanes' bounds —
// falling back to every loaded route, then the city's bounds, then its center
// when nothing is active — and refits whenever the city or active set changes.
const FIT_MAX_ZOOM = 15             // one short line shouldn't zoom to street level
const FIT_PADDING_TOP_LEFT = [110, 30]  // clear the lane-status overlay on the left
const FIT_PADDING_BOTTOM_RIGHT = [30, 30]

function CityView({ city, routes, disabled, soloRoutes, active }) {
  const map = useMap()
  const activeRoutes = useMemo(
    () => (routes ?? []).filter(r => isRouteActive(r, disabled, soloRoutes)),
    [routes, disabled, soloRoutes]
  )
  // Stable signature so we refit when the city or the set of active lanes
  // changes, not on every render (the playhead re-renders at 30 fps).
  const key = `${city?.id ?? ''}:${routes?.length ?? 0}:${activeRoutes.map(r => r.id).sort().join(',')}`
  useEffect(() => {
    // Skip while hidden: fitBounds on a display:none (0×0) container makes
    // Leaflet's getBoundsZoom return maxZoom, zooming to street level. We refit
    // once the map is visible/sized (this effect also re-runs on active false→true).
    if (!active) return
    const b = boundsFromRoutes(activeRoutes.length ? activeRoutes : routes) ?? city?.bounds
    // Wait for the container to have real dimensions before computing the fit.
    const id = setTimeout(() => {
      map.invalidateSize()
      if (b && [b.latMin, b.latMax, b.lngMin, b.lngMax].every(Number.isFinite)) {
        map.fitBounds([[b.latMin, b.lngMin], [b.latMax, b.lngMax]], {
          paddingTopLeft: FIT_PADDING_TOP_LEFT,
          paddingBottomRight: FIT_PADDING_BOTTOM_RIGHT,
          maxZoom: FIT_MAX_ZOOM,
        })
      } else if (Array.isArray(city?.center)) {
        map.setView(city.center, map.getZoom())
      }
    }, 60)
    return () => clearTimeout(id)
  }, [key, active, map]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

// A ripple at the stop that just played, so the map shows where the music is
// coming from rather than only a dot sliding along each line.
//
// Reads the same note feed as the DAW's event log (eventLogStore), imperatively:
// a ripple is a DOM divIcon that removes itself, so nothing here touches React
// state per note. Notes are scheduled `lookAhead` ahead of the audio clock, so
// each ripple waits that long to land on the beat it belongs to.
const RIPPLE_MS       = 1100
const MAX_RIPPLES     = 48   // concurrent; a dense arp shouldn't pile up DOM
const MAX_RIPPLE_BURST = 12  // per flush

function NoteRipples({ routes, active }) {
  const map = useMap()
  const lookupRef = useRef({ byId: new Map(), byName: new Map() })

  useEffect(() => {
    const byId = new Map(), byName = new Map()
    for (const r of routes ?? []) {
      const entry = { color: safeColor(r.color), stops: new Map((r.stops ?? []).map(st => [st.id, st])) }
      byId.set(r.id, entry)
      if (!r.isDuplicate) byName.set(r.name, entry)
    }
    lookupRef.current = { byId, byName }
  }, [routes])

  useEffect(() => {
    if (!active) return undefined
    if (!map.getPane('ripples')) {
      const pane = map.createPane('ripples')
      pane.style.zIndex = '440'           // above lines, under the playhead pane
      pane.style.pointerEvents = 'none'
    }
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const live = new Set()
    const timers = new Set()
    const later = (fn, ms) => {
      const t = setTimeout(() => { timers.delete(t); fn() }, ms)
      timers.add(t)
    }

    const spawn = (stop, color, velocity) => {
      if (live.size >= MAX_RIPPLES) return
      const scale = 0.7 + 0.6 * Math.max(0, Math.min(1, velocity ?? 1))
      const marker = L.marker([stop.lat, stop.lon], {
        pane: 'ripples',
        interactive: false,
        keyboard: false,
        icon: L.divIcon({
          className: 'map-ripple',
          html: `<span style="--ripple-color:${color};--ripple-scale:${scale.toFixed(2)}"></span>`,
          iconSize: [0, 0],
        }),
      }).addTo(map)
      live.add(marker)
      later(() => { marker.remove(); live.delete(marker) }, RIPPLE_MS)
    }

    let head = getEvents()[0]
    const unsubscribe = subscribeEvents(() => {
      const events = getEvents()
      const fresh = []
      for (const ev of events) {
        if (ev === head) break
        fresh.push(ev)
      }
      head = events[0]
      if (reduced || document.hidden || !fresh.length) return
      const lead = Math.max(0, (Tone.getContext().lookAhead ?? 0) * 1000)
      const { byId, byName } = lookupRef.current
      for (const ev of fresh.slice(0, MAX_RIPPLE_BURST)) {
        if (ev.stopId == null) continue   // merged chord lanes have no single stop
        const r = (ev.routeId && (byId.get(ev.routeId) ?? byId.get(ev.routeId.split('~dup~')[0])))
          ?? byName.get(ev.routeShortName)
        const stop = r?.stops.get(ev.stopId)
        if (!stop || !Number.isFinite(stop.lat) || !Number.isFinite(stop.lon)) continue
        later(() => spawn(stop, r.color, ev.velocity), lead)
      }
    })

    return () => {
      unsubscribe()
      for (const t of timers) clearTimeout(t)
      for (const m of live) m.remove()
    }
  }, [active, map])

  return null
}

function MapView({
  className = '',
  active = true,
  routes = null,
  city = null,
  started = false,
  mode = 'mock',
  disabled = {},
  soloRoutes = new Set(),
  trackLabels = {},
  liveSnapshot = null,
  automationCfg = {},
  trackSpeeds = {},
  trackLoopRegions = {},
  trackSynthTypes = {},
}) {
  // Drives the phone-only map concessions: canvas rendering, no zoom control,
  // and no per-stop CircleMarkers.
  const isPhone = useIsPhone()
  const [playheadPositions, setPlayheadPositions] = useState({})
  const rafRef       = useRef(null)
  const disabledRef  = useRef(disabled)
  const soloRef      = useRef(soloRoutes)
  const playheadPane = useRef(null)   // DOM div for the playhead Leaflet pane

  const speedsRef     = useRef(trackSpeeds)
  const regionsRef    = useRef(trackLoopRegions)

  useEffect(() => { disabledRef.current = disabled }, [disabled])
  useEffect(() => { soloRef.current  = soloRoutes }, [soloRoutes])
  useEffect(() => { speedsRef.current  = trackSpeeds }, [trackSpeeds])
  useEffect(() => { regionsRef.current = trackLoopRegions }, [trackLoopRegions])

  const automation = useMemo(
    () => buildAutomationLinks(automationCfg, routes, trackSynthTypes),
    [automationCfg, routes, trackSynthTypes]
  )
  const automationRef = useRef(automation)
  useEffect(() => { automationRef.current = automation }, [automation])

  const LAYERS = [
    { type: 'metro',   label: 'Metro' },
    { type: 'tram',    label: 'Tram' },
    { type: 'trolley', label: 'Trolley' },
    { type: 'bus',     label: 'Bus' },
    { type: 'hev',     label: 'Rail' },
  ]
  // Duplicate lanes share their source's polyline, so they'd draw on top of it —
  // hide them on the map (they're audio-only chord layers). Memoized so the 30 fps
  // playhead re-render doesn't rebuild these each frame.
  const { routesByType, allRoutes } = useMemo(() => {
    const byType = Object.fromEntries(
      LAYERS.map(l => [l.type, routes?.filter(r => r.type === l.type && !r.isDuplicate) ?? []])
    )
    return { routesByType: byType, allRoutes: LAYERS.flatMap(l => byType[l.type]) }
  }, [routes]) // eslint-disable-line react-hooks/exhaustive-deps

  // rAF loop — only runs in mock mode while playing, and only while the map is
  // the visible view (MixerTab keeps MapView mounted but hidden in the DAW view).
  useEffect(() => {
    if (!active || !started || mode !== 'mock' || !routes) {
      setPlayheadPositions({})
      return
    }

    let lastUpdate = 0
    const routeById = new Map(routes.map(r => [r.id, r]))
    // A trail is a fan of short segments, so its cost is lanes × samples paths
    // redrawn per frame. Phones get a coarser one.
    const trailSamples = isPhone ? TRAIL_SAMPLES_PHONE : TRAIL_SAMPLES
    const trailOf = (route, opts) =>
      trailFracs({ ...opts, trailBeats: TRAIL_BEATS, samples: trailSamples })
        .map(f => positionAlongRoute(route, f))
        .filter(Boolean)

    function tick(ts) {
      rafRef.current = requestAnimationFrame(tick)
      if (ts - lastUpdate < 33) return  // ~30fps
      lastUpdate = ts

      // Each lane's Part loops its own region at its own speed (polyrhythm), so
      // every dot gets its own phase — see lib/mapPlayhead.js. Measured in beats
      // because Parts loop in ticks.
      const transport = Tone.getTransport()
      const beats = transport.ticks / (transport.PPQ || 192)

      const next = {}
      for (const route of routes) {
        if (route.isDuplicate) continue
        if (!isRouteActive(route, disabledRef.current, soloRef.current)) continue
        const timing = {
          beats,
          speed: speedsRef.current?.[route.id] ?? 1,
          region: regionsRef.current?.[route.id],
        }
        const { frac, phase } = lanePlayhead(timing)
        const pos = positionAlongRoute(route, frac)
        if (pos) next[route.id] = { ...pos, fade: wrapFade(phase), color: route.color, kind: 'note', trail: trailOf(route, timing) }
      }
      // Automation lanes read their source line at the lane's own speed and
      // sub-loop (falling back to the source's region), like the engine does.
      for (const link of automationRef.current.links) {
        const dest = routeById.get(link.destId) ?? routeById.get(link.destId.split('~dup~')[0])
        if (dest && !isRouteActive(dest, disabledRef.current, soloRef.current)) continue
        const timing = {
          beats,
          speed: link.cfg.speed ?? 1,
          region: link.cfg.loopRegion ?? regionsRef.current?.[link.src.id],
        }
        const { frac, phase } = lanePlayhead(timing)
        const pos = positionAlongRoute(link.src, frac)
        if (pos) next[`auto:${link.key}`] = { ...pos, fade: wrapFade(phase), color: AUTOMATION_COLOR, kind: 'auto', trail: trailOf(link.src, timing) }
      }
      setPlayheadPositions(next)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(rafRef.current)
      setPlayheadPositions({})
    }
  }, [active, started, mode, routes, isPhone])

  // Live vehicles indexed by routeShortName
  const vehiclesByRouteName = {}
  if (mode === 'live' && liveSnapshot?.vehicles) {
    for (const v of liveSnapshot.vehicles) {
      if (!vehiclesByRouteName[v.routeShortName]) vehiclesByRouteName[v.routeShortName] = []
      vehiclesByRouteName[v.routeShortName].push(v)
    }
  }

  // The static polyline + stop layer. Memoized on its only real inputs so the
  // 30 fps playhead re-render (setPlayheadPositions) returns the same element
  // references and React skips reconciling this heavy tree (hundreds of large
  // polylines + up to ~780 metro stop markers for NYC-scale cities).
  const routeLayers = useMemo(() => (
    <LayersControl position="topright">
      {LAYERS.map(({ type, label }) => {
        const layerRoutes = routesByType[type]
        if (!layerRoutes.length) return null
        // Metro stop markers are up to ~780 CircleMarkers for NYC-scale
        // cities. That already froze desktop once (see the memo note above);
        // a phone GPU has no chance, and the dots are unreadable at that size.
        const showStops = type === 'metro' && !isPhone
        return (
          <LayersControl.Overlay key={type} checked name={label}>
            <>
              {/* Soft glow under the lines that are playing, so the mix reads
                  at a glance against the dimmed network. */}
              {layerRoutes
                .filter(route => isRouteActive(route, disabled, soloRoutes))
                .map(route => route.polylines.map(pl => (
                  <Polyline
                    key={`${route.id}_${pl.direction}_glow`}
                    positions={pl.coords}
                    interactive={false}
                    pathOptions={{ color: route.color, weight: route.type === 'metro' ? 10 : 8, opacity: 0.16, lineCap: 'round', lineJoin: 'round' }}
                  />
                )))}
              {layerRoutes.map(route => {
                const { opacity, weight, dashArray } = routeStyle(route, disabled, soloRoutes)
                return route.polylines.map(pl => (
                  // Style goes through pathOptions: react-leaflet applies bare
                  // color/weight/opacity props only at creation, so toggling a
                  // lane on would leave its line drawn dimmed and dashed.
                  <Polyline
                    key={`${route.id}_${pl.direction}`}
                    positions={pl.coords}
                    pathOptions={{ color: route.color, weight, opacity, dashArray }}
                  >
                    <Tooltip sticky>{route.name}: {route.desc}</Tooltip>
                  </Polyline>
                ))
              })}
              {/* Stop markers only for ACTIVE routes. Drawing every metro
                  stop (dimmed) is prohibitively heavy for large all-metro
                  networks like NYC's 28-line subway (~780 interactive
                  markers) and froze the tab; a fresh all-disabled session
                  now renders none, and stops appear as lines are enabled. */}
              {showStops && layerRoutes
                .filter(route => isRouteActive(route, disabled, soloRoutes))
                .map(route =>
                  route.stops.map((stop, i) => (
                    <CircleMarker
                      key={`${route.id}_${stop.id}_${i}`}
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
        )
      })}
      {automation.bySource.size > 0 && (
        <LayersControl.Overlay checked name="Automation">
          <>
            {[...automation.bySource.values()].map(lanes => {
              const src = lanes[0].src
              const summary = lanes.map(l => `${l.destName} · ${l.target}`).join(', ')
              return src.polylines.map(pl => (
                // Amber "signal" line on top of the source's own line: this
                // line is a control path, its stops drive another lane's knob.
                <Polyline
                  key={`auto_${src.id}_${pl.direction}`}
                  positions={pl.coords}
                  className="map-auto-line"
                  pathOptions={{ color: AUTOMATION_COLOR, weight: 2.5, opacity: 0.95, dashArray: '2 9', lineCap: 'round' }}
                >
                  <Tooltip sticky>Automation: {src.name} drives {summary}</Tooltip>
                </Polyline>
              ))
            })}
            {/* The envelope itself, drawn on the map: each stop of the source
                is sized by the value it sends (first lane on that source).
                Same resolution as the engine's AutomationTrack.valueAt. */}
            {!isPhone && [...automation.bySource.values()].map(lanes => {
              const { src, laneId, cfg } = lanes[0]
              return (src.stops ?? []).map((stop, i) => {
                const v = cfg.points?.[stop.id]
                const value = typeof v === 'number' ? v : hashStopValue(laneId, stop.id)
                return (
                  <CircleMarker
                    key={`auto_${src.id}_${stop.id}_${i}`}
                    center={[stop.lat, stop.lon]}
                    radius={2 + value * 6}
                    className="map-auto-stop"
                    pathOptions={{ color: AUTOMATION_COLOR, fillColor: AUTOMATION_COLOR, fillOpacity: 0.18 + value * 0.5, weight: 1, opacity: 0.9 }}
                  >
                    <Tooltip>{stop.name}: {Math.round(value * 100)}%</Tooltip>
                  </CircleMarker>
                )
              })
            })}
          </>
        </LayersControl.Overlay>
      )}
    </LayersControl>
  ), [routesByType, disabled, soloRoutes, isPhone, automation]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`map-wrapper${className ? ` ${className}` : ''}`}>
      {!routes && <div className="map-loading">Loading line data…</div>}

      {/* ── Track status overlay ── */}
      {routes && (
        <div className="map-track-status">
          {allRoutes.map(route => {
            const active     = isRouteActive(route, disabled, soloRoutes)
            const isDisabled = disabled[route.id]
            const isSoloed   = soloRoutes.has(route.id)
            // Role label set in the DAW lane header — the overlay is the map's
            // lane list, so "which one is the bass" should be answerable here too.
            const tag = normalizeLaneTag(trackLabels[route.id])
            return (
              <div key={route.id} className={`map-status-row${active ? '' : ' map-status-row--dim'}`}>
                <span className="map-status-dot" style={{ background: route.color }} />
                <span className="map-status-name">{route.name}</span>
                {tag.text && (
                  <span
                    className={`map-status-tag${tag.color ? ' is-colored' : ''}`}
                    style={tag.color ? { '--lane-tag-color': tag.color } : undefined}
                  >{tag.text}</span>
                )}
                {isDisabled && <span className="map-status-badge map-status-badge--disabled">OFF</span>}
                {isSoloed   && <span className="map-status-badge map-status-badge--solo">S</span>}
              </div>
            )
          })}
          {automation.links.length > 0 && (
            <>
              <div className="map-status-heading">Automation</div>
              {automation.links.map(link => {
                const dest = allRoutes.find(r => r.id === link.destId)
                const live = !dest || isRouteActive(dest, disabled, soloRoutes)
                return (
                  <div key={link.key} className={`map-status-row map-status-row--auto${live ? '' : ' map-status-row--dim'}`}>
                    <span className="map-status-badge map-status-badge--auto">AUTO</span>
                    <span className="map-status-dot" style={{ background: link.src.color }} />
                    <span className="map-status-name">{link.src.name}</span>
                    <span className="map-status-arrow" aria-hidden="true">→</span>
                    <span className="map-status-name">{link.destName}</span>
                    <span className="map-status-target">{link.target}</span>
                  </div>
                )
              })}
            </>
          )}
        </div>
      )}

      <MapContainer
        center={[47.4979, 19.0402]}
        zoom={12}
        className="map-container"
        // Thousands of SVG paths is the main source of map jank; canvas draws
        // them in one pass. Phones only — the SVG renderer keeps per-path
        // hover/tooltip behaviour that desktop relies on.
        preferCanvas={isPhone}
        // Pinch-zoom works; the +/− control is a 26px tap target over the map.
        zoomControl={!isPhone}
      >
        <MapResizer active={active} />
        <PlayheadPaneSetup paneRef={playheadPane} />
        <CityView
          city={city}
          routes={allRoutes}
          disabled={disabled}
          soloRoutes={soloRoutes}
          active={active}
        />

        <BaseMap />

        {routeLayers}

        <NoteRipples routes={routes} active={active && started} />

        {/* ── Mock mode: playhead dot per lane, in its own pane above the lines ── */}
        {mode === 'mock' && Object.entries(playheadPositions).map(([key, p]) => (
          <PlayheadTrail key={`${key}_trail`} points={p.trail} color={p.color} fade={p.fade} />
        ))}
        {mode === 'mock' && Object.entries(playheadPositions).map(([key, p]) => (
          <PlayheadMarker
            key={key}
            lat={p.lat}
            lng={p.lng}
            color={p.color}
            fade={p.fade}
            variant={p.kind}
            pane="playhead"
          />
        ))}

        {/* ── Live mode: vehicle dots ── */}
        {mode === 'live' && allRoutes.map(route => {
          if (!isRouteActive(route, disabled, soloRoutes)) return null
          return (vehiclesByRouteName[route.name] ?? [])
            .filter(v => v.lat != null && v.lng != null)
            .map(v => (
              <PlayheadMarker key={v.vehicleId} lat={v.lat} lng={v.lng} color={route.color} />
            ))
        })}
      </MapContainer>

      {city?.attribution?.text && (
        <div className="map-attribution">
          {city.attribution.licenseUrl ? (
            <a href={city.attribution.licenseUrl} target="_blank" rel="noreferrer">
              {city.attribution.text}
            </a>
          ) : city.attribution.text}
        </div>
      )}
    </div>
  )
}

// Memoized: MapView doesn't consume the per-note `events` state, and every prop
// MixerTab passes is a state value / stable string that doesn't change per note,
// so this skips the whole (expensive) map render on the note-driven re-render storm.
export default memo(MapView)

// The path a lane's dot has just travelled, as segments that brighten and
// thicken toward the dot. Leaflet has no gradient strokes, so the fade is
// stepped: one Polyline per segment, a fixed count per trail so React only
// updates positions frame to frame instead of adding/removing layers.
const TRAIL_BEATS        = 2
const TRAIL_SAMPLES      = 10
const TRAIL_SAMPLES_PHONE = 5

function PlayheadTrail({ points, color, fade = 1 }) {
  if (!points || points.length < 2) return null
  const n = points.length - 1
  return points.slice(0, -1).map((p, i) => {
    const t = (i + 1) / n          // 0 at the tail → 1 at the dot
    return (
      <Polyline
        key={i}
        positions={[[p.lat, p.lng], [points[i + 1].lat, points[i + 1].lng]]}
        pane="trails"
        interactive={false}
        pathOptions={{ color, weight: 1.5 + t * 4, opacity: fade * t * t * 0.85, lineCap: 'round' }}
      />
    )
  })
}

// Style goes through pathOptions so the per-frame fade actually updates (bare
// color/opacity props only apply when the marker is created).
function PlayheadMarker({ lat, lng, color, pane, fade = 1, variant = 'note' }) {
  const opts = pane ? { pane } : {}
  if (variant === 'auto') {
    return (
      <CircleMarker
        center={[lat, lng]}
        radius={5}
        className="map-auto-dot"
        pathOptions={{ color, fillColor: '#111111', fillOpacity: 0.9 * fade, opacity: fade, weight: 2.5 }}
        interactive={false}
        {...opts}
      />
    )
  }
  return (
    <>
      <CircleMarker
        center={[lat, lng]}
        radius={13}
        className="map-playhead-pulse"
        pathOptions={{ color, fillColor: color, fillOpacity: 0.12 * fade, opacity: fade, weight: 2 }}
        interactive={false}
        {...opts}
      />
      <CircleMarker
        center={[lat, lng]}
        radius={7}
        className="map-playhead-dot"
        pathOptions={{ color, fillColor: '#ffffff', fillOpacity: 0.95 * fade, opacity: fade, weight: 2.5 }}
        interactive={false}
        {...opts}
      />
    </>
  )
}
