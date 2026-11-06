// Pure map-view policy: route styling, what "Fit" frames, and how much of the
// map the overlays cover. Kept out of MapView.jsx so it can be tested without
// Leaflet, React or the DOM.

export const FIT_MAX_ZOOM = 14      // a one-stop or tiny route shouldn't zoom to street level
export const FIT_MARGIN = 16        // px of map kept clear around the framed routes

export function isRouteActive(route, disabled, soloRoutes) {
  if (disabled?.[route.id]) return false
  if (soloRoutes?.size > 0 && !soloRoutes.has(route.id)) return false
  return true
}

// ── Colour contrast ─────────────────────────────────────────────────────────

function parseHex(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex ?? '').trim())
  if (!m) return null
  const h = m[1].length === 3 ? m[1].split('').map(c => c + c).join('') : m[1]
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16))
}

function luminance(rgb) {
  const [r, g, b] = rgb.map(v => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio between two hex colours; null if either is unparseable. */
export function contrastRatio(a, b) {
  const ca = parseHex(a), cb = parseHex(b)
  if (!ca || !cb) return null
  const la = luminance(ca), lb = luminance(cb)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

// Map backgrounds the routes sit on (lib/mapBasemapStyle.js BASEMAP_PALETTE.background).
export const MAP_BACKGROUND = { dark: '#0e0f11', light: '#f7f8fa' }
// Casing: a neutral edge in the *opposite* direction of the background, so a
// dark-blue line on the dark map and a yellow line on the light map both get a
// boundary that separates them from the geography.
export const CASING_COLOR = { dark: '#868d99', light: '#282b30' }
const CASING_MIN_CONTRAST = 3

/**
 * Leaflet path styles for one route. Active lanes get a crisp 3px stroke, plus
 * a 5px neutral casing only when the route colour is under 3:1 against the map
 * background. Off lanes are 1px dashed previews, a little stronger when the
 * whole mix is off so the network stays legible. No coloured glow.
 *
 * `focus` (phase 2, visual only): 'selected' draws the focused lane's line at
 * 4px in full colour with a 6px casing where contrast is low (dashed when the
 * lane is off, so focus never reads as "audible"); 'other' dims the remaining
 * audible lines to 0.5 while a lane is focused. Off previews keep their style.
 */
export function routeLineStyle(route, { active, allOff = false, theme = 'dark', focus = null }) {
  const color = route.color
  const t = theme === 'light' ? 'light' : 'dark'
  const ratio = contrastRatio(color, MAP_BACKGROUND[t])
  const needsCasing = ratio == null || ratio < CASING_MIN_CONTRAST
  const casingOf = weight => ({ color: CASING_COLOR[t], weight, opacity: t === 'light' ? 0.25 : 0.3, lineCap: 'round', lineJoin: 'round' })
  if (focus === 'selected') {
    return {
      line: { color, weight: 4, opacity: 1, dashArray: active ? null : '8 6', lineCap: 'round', lineJoin: 'round' },
      casing: needsCasing ? casingOf(6) : null,
    }
  }
  if (!active) {
    return { line: { color, weight: 1, opacity: allOff ? 0.35 : 0.25, dashArray: '4 6', lineCap: 'butt' }, casing: null }
  }
  const dim = focus === 'other'
  return {
    line: { color, weight: 3, opacity: dim ? 0.5 : 1, dashArray: null, lineCap: 'round', lineJoin: 'round' },
    // Light enough to read as an edge, not as a dark line with a coloured core.
    casing: needsCasing && !dim ? casingOf(5) : null,
  }
}

// ── Framing ─────────────────────────────────────────────────────────────────

/** Lat/lng box over the stops of `routes`, or null when none has a valid stop. */
export function boundsFromRoutes(routes) {
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

/**
 * What "Fit mix" (and the initial city/song framing) frames: the audible
 * routes, else every route on the map (the previews), else the city bounds.
 * Returns { kind: 'audible' | 'previews' | 'city' | 'none', bounds }.
 */
export function fitMixTarget(routes, disabled, soloRoutes, cityBounds) {
  return fitTarget(routes, r => isRouteActive(r, disabled, soloRoutes), cityBounds)
}

/** fitMixTarget with an explicit "is this line audible" predicate (lane-aware callers). */
export function fitTarget(routes, isAudible, cityBounds) {
  const audible = (routes ?? []).filter(isAudible)
  const a = boundsFromRoutes(audible)
  if (a) return { kind: 'audible', bounds: a }
  const p = boundsFromRoutes(routes)
  if (p) return { kind: 'previews', bounds: p }
  const c = cityBounds
  if (c && [c.latMin, c.latMax, c.lngMin, c.lngMax].every(Number.isFinite)) return { kind: 'city', bounds: c }
  return { kind: 'none', bounds: null }
}

/**
 * Identity of "what is framed": changes when the city or the set of routes on
 * the map changes (a city switch, a song load, Re-pick), and not when lanes are
 * enabled/disabled/soloed, so editing the mix never moves a camera the user has
 * placed.
 */
export function framingKey(cityId, routes) {
  return `${cityId ?? ''}|${(routes ?? []).map(r => r.id).join(',')}`
}

/**
 * Fit padding that keeps framed routes out from under the map's overlays.
 * Rects are {left, top, right, bottom} in viewport px (DOMRect-like); `map` is
 * the map container. Each overlay pads only the side it hugs, and only if it
 * actually overlaps the map. Returns Leaflet's paddingTopLeft/BottomRight.
 */
export function overlayFitPadding(map, { left = [], right = [], top = [], bottom = [] } = {}, margin = FIT_MARGIN) {
  const overlaps = r => r && r.right > map.left && r.left < map.right && r.bottom > map.top && r.top < map.bottom
  const padL = Math.max(0, ...left.filter(overlaps).map(r => r.right - map.left))
  const padR = Math.max(0, ...right.filter(overlaps).map(r => map.right - r.left))
  const padT = Math.max(0, ...top.filter(overlaps).map(r => r.bottom - map.top))
  const padB = Math.max(0, ...bottom.filter(overlaps).map(r => map.bottom - r.top))
  const width = map.right - map.left, height = map.bottom - map.top
  // Never pad away more than half the map: a huge overlay on a small screen
  // should squeeze the frame, not invert it.
  const cap = (v, size) => Math.round(Math.min(v, size / 2))
  return {
    paddingTopLeft: [cap(padL, width) + margin, cap(padT, height) + margin],
    paddingBottomRight: [cap(padR, width) + margin, cap(padB, height) + margin],
  }
}
