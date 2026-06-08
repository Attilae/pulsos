#!/usr/bin/env node
/**
 * Reads a city's raw GTFS files and outputs public/data/lines.<city>.json
 * containing the mapped routes with polyline coords, stop positions, and a
 * `city` metadata block (bounds/center/attribution derived from the GTFS).
 *
 * Run: npm run preprocess -- --city <id> [--gtfs <dir>]
 *   e.g. npm run preprocess:budapest
 *        npm run preprocess:helsinki
 *
 * Defaults: --city budapest, --gtfs data/<city>_gtfs.
 */

import { createReadStream, mkdirSync, writeFileSync } from 'fs'
import { createInterface } from 'readline'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { routeTypeToLineType } from '../lib/routeTypes.js'
import { hashStringToInt, mulberry32 } from '../lib/mappings.js'
import { getCity } from '../feed/cities/index.js'

const __dir = dirname(fileURLToPath(import.meta.url))

// Great-circle distance (metres) between two lat/lon points. Used as a fallback
// for stop spacing when a feed omits shape_dist_traveled (e.g. VBB/Berlin).
function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000
  const toRad = d => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

// ── Args ──────────────────────────────────────────────────────────────────────
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const CITY    = arg('city', 'budapest')
const GTFS    = join(__dir, '..', arg('gtfs', `data/${CITY}_gtfs`))
const OUT     = join(__dir, `../public/data/lines.${CITY}.json`)
// The default dev path (lib/shared/useRoutes.js) is /data/lines.json — mirror to
// it for the primary city so local dev works without setting an env var.
const MIRROR  = CITY === 'budapest' ? join(__dir, '../public/data/lines.json') : null

let cityCfg = {}
try { cityCfg = getCity(CITY) } catch { console.warn(`[preprocess] no feed descriptor for "${CITY}" — metadata will be minimal`) }

// Line types to include in the map. Per-city override via descriptor.mapLineTypes
// (Budapest historically excludes HÉV); default = all five engine voices.
const INCLUDE = new Set(cityCfg.mapLineTypes ?? ['tram', 'metro', 'trolley', 'bus', 'hev'])

// ── CSV streaming helper ──────────────────────────────────────────────────────

async function readCsv(file, filterFn, mapFn) {
  const results = []
  const rl = createInterface({ input: createReadStream(join(GTFS, file)), crlfDelay: Infinity })
  let headers = null
  for await (const raw of rl) {
    const line = raw.replace(/^﻿/, '').trimEnd()
    if (!line) continue
    if (!headers) { headers = parseRow(line); continue }
    const row = Object.fromEntries(headers.map((h, i) => [h, parseRow(line)[i] ?? '']))
    if (!filterFn || filterFn(row)) results.push(mapFn ? mapFn(row) : row)
  }
  return results
}

function parseRow(line) {
  const cols = []
  let cur = '', inQ = false
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ }
    else if (ch === ',' && !inQ) { cols.push(cur); cur = '' }
    else cur += ch
  }
  cols.push(cur)
  return cols
}

// ── 1. Routes — mapped via the shared route_type resolver ────────────────────

// Some agencies (e.g. HSL/Helsinki) ship no route_color/route_text_color at all.
// When that happens, derive a stable, distinct per-route hue from the route_id so
// each line still gets its own color (instead of an invalid "#undefined").
const isHex6 = (s) => typeof s === 'string' && /^[0-9a-fA-F]{6}$/.test(s)

function hslToHex(h, s, l) {
  s /= 100; l /= 100
  const k = n => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  const to255 = x => Math.round(255 * x).toString(16).padStart(2, '0')
  return `#${to255(f(0))}${to255(f(8))}${to255(f(4))}`
}

// Pick black or white text for legibility on a given hex background (WCAG luminance).
function pickReadableText(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
  const lin = c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  return L > 0.6 ? '#000000' : '#ffffff'
}

function routeColor(r) {
  if (isHex6(r.route_color)) return `#${r.route_color}`
  const hue = Math.floor(mulberry32(hashStringToInt(r.route_id))() * 360)
  return hslToHex(hue, 65, 55)
}

console.log(`Loading routes for ${cityCfg.name ?? CITY} …`)
const routes = await readCsv(
  'routes.txt',
  r => INCLUDE.has(routeTypeToLineType(r.route_type, cityCfg.routeTypeOverrides)),
  r => {
    const color = routeColor(r)
    return {
      id:        r.route_id,
      name:      r.route_short_name,
      type:      routeTypeToLineType(r.route_type, cityCfg.routeTypeOverrides),
      color,
      textColor: isHex6(r.route_text_color) ? `#${r.route_text_color}` : pickReadableText(color),
      desc:      r.route_desc,
      sortOrder: Number(r.route_sort_order),
    }
  }
)
routes.sort((a, b) => a.sortOrder - b.sortOrder)
const routeIds = new Set(routes.map(r => r.id))
const typeCounts = routes.reduce((a, r) => ({ ...a, [r.type]: (a[r.type] ?? 0) + 1 }), {})
console.log(`  ${routes.length} routes`, typeCounts)

// ── 2. Trips — one canonical trip per (route_id, direction_id) ───────────────

console.log('Loading trips…')
const canonicalTrip = {}  // `${routeId}_${dir}` → { tripId, shapeId }
const tripToRoute   = {}  // tripId → routeId (all trips, for stop_times)

await readCsv('trips.txt', r => routeIds.has(r.route_id), r => {
  tripToRoute[r.trip_id] = r.route_id
  const key = `${r.route_id}_${r.direction_id}`
  if (!canonicalTrip[key]) {
    canonicalTrip[key] = { tripId: r.trip_id, shapeId: r.shape_id, dir: Number(r.direction_id) }
  }
  return null
})

const neededTrips  = new Set(Object.values(canonicalTrip).map(t => t.tripId))
const neededShapes = new Set(Object.values(canonicalTrip).map(t => t.shapeId).filter(Boolean))
console.log(`  ${neededTrips.size} canonical trips, ${neededShapes.size} shapes`)

// ── 3. Stop times — only for canonical trips, direction 0 ────────────────────

console.log('Loading stop_times (filtering on-the-fly, this may take a moment)…')
const dir0Trips = new Set(
  Object.values(canonicalTrip).filter(t => t.dir === 0).map(t => t.tripId)
)
const stopsByTrip = {}  // tripId → [{stopId, seq, dist}]

await readCsv('stop_times.txt', r => dir0Trips.has(r.trip_id), r => {
  if (!stopsByTrip[r.trip_id]) stopsByTrip[r.trip_id] = []
  stopsByTrip[r.trip_id].push({
    stopId: r.stop_id,
    seq:    Number(r.stop_sequence),
    dist:   parseFloat(r.shape_dist_traveled) || 0,
  })
  return null
})
for (const arr of Object.values(stopsByTrip)) arr.sort((a, b) => a.seq - b.seq)
console.log(`  ${Object.keys(stopsByTrip).length} trips with stop data`)

// ── 4. Stops lookup — id → {name, lat, lon} ──────────────────────────────────

console.log('Loading stops…')
const stopMeta = {}
await readCsv('stops.txt', null, r => {
  stopMeta[r.stop_id] = { name: r.stop_name, lat: parseFloat(r.stop_lat), lon: parseFloat(r.stop_lon) }
  return null
})
console.log(`  ${Object.keys(stopMeta).length} stops loaded`)

// ── 5. Shapes — only needed shape_ids ────────────────────────────────────────

console.log('Loading shapes (filtering on-the-fly)…')
const shapePts = {}  // shapeId → [{seq, lat, lon}]

await readCsv('shapes.txt', r => neededShapes.has(r.shape_id), r => {
  if (!shapePts[r.shape_id]) shapePts[r.shape_id] = []
  shapePts[r.shape_id].push([
    Number(r.shape_pt_sequence),
    parseFloat(r.shape_pt_lat),
    parseFloat(r.shape_pt_lon),
  ])
  return null
})
for (const arr of Object.values(shapePts)) arr.sort((a, b) => a[0] - b[0])
console.log(`  ${Object.keys(shapePts).length} shapes loaded`)

// ── 6. Assemble output ───────────────────────────────────────────────────────

console.log('Assembling output…')
const output = routes.map(route => {
  // Polylines — one per direction
  const polylines = []
  for (const dir of [0, 1]) {
    const key = `${route.id}_${dir}`
    const trip = canonicalTrip[key]
    if (!trip?.shapeId || !shapePts[trip.shapeId]) continue
    polylines.push({
      direction: dir,
      coords: shapePts[trip.shapeId].map(([, lat, lon]) => [
        Math.round(lat * 1e5) / 1e5,
        Math.round(lon * 1e5) / 1e5,
      ]),
    })
  }

  // Stops — direction 0 only
  const trip0 = canonicalTrip[`${route.id}_0`]
  const rawStops = (trip0 && stopsByTrip[trip0.tripId]) ?? []
  const stops = rawStops
    .map(s => {
      const meta = stopMeta[s.stopId]
      if (!meta) return null
      return { id: s.stopId, name: meta.name, lat: meta.lat, lon: meta.lon, seq: s.seq, dist: s.dist }
    })
    .filter(Boolean)

  // Some feeds (e.g. VBB/Berlin) omit shape_dist_traveled, leaving every dist at
  // 0. Without a usable distance the grid quantizer bunches stops one-per-cell
  // (lines never span the full grid). Fall back to cumulative great-circle
  // distance between stop coordinates so stops are placed by geography instead.
  const hasShapeDist = stops.length > 1 && stops[stops.length - 1].dist > 0
  if (!hasShapeDist && stops.length > 1) {
    let cum = 0
    stops[0].dist = 0
    for (let i = 1; i < stops.length; i++) {
      cum += haversineM(stops[i - 1].lat, stops[i - 1].lon, stops[i].lat, stops[i].lon)
      stops[i].dist = Math.round(cum)
    }
  }

  const totalDist = stops.length ? stops[stops.length - 1].dist : 0

  return { ...route, polylines, stops, totalDist }
})

// ── 6b. City metadata — bbox + center derived from all mapped stops ──────────

const allLats = []
const allLngs = []
for (const r of output) {
  for (const s of r.stops) {
    if (Number.isFinite(s.lat)) allLats.push(s.lat)
    if (Number.isFinite(s.lon)) allLngs.push(s.lon)
  }
}
const bounds = allLats.length ? {
  latMin: Math.min(...allLats), latMax: Math.max(...allLats),
  lngMin: Math.min(...allLngs), lngMax: Math.max(...allLngs),
} : null
const center = bounds
  ? [(bounds.latMin + bounds.latMax) / 2, (bounds.lngMin + bounds.lngMax) / 2]
  : null

const city = {
  id:          CITY,
  name:        cityCfg.name ?? CITY,
  timezone:    cityCfg.timezone ?? null,
  center,
  bounds: bounds ? { ...bounds, centerLng: center[1] } : null,
  attribution: cityCfg.attribution ?? null,
}

// ── 7. Write ──────────────────────────────────────────────────────────────────

mkdirSync(join(__dir, '../public/data'), { recursive: true })
const payload = { generated: new Date().toISOString(), city, routes: output }
writeFileSync(OUT, JSON.stringify(payload, null, 2))
if (MIRROR) writeFileSync(MIRROR, JSON.stringify(payload, null, 2))

const sizeKB = Math.round(JSON.stringify(output).length / 1024)
console.log(`\nDone! → ${OUT}${MIRROR ? ` (mirrored to ${MIRROR})` : ''}`)
console.log(`  ${output.length} routes, ${sizeKB} KB`)
if (bounds) console.log(`  bounds: ${bounds.latMin.toFixed(3)}–${bounds.latMax.toFixed(3)} / ${bounds.lngMin.toFixed(3)}–${bounds.lngMax.toFixed(3)}`)
