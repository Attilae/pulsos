import * as Tone from 'tone'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, Polyline, CircleMarker, Tooltip, LayersControl, useMap } from 'react-leaflet'
import L from 'leaflet'
import { maplibreGL } from '@maplibre/maplibre-gl-leaflet'
import { setWorkerUrl, getVersion } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useIsPhone, useIsTablet } from '@/lib/shared/useViewport.js'
import { useTheme } from '@/lib/shared/ThemeContext.jsx'
import { normalizeLaneTag } from '@/lib/laneTags.js'
import { findTargetSpec } from '@/lib/engine.js'
import { hashStopValue } from '@/lib/mappings.js'
import { lanePlayhead, trailFracs, wrapFade } from '@/lib/mapPlayhead.js'
import { BASEMAP_STYLE_URLS, quietBasemapStyle } from '@/lib/mapBasemapStyle.js'
import {
  FIT_MAX_ZOOM, MAP_BACKGROUND, isRouteActive, routeLineStyle, fitTarget, framingKey, overlayFitPadding, boundsFromRoutes,
} from '@/lib/mapVisualPolicy.js'
import {
  STOP_CAP, STOP_DETAIL_MIN_ZOOM, buildMapLanes, activeGeometryIds, laneForRouteClick, toggleFocus, reconcileFocus,
  sharedGeometryLanes, laneState, laneStops, visibleStopMarkers, stopInView,
} from '@/lib/mapLanes.js'
import { subscribeEvents, getEvents } from '@/lib/shared/eventLogStore.js'
import Sheet from '@/components/Sheet.jsx'
import { IconAdd, IconMinus, IconFit, IconCaretDown, IconCaretRight, IconWarning } from '@/components/icons.jsx'

// MapLibre 6 can't find its worker inside a webpack chunk; it is served from
// public/vendor by scripts/copy_maplibre_worker.js (prebuild/predev).
setWorkerUrl(`/vendor/maplibre-gl-worker-${getVersion()}.mjs`)
import { subscribePlayhead } from '@/lib/shared/playheadTicker.js'
import { useCitySelection } from '@/lib/shared/CityContext.jsx'
import { useDetailPolylines } from '@/lib/shared/useDetailPolylines.js'
import './MapView.css'

delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({ iconUrl: '', shadowUrl: '' })

// ── Basemap ───────────────────────────────────────────────────────────────
// OpenFreeMap vector tiles (free, no key, commercial use allowed) drawn by
// MapLibre GL inside Leaflet's tile pane. The style follows the app theme:
// OpenFreeMap's `dark` or `positron`, fetched and quietened by
// lib/mapBasemapStyle.js. Attribution (OpenFreeMap, OpenMapTiles, ©
// OpenStreetMap contributors) comes from the tile source.
//
// One Leaflet map and one MapLibre layer for the life of the view: a theme
// change swaps the style on the existing GL map, so the camera, the routes and
// the playheads are untouched. A newer load supersedes an older one (token),
// and a failure leaves the routes drawn over --bg with a Retry, never blocking
// the music or the map controls.
const styleCache = new Map()   // url → Promise<style JSON>
function fetchStyle(url) {
  if (!styleCache.has(url)) {
    styleCache.set(url, fetch(url).then(r => {
      if (!r.ok) throw new Error(`basemap style ${r.status}`)
      return r.json()
    }).catch(err => { styleCache.delete(url); throw err }))
  }
  return styleCache.get(url)
}

function BaseMap({ theme, retryNonce, onStatus }) {
  const map = useMap()
  const layerRef = useRef(null)
  const tokenRef = useRef(0)
  const statusRef = useRef(onStatus)
  useEffect(() => { statusRef.current = onStatus }, [onStatus])

  // Keep Leaflet and the GL canvas sized together. The Map⇄DAW toggle resizes
  // the container without a window resize, and the binding's own resize
  // handler never calls MapLibre's resize(), so watch the container directly.
  useEffect(() => {
    let raf = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        map.invalidateSize()
        layerRef.current?.getMaplibreMap?.()?.resize()
      })
    })
    observer.observe(map.getContainer())
    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      layerRef.current?.remove()
      layerRef.current = null
    }
  }, [map])

  useEffect(() => {
    const token = ++tokenRef.current
    statusRef.current?.('loading')
    fetchStyle(BASEMAP_STYLE_URLS[theme] ?? BASEMAP_STYLE_URLS.dark)
      .then(raw => {
        if (token !== tokenRef.current) return   // superseded by a newer theme/retry
        const style = quietBasemapStyle(raw, theme)
        const gl = layerRef.current?.getMaplibreMap?.()
        if (gl) gl.setStyle(style)
        else layerRef.current = maplibreGL({ style }).addTo(map)
        statusRef.current?.('ready')
      })
      .catch(() => {
        // Covers both a failed fetch and MapLibre failing to start (no WebGL).
        if (token === tokenRef.current) statusRef.current?.('error')
      })
  }, [map, theme, retryNonce])
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

// Automation identity colour (--automation). Canvas-rendered maps (phones) can't
// read CSS custom properties, so the stroke carries the dark-theme hex and
// .map-auto-line re-points it at the token where SVG is in use.
const AUTOMATION_COLOR = '#e2a53b'

// Route colours come from the data file and end up inside a divIcon's HTML.
const SAFE_COLOR = /^#[0-9a-f]{3,8}$/i
const safeColor = c => (SAFE_COLOR.test(c ?? '') ? c : '#ffffff')

const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

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

// Hands the Leaflet map to the overlay controls, which live outside
// MapContainer (they're React DOM over the map, not Leaflet controls).
function MapBridge({ mapRef }) {
  const map = useMap()
  useEffect(() => {
    mapRef.current = map
    return () => { if (mapRef.current === map) mapRef.current = null }
  }, [map, mapRef])
  return null
}

// One attribution line, bottom-left: Leaflet's own control carries the basemap
// credit, and the city's transit-data credit joins it. (The AI Composer floats
// over the bottom-right on desktop, and two separate credit boxes collided on
// phones.)
function Attribution({ city }) {
  const map = useMap()
  useEffect(() => { map.attributionControl?.setPosition('bottomleft') }, [map])
  const text = city?.attribution?.text
  const url = city?.attribution?.licenseUrl
  useEffect(() => {
    const ctl = map.attributionControl
    if (!ctl || !text) return undefined
    const html = url
      ? `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(text)}</a>`
      : escapeHtml(text)
    ctl.addAttribution(html)
    return () => { ctl.removeAttribution(html) }
  }, [map, text, url])
  return null
}

// Camera ownership. The map frames the city/song once — on first show, a city
// switch, or a new set of routes (song load, Re-pick) — and otherwise leaves
// the camera where the user put it: enabling or soloing lanes, switching
// Map⇄DAW and changing theme never move it. "Fit mix" reframes on demand.
function MapFraming({ cityId, cityBounds, routes, activeIds, active, fitRef, getPadding }) {
  const map = useMap()
  const latest = useRef(null)
  latest.current = { routes, activeIds, cityBounds }

  const fit = useCallback((animate = false) => {
    const { routes: rs, activeIds: ids, cityBounds: cb } = latest.current
    const { bounds: b } = fitTarget(rs, r => ids.has(r.id), cb)
    if (!b) return
    map.invalidateSize()
    map.fitBounds([[b.latMin, b.lngMin], [b.latMax, b.lngMax]], {
      ...getPadding(),
      maxZoom: FIT_MAX_ZOOM,
      animate,
    })
  }, [map, getPadding])
  useEffect(() => { fitRef.current = fit }, [fit, fitRef])

  const key = framingKey(cityId, routes)
  const framedRef = useRef(null)
  useEffect(() => {
    // Skip while hidden: fitBounds on a display:none (0×0) container zooms to
    // maxZoom. A change that lands while hidden is framed when the map shows.
    if (!active || !routes || framedRef.current === key) return undefined
    const id = setTimeout(() => { framedRef.current = key; fit(false) }, 60)
    return () => clearTimeout(id)
  }, [key, active, routes, fit])
  return null
}

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// ── Lane list ─────────────────────────────────────────────────────────────
// The map's legend: every DAW lane (base, duplicate, merged) with its on/off,
// solo and role label. Each row is a *visual* focus button: it never changes
// what plays. Audio Enable/Solo stay in the lane view ("Show lanes").
function laneSummary(lane, disabled, soloRoutes, trackLabels) {
  const tag = normalizeLaneTag(trackLabels[lane.id])
  return { tag, state: laneState(lane, disabled, soloRoutes), on: isRouteActive(lane, disabled, soloRoutes) }
}

function LaneRows({ lanes, disabled, soloRoutes, trackLabels, automation, focusedId, onFocus }) {
  return (
    <>
      <ul className="map-lanes" aria-label="Lanes on the map">
        {lanes.map(lane => {
          const { tag, state, on } = laneSummary(lane, disabled, soloRoutes, trackLabels)
          const focused = lane.id === focusedId
          const extra = [tag.text, state.toLowerCase()].filter(Boolean).join(', ')
          return (
            <li key={lane.id} className="map-lane-item">
              <button
                type="button"
                className={`map-lane${on ? '' : ' map-lane--off'}${focused ? ' map-lane--focused' : ''}`}
                aria-pressed={focused}
                aria-label={`Focus ${lane.name} on map (${extra})`}
                title={lane.desc ? `${lane.name}: ${lane.desc}` : lane.name}
                onClick={() => onFocus(lane.id)}
              >
                <span className="map-lane-dot" style={{ '--route-color': safeColor(lane.color) }} aria-hidden="true" />
                <span className="map-lane-name" aria-hidden="true">{lane.name}</span>
                {tag.text && (
                  <span
                    className={`map-lane-tag${tag.color ? ' is-colored' : ''}`}
                    style={tag.color ? { '--lane-tag-color': tag.color } : undefined}
                    aria-hidden="true"
                  >{tag.text}</span>
                )}
                {disabled[lane.id] && <span className="map-lane-badge map-lane-badge--off" aria-hidden="true">Off</span>}
                {soloRoutes.has(lane.id) && <span className="map-lane-badge map-lane-badge--solo" aria-hidden="true">S</span>}
              </button>
            </li>
          )
        })}
      </ul>
      {automation.links.length > 0 && (
        <>
          <div className="map-lanes-heading">Automation</div>
          <ul className="map-lanes" aria-label="Automation on the map">
            {automation.links.map(link => (
              <li key={link.key} className="map-lane map-lane--auto" title={`${link.src.name} drives ${link.destName} · ${link.target}`}>
                <span className="map-lane-dot" style={{ '--route-color': safeColor(link.src.color) }} aria-hidden="true" />
                <span className="map-lane-name">{link.src.name} → {link.destName}</span>
                <span className="map-lane-target">{link.target}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}

function LanePanel({ isPhone, isTablet, lanes, disabled, soloRoutes, trackLabels, automation, onShowLanes, focusedId, onFocus, sheetOpen, setSheetOpen, disclosureRef }) {
  // Tablets start collapsed (the map is narrow); desktop starts open.
  const [open, setOpen] = useState(!isTablet)
  const wasTablet = useRef(isTablet)
  useEffect(() => {
    if (isTablet !== wasTablet.current) { setOpen(!isTablet); wasTablet.current = isTablet }
  }, [isTablet])
  const audible = lanes.filter(l => isRouteActive(l, disabled, soloRoutes)).length
  const count = `${audible} of ${lanes.length} on`

  if (isPhone) {
    return (
      <>
        <button
          ref={disclosureRef}
          type="button"
          className="map-lanes-disclosure"
          aria-haspopup="dialog"
          onClick={() => setSheetOpen(true)}
        >
          <span>Lanes</span>
          <span className="map-lanes-count">{count}</span>
        </button>
        <Sheet
          open={sheetOpen}
          title="Lanes on the map"
          onClose={() => setSheetOpen(false)}
          footer={onShowLanes && (
            <button type="button" className="map-btn map-btn--primary" onClick={() => { setSheetOpen(false); onShowLanes() }}>
              Show lane controls
            </button>
          )}
        >
          <div className="map-lanes-sheet">
            <p className="map-lanes-hint">Pick a lane to see it on the map. Its sound doesn't change.</p>
            {/* Choosing a lane closes the sheet; useModal returns focus to "Lanes". */}
            <LaneRows lanes={lanes} disabled={disabled} soloRoutes={soloRoutes} trackLabels={trackLabels} automation={automation}
              focusedId={focusedId} onFocus={id => { onFocus(id); setSheetOpen(false) }} />
          </div>
        </Sheet>
      </>
    )
  }

  return (
    <section className={`map-panel${open ? '' : ' map-panel--collapsed'}`} aria-label="Map lanes">
      <button type="button" className="map-panel-head" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        {open ? <IconCaretDown /> : <IconCaretRight />}
        <span className="map-panel-title">Lanes</span>
        <span className="map-lanes-count">{count}</span>
      </button>
      {open && (
        <div className="map-panel-body">
          <LaneRows lanes={lanes} disabled={disabled} soloRoutes={soloRoutes} trackLabels={trackLabels} automation={automation}
            focusedId={focusedId} onFocus={onFocus} />
        </div>
      )}
    </section>
  )
}

// What the focused lane is, as text (so selection is never colour-only), plus
// Fit route / Clear focus and the ordered stop list. Event-driven: nothing
// here updates per frame or per note.
function FocusDetails({ lane, summary, shared, stops, routesById, hasGeometry, selectedStop, stopVisible, onSelectStop, onShowStop, onFit, onClear, compact = false }) {
  const [stopsOpen, setStopsOpen] = useState(false)
  useEffect(() => { setStopsOpen(false) }, [lane.id])
  const { tag, state } = summary
  const multiRoute = lane.geometryIds.length > 1
  const head = (
    <div className="map-focus-head">
      <span className="map-lane-dot" style={{ '--route-color': safeColor(lane.color) }} aria-hidden="true" />
      <span className="map-focus-name">{lane.name}</span>
      {tag.text && (
        <span className={`map-lane-tag${tag.color ? ' is-colored' : ''}`} style={tag.color ? { '--lane-tag-color': tag.color } : undefined}>{tag.text}</span>
      )}
      <span className={`map-focus-state map-focus-state--${state === 'On' || state === 'Solo' ? 'on' : 'off'}`}>{state}</span>
    </div>
  )
  const actions = (
    <div className="map-focus-actions">
      <button type="button" className="map-btn" onClick={onFit} disabled={!hasGeometry}>Fit route</button>
      <button type="button" className="map-btn" onClick={onClear}>Clear focus</button>
    </div>
  )
  return (
    <section className={`map-focus${compact ? ' map-focus--compact' : ''}`} aria-label={`Focused lane: ${lane.name}`}>
      {head}
      {!hasGeometry && <p className="map-focus-note">No map geometry. The lane still plays.</p>}
      {!compact && lane.kind === 'duplicate' && <p className="map-focus-note">Copy of {routesById.get(lane.geometryIds[0])?.name ?? 'its source line'}, drawn on the same line.</p>}
      {!compact && lane.kind === 'merged' && <p className="map-focus-note">Chords from {lane.geometryIds.map(id => routesById.get(id)?.name).filter(Boolean).join(', ')}.</p>}
      {!compact && shared.length > 0 && <p className="map-focus-note">Same line as {shared.map(l => l.name).join(', ')}.</p>}
      {selectedStop && (
        <div className="map-focus-stop">
          <span className="map-focus-stop-name">{selectedStop.name}</span>
          {!stopVisible && <button type="button" className="map-btn" onClick={onShowStop}>Show stop</button>}
        </div>
      )}
      {actions}
      {!compact && hasGeometry && (
        <>
          <button type="button" className="map-focus-disclosure" aria-expanded={stopsOpen} onClick={() => setStopsOpen(o => !o)}>
            {stopsOpen ? <IconCaretDown /> : <IconCaretRight />}
            <span>Stops</span>
            <span className="map-lanes-count">{stops.length}</span>
          </button>
          {stopsOpen && (
            <div className="map-focus-stops">
              {lane.geometryIds.map(rid => {
                const list = stops.filter(s => s.routeId === rid)
                if (!list.length) return null
                return (
                  <div key={rid}>
                    {multiRoute && <div className="map-lanes-heading map-focus-route">{routesById.get(rid)?.name ?? rid}</div>}
                    <ol className="map-stops" aria-label={`Stops of ${routesById.get(rid)?.name ?? lane.name}`}>
                      {list.map(s => (
                        <li key={s.key}>
                          <button type="button" className="map-stop" aria-pressed={selectedStop?.key === s.key} onClick={() => onSelectStop(s.key)}>
                            {s.name}
                          </button>
                        </li>
                      ))}
                    </ol>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </section>
  )
}

// Stop markers for the focused lane only. Owns the viewport state, updated on
// moveend/zoomend (never per frame), so a pan re-renders this layer and
// nothing else. The selected stop is always marked and labelled, at any zoom.
function FocusStops({ stops, colorOf, bg, selectedKey, cap, onSelect, onVisibility, pane }) {
  const map = useMap()
  const read = useCallback(() => {
    const b = map.getBounds()
    return { zoom: map.getZoom(), bounds: { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() } }
  }, [map])
  const [view, setView] = useState(read)
  useEffect(() => {
    const update = () => setView(read())
    map.on('moveend zoomend', update)
    update()
    return () => { map.off('moveend zoomend', update) }
  }, [map, read])

  const selected = stops.find(s => s.key === selectedKey) ?? null
  const visible = stopInView(selected, view.bounds)
  useEffect(() => { onVisibility(visible) }, [visible, onVisibility])

  const markers = visibleStopMarkers(stops, { ...view, cap, selectedKey })
  return (
    <>
      {markers.filter(s => s.key !== selectedKey).map(s => (
        <CircleMarker
          key={s.key}
          {...(pane ? { pane } : {})}
          center={[s.lat, s.lon]}
          radius={4}
          pathOptions={{ color: safeColor(colorOf(s.routeId)), fillColor: bg, fillOpacity: 1, weight: 2 }}
          eventHandlers={{ click: () => onSelect(s.key) }}
        >
          <Tooltip>{s.name}</Tooltip>
        </CircleMarker>
      ))}
      {selected && (
        <CircleMarker
          key={`sel_${selected.key}`}
          {...(pane ? { pane } : {})}
          center={[selected.lat, selected.lon]}
          radius={6}
          pathOptions={{ color: safeColor(colorOf(selected.routeId)), fillColor: safeColor(colorOf(selected.routeId)), fillOpacity: 1, weight: 3 }}
          eventHandlers={{ click: () => onSelect(selected.key) }}
        >
          <Tooltip permanent direction="top" offset={[0, -8]} className="map-stop-label">{selected.name}</Tooltip>
        </CircleMarker>
      )}
    </>
  )
}

// The map pane focused lines and stop markers draw in: above every other route
// line (overlayPane, 400), under the ripples and playheads. Created during
// render so it exists before any child layer asks for it.
function FocusPane() {
  const map = useMap()
  if (!map.getPane('focus')) map.createPane('focus').style.zIndex = '420'
  return null
}

function MapView({
  className = '',
  active = true,
  routes = null,
  mapLanes = null,
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
  onShowLanes = null,
}) {
  // Phone concessions: canvas rendering, no zoom buttons (pinch), fewer stop
  // markers, and the lane list behind a sheet.
  const isPhone = useIsPhone()
  const isTablet = useIsTablet()
  const { theme } = useTheme()
  // Routes arrive slim (thinned polylines, same stops); the desktop map swaps in
  // the full-resolution lines once they've loaded. Phones stay on slim.
  const { cityEntry } = useCitySelection()
  const detail = useDetailPolylines(cityEntry, !isPhone)
  const linesOf = (route) => detail?.get(route.id) ?? route.polylines
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
  // The map draws physical geometry: each base route's lines once. Duplicate
  // and merged lanes reuse their sources' lines (lib/mapLanes.js). Memoized so
  // the 30 fps playhead re-render doesn't rebuild these each frame.
  const { routesByType, allRoutes, routesById } = useMemo(() => {
    const byType = Object.fromEntries(
      LAYERS.map(l => [l.type, routes?.filter(r => r.type === l.type && !r.isDuplicate) ?? []])
    )
    const all = LAYERS.flatMap(l => byType[l.type])
    return { routesByType: byType, allRoutes: all, routesById: new Map(all.map(r => [r.id, r])) }
  }, [routes]) // eslint-disable-line react-hooks/exhaustive-deps

  // The lanes the legend lists (MixerTab's DAW lanes); without them, the base routes.
  const lanes = useMemo(() => mapLanes ?? buildMapLanes(allRoutes), [mapLanes, allRoutes])
  // A line draws as audible when any lane on it is audible.
  const activeIds = useMemo(() => activeGeometryIds(lanes, disabled, soloRoutes), [lanes, disabled, soloRoutes])
  const activeRef = useRef(activeIds)
  useEffect(() => { activeRef.current = activeIds }, [activeIds])

  const audibleCount = useMemo(
    () => lanes.filter(l => isRouteActive(l, disabled, soloRoutes)).length,
    [lanes, disabled, soloRoutes]
  )
  const allOff = lanes.length > 0 && audibleCount === 0

  // ── Visual focus (phase 2). Map-local, event-driven, never touches audio. ──
  const [focusedId, setFocusedId] = useState(null)
  const [selectedStopKey, setSelectedStopKey] = useState(null)
  const [stopVisible, setStopVisible] = useState(true)
  const [sheetOpen, setSheetOpen] = useState(false)
  const focusedRef = useRef(null)
  focusedRef.current = focusedId
  const focusLane = useCallback(id => {
    setFocusedId(prev => toggleFocus(prev, id))
    setSelectedStopKey(null)
  }, [])
  const clearFocus = useCallback(() => { setFocusedId(null); setSelectedStopKey(null) }, [])
  // Removing the lane clears focus; disabling it doesn't (it shows as "Off").
  useEffect(() => {
    if (reconcileFocus(focusedId, lanes) !== focusedId) clearFocus()
  }, [lanes, focusedId, clearFocus])
  // A city switch or a new song (a new set of routes) clears it too.
  const frameKey = framingKey(city?.id, allRoutes)
  useEffect(() => { clearFocus() }, [frameKey, clearFocus])

  const focused = lanes.find(l => l.id === focusedId) ?? null
  const focusGeometry = useMemo(() => new Set(focused?.geometryIds ?? []), [focused])
  const focusStops = useMemo(() => (focused ? laneStops(focused, routesById) : []), [focused, routesById])
  const selectedStop = focusStops.find(s => s.key === selectedStopKey) ?? null
  const focusHasGeometry = focusStops.length > 0
  const selectStop = useCallback(key => setSelectedStopKey(k => (k === key ? null : key)), [])

  // A click on a line focuses a lane drawn on it (shared lines keep the
  // current lane). Through a ref so the memoized layer tree stays stable.
  const onRouteClickRef = useRef(null)
  onRouteClickRef.current = (routeId) => {
    const id = laneForRouteClick(routeId, lanes, focusedRef.current)
    if (id && id !== focusedRef.current) { setFocusedId(id); setSelectedStopKey(null) }
  }

  // Live vehicles indexed by routeShortName
  const vehiclesByRouteName = {}
  if (mode === 'live' && liveSnapshot?.vehicles) {
    for (const v of liveSnapshot.vehicles) {
      if (!vehiclesByRouteName[v.routeShortName]) vehiclesByRouteName[v.routeShortName] = []
      vehiclesByRouteName[v.routeShortName].push(v)
    }
  }

  // ── Basemap status ──
  const [basemap, setBasemap] = useState('loading')   // 'loading' | 'ready' | 'error'
  const [basemapRetry, setBasemapRetry] = useState(0)

  // ── Overlay geometry, for framing around the panels ──
  const wrapperRef = useRef(null)
  const leftRef = useRef(null)        // desktop: lanes panel + focus details
  const disclosureRef = useRef(null)  // phone: the Lanes button
  const controlsRef = useRef(null)
  const noticeRef = useRef(null)
  const mapRef = useRef(null)
  const fitRef = useRef(null)
  const getPadding = useCallback(() => {
    const container = mapRef.current?.getContainer()
    if (!container) return {}
    const rect = el => el?.getBoundingClientRect() ?? null
    const wrapper = wrapperRef.current
    const layersCtl = wrapper?.querySelector('.leaflet-control-layers')
    const attribution = wrapper?.querySelector('.leaflet-control-attribution')
    return overlayFitPadding(rect(container), {
      left: isPhone ? [] : [rect(leftRef.current)],
      top: isPhone ? [rect(disclosureRef.current), rect(noticeRef.current)] : [rect(noticeRef.current)],
      right: [rect(controlsRef.current), rect(layersCtl)],
      bottom: [rect(attribution)],
    })
  }, [isPhone])

  const fitRoute = useCallback(() => {
    const map = mapRef.current
    const b = boundsFromRoutes((focused?.geometryIds ?? []).map(id => routesById.get(id)).filter(Boolean))
    if (!map || !b) return
    map.fitBounds([[b.latMin, b.lngMin], [b.latMax, b.lngMax]], { ...getPadding(), maxZoom: FIT_MAX_ZOOM, animate: !prefersReducedMotion() })
  }, [focused, routesById, getPadding])
  const showStop = useCallback(() => {
    const map = mapRef.current
    if (!map || !selectedStop) return
    map.setView([selectedStop.lat, selectedStop.lon], Math.max(map.getZoom(), STOP_DETAIL_MIN_ZOOM + 1), { animate: !prefersReducedMotion() })
  }, [selectedStop])

  // The static polyline layer. Memoized on its only real inputs so a re-render
  // (live snapshots, mixer state) returns the same element references and
  // React skips reconciling this heavy tree (hundreds of large polylines).
  // There are no passive stop markers here any more: stops appear only for the
  // focused lane, zoomed in (FocusStops).
  const focusLayerProps = isPhone ? { eventHandlers: { add: e => e.target.bringToFront() } } : { pane: 'focus' }
  const raiseAndClick = id => ({ add: e => e.target.bringToFront(), click: () => onRouteClickRef.current?.(id) })
  const routeLayers = useMemo(() => (
    <LayersControl position="topright">
      {LAYERS.map(({ type, label }) => {
        const layerRoutes = routesByType[type]
        if (!layerRoutes.length) return null
        const styled = layerRoutes.map(route => {
          const on = activeIds.has(route.id)
          const sel = focusGeometry.has(route.id)
          const focus = focusGeometry.size === 0 ? null : sel ? 'selected' : on ? 'other' : null
          // Focused lines draw in their own pane, above every other line.
          // The key carries it because a layer's pane is fixed at creation.
          // Phones draw on canvas, and a canvas in a higher pane would swallow
          // taps meant for the lines below, so there they're raised instead.
          return { route, sel, ...routeLineStyle(route, { active: on, allOff, theme, focus }) }
        })
        return (
          <LayersControl.Overlay key={type} checked name={label}>
            <>
              {/* Neutral casing, only under lines whose colour lacks contrast
                  with the map (routeLineStyle). Drawn first so every casing
                  sits beneath every line of its pane. */}
              {styled.filter(s => s.casing).map(({ route, casing, sel }) => linesOf(route).map(pl => (
                <Polyline
                  key={`${route.id}_${pl.direction}_casing${sel ? '_f' : ''}`}
                  positions={pl.coords}
                  interactive={false}
                  pathOptions={casing}
                  {...(sel ? focusLayerProps : {})}
                />
              )))}
              {styled.map(({ route, line, sel }) => linesOf(route).map(pl => (
                // Style goes through pathOptions: react-leaflet applies bare
                // color/weight/opacity props only at creation, so toggling a
                // lane on would leave its line drawn dimmed and dashed.
                <Polyline
                  key={`${route.id}_${pl.direction}${sel ? '_f' : ''}`}
                  positions={pl.coords}
                  pathOptions={line}
                  eventHandlers={sel && isPhone ? raiseAndClick(route.id) : { click: () => onRouteClickRef.current?.(route.id) }}
                  {...(sel && !isPhone ? { pane: 'focus' } : {})}
                >
                  <Tooltip sticky>{route.name}: {route.desc}</Tooltip>
                </Polyline>
              )))}
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
              return linesOf(src).map(pl => (
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
  ), [routesByType, activeIds, focusGeometry, isPhone, automation, detail, allOff, theme]) // eslint-disable-line react-hooks/exhaustive-deps

  const notice = !routes ? null
    : lanes.length === 0 ? { text: 'Add a lane to begin.', action: 'Show lanes' }
    : allOff ? { text: 'Enable a lane to hear the city.', action: 'Show lanes' }
    : null

  const focusProps = focused && {
    lane: focused,
    summary: laneSummary(focused, disabled, soloRoutes, trackLabels),
    shared: sharedGeometryLanes(focused, lanes),
    stops: focusStops,
    routesById,
    hasGeometry: focusHasGeometry,
    selectedStop,
    stopVisible,
    onSelectStop: selectStop,
    onShowStop: showStop,
    onFit: fitRoute,
    onClear: clearFocus,
  }

  const panel = routes && lanes.length > 0 && (
    <LanePanel
      isPhone={isPhone}
      isTablet={isTablet}
      lanes={lanes}
      disabled={disabled}
      soloRoutes={soloRoutes}
      trackLabels={trackLabels}
      automation={automation}
      onShowLanes={onShowLanes}
      focusedId={focusedId}
      onFocus={focusLane}
      sheetOpen={sheetOpen}
      setSheetOpen={setSheetOpen}
      disclosureRef={disclosureRef}
    />
  )

  return (
    <div ref={wrapperRef} className={`map-wrapper${className ? ` ${className}` : ''}`} data-basemap={basemap}>
      {!routes && <div className="map-loading" role="status">Loading routes…</div>}

      {isPhone ? panel : (panel || focusProps) && (
        <div ref={leftRef} className="map-left">
          {panel}
          {focusProps && <FocusDetails {...focusProps} />}
        </div>
      )}

      <div ref={controlsRef} className="map-controls" role="group" aria-label="Map view">
        {!isPhone && (
          <>
            <button type="button" className="map-ctl" aria-label="Zoom in" title="Zoom in" onClick={() => mapRef.current?.zoomIn()}><IconAdd /></button>
            <button type="button" className="map-ctl" aria-label="Zoom out" title="Zoom out" onClick={() => mapRef.current?.zoomOut()}><IconMinus /></button>
          </>
        )}
        <button
          type="button"
          className="map-ctl"
          aria-label="Fit mix"
          title="Fit mix: frame the lanes you can hear"
          onClick={() => fitRef.current?.(!prefersReducedMotion())}
        ><IconFit /></button>
      </div>

      {(notice || basemap === 'error' || (isPhone && focusProps)) && (
        <div ref={noticeRef} className="map-notices">
          {/* Phone: the focused lane's compact summary, under the Lanes button. */}
          {isPhone && focusProps && <FocusDetails {...focusProps} compact />}
          {basemap === 'error' && (
            <div className="map-notice" role="status">
              <IconWarning />
              <span>Map background unavailable</span>
              <button type="button" className="map-btn" onClick={() => setBasemapRetry(n => n + 1)}>Retry</button>
            </div>
          )}
          {notice && (
            <div className="map-notice" role="status">
              <span>{notice.text}</span>
              {onShowLanes && <button type="button" className="map-btn map-btn--primary" onClick={onShowLanes}>{notice.action}</button>}
            </div>
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
        // Zoom/Fit are the React controls above (top-right, 12px inset).
        zoomControl={false}
        // Quarter-level snapping so Fit frames the mix snugly instead of up to
        // a whole zoom level (2x) loose; the +/- buttons still step by 1.
        zoomSnap={0.25}
        zoomDelta={1}
      >
        <MapBridge mapRef={mapRef} />
        <FocusPane />
        <MapResizer active={active} />
        <PlayheadPaneSetup paneRef={playheadPane} />
        <MapFraming
          cityId={city?.id}
          cityBounds={city?.bounds}
          routes={routes ? allRoutes : null}
          activeIds={activeIds}
          active={active}
          fitRef={fitRef}
          getPadding={getPadding}
        />
        <Attribution city={city} />

        <BaseMap theme={theme} retryNonce={basemapRetry} onStatus={setBasemap} />

        {routeLayers}

        {focused && focusHasGeometry && (
          <FocusStops
            stops={focusStops}
            colorOf={rid => routesById.get(rid)?.color}
            bg={MAP_BACKGROUND[theme === 'light' ? 'light' : 'dark']}
            selectedKey={selectedStopKey}
            cap={isPhone ? STOP_CAP.phone : STOP_CAP.desktop}
            onSelect={selectStop}
            onVisibility={setStopVisible}
            pane={isPhone ? null : 'focus'}
          />
        )}

        <NoteRipples routes={routes} active={active && started} />

        {/* ── Mock mode: playhead dot per lane, in its own pane above the lines ── */}
        <MockPlayheads
          enabled={active && started && mode === 'mock' && !!routes}
          routes={routes}
          trailSamples={isPhone ? TRAIL_SAMPLES_PHONE : TRAIL_SAMPLES}
          activeRef={activeRef}
          disabledRef={disabledRef}
          soloRef={soloRef}
          speedsRef={speedsRef}
          regionsRef={regionsRef}
          automationRef={automationRef}
        />

        {/* ── Live mode: vehicle dots ── */}
        {mode === 'live' && allRoutes.map(route => {
          if (!activeIds.has(route.id)) return null
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

// Memoized: MapView doesn't consume the per-note `events` state, and every prop
// MixerTab passes is a state value / stable string that doesn't change per note,
// so this skips the whole (expensive) map render on the note-driven re-render storm.
export default memo(MapView)

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

// The path a lane's dot has just travelled, as segments that brighten and
// thicken toward the dot. Leaflet has no gradient strokes, so the fade is
// stepped: a fixed number of short segments per trail.
const TRAIL_BEATS        = 2
const TRAIL_SAMPLES      = 10
const TRAIL_SAMPLES_PHONE = 5
const PLAYHEAD_FRAME_MS  = 33   // ~30 fps

// Mock-mode playheads: a dot (plus pulse ring) and a trail per active lane and
// automation link. Drawn imperatively from the shared playhead ticker: layers
// are created once per lane and then only moved and restyled, so nothing here
// re-renders React per frame. Trails share one canvas renderer (one redraw per
// frame instead of an SVG path update per segment); the dots stay SVG for
// their CSS pulse classes.
function MockPlayheads({ enabled, routes, trailSamples, activeRef, disabledRef, soloRef, speedsRef, regionsRef, automationRef }) {
  const map = useMap()
  useEffect(() => {
    if (!enabled) return undefined
    const trailRenderer = L.canvas({ pane: 'trails', padding: 0.2 })
    const layers = new Map()     // key → { kind, segments, pulse, dot }
    const routeById = new Map(routes.map(r => [r.id, r]))
    const trailOf = (route, timing) =>
      trailFracs({ ...timing, trailBeats: TRAIL_BEATS, samples: trailSamples })
        .map(f => positionAlongRoute(route, f))
        .filter(Boolean)

    const remove = (entry) => {
      for (const seg of entry.segments) seg.remove()
      entry.pulse?.remove()
      entry.dot.remove()
    }
    const draw = (key, p) => {
      let entry = layers.get(key)
      if (entry && entry.kind !== p.kind) { remove(entry); entry = null }
      if (!entry) {
        const ll = [p.lat, p.lng]
        entry = { kind: p.kind, segments: [], pulse: null, dot: null }
        if (p.kind === 'auto') {
          entry.dot = L.circleMarker(ll, { radius: 5, className: 'map-auto-dot', pane: 'playhead', interactive: false, weight: 2.5, fillColor: '#111111' }).addTo(map)
        } else {
          entry.pulse = L.circleMarker(ll, { radius: 13, className: 'map-playhead-pulse', pane: 'playhead', interactive: false, weight: 2 }).addTo(map)
          entry.dot = L.circleMarker(ll, { radius: 7, className: 'map-playhead-dot', pane: 'playhead', interactive: false, weight: 2.5, fillColor: '#ffffff' }).addTo(map)
        }
        layers.set(key, entry)
      }
      const ll = [p.lat, p.lng]
      const { color, fade } = p
      if (p.kind === 'auto') {
        entry.dot.setLatLng(ll).setStyle({ color, fillOpacity: 0.9 * fade, opacity: fade })
      } else {
        entry.pulse.setLatLng(ll).setStyle({ color, fillColor: color, fillOpacity: 0.12 * fade, opacity: fade })
        entry.dot.setLatLng(ll).setStyle({ color, fillOpacity: 0.95 * fade, opacity: fade })
      }
      // Trail: one segment per consecutive pair, brightest at the dot.
      const pts = p.trail
      const n = Math.max(0, pts.length - 1)
      while (entry.segments.length > n) entry.segments.pop().remove()
      for (let i = 0; i < n; i++) {
        const t = (i + 1) / n
        const latlngs = [[pts[i].lat, pts[i].lng], [pts[i + 1].lat, pts[i + 1].lng]]
        const style = { color, weight: 1.5 + t * 4, opacity: fade * t * t * 0.85 }
        let seg = entry.segments[i]
        if (!seg) {
          seg = L.polyline(latlngs, { ...style, renderer: trailRenderer, pane: 'trails', interactive: false, lineCap: 'round' }).addTo(map)
          entry.segments[i] = seg
        } else {
          seg.setLatLngs(latlngs).setStyle(style)
        }
      }
    }

    let last = 0
    const unsubscribe = subscribePlayhead((now) => {
      if (now - last < PLAYHEAD_FRAME_MS) return
      last = now
      // Each lane's Part loops its own region at its own speed (polyrhythm), so
      // every dot gets its own phase — see lib/mapPlayhead.js. Measured in beats
      // because Parts loop in ticks.
      const transport = Tone.getTransport()
      const beats = transport.ticks / (transport.PPQ || 192)
      const seen = new Set()
      for (const route of routes) {
        if (route.isDuplicate) continue
        if (!activeRef.current.has(route.id)) continue
        const timing = { beats, speed: speedsRef.current?.[route.id] ?? 1, region: regionsRef.current?.[route.id] }
        const { frac, phase } = lanePlayhead(timing)
        const pos = positionAlongRoute(route, frac)
        if (!pos) continue
        seen.add(route.id)
        draw(route.id, { ...pos, fade: wrapFade(phase), color: route.color, kind: 'note', trail: trailOf(route, timing) })
      }
      // Automation lanes read their source line at the lane's own speed and
      // sub-loop (falling back to the source's region), like the engine does.
      for (const link of automationRef.current.links) {
        const dest = routeById.get(link.destId) ?? routeById.get(link.destId.split('~dup~')[0])
        if (dest && !isRouteActive(dest, disabledRef.current, soloRef.current)) continue
        const timing = { beats, speed: link.cfg.speed ?? 1, region: link.cfg.loopRegion ?? regionsRef.current?.[link.src.id] }
        const { frac, phase } = lanePlayhead(timing)
        const pos = positionAlongRoute(link.src, frac)
        if (!pos) continue
        const key = `auto:${link.key}`
        seen.add(key)
        draw(key, { ...pos, fade: wrapFade(phase), color: AUTOMATION_COLOR, kind: 'auto', trail: trailOf(link.src, timing) })
      }
      for (const [key, entry] of layers) {
        if (!seen.has(key)) { remove(entry); layers.delete(key) }
      }
    })
    return () => {
      unsubscribe()
      for (const entry of layers.values()) remove(entry)
      layers.clear()
      trailRenderer.remove()
    }
  }, [map, enabled, routes, trailSamples, activeRef, disabledRef, soloRef, speedsRef, regionsRef, automationRef])
  return null
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
