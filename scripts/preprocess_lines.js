#!/usr/bin/env node
/**
 * Reads raw Budapest GTFS files and outputs public/data/lines.json
 * containing metro + tram routes with polyline coords and stop positions.
 *
 * Run: npm run preprocess
 */

import { createReadStream, mkdirSync, writeFileSync } from 'fs'
import { createInterface } from 'readline'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir  = dirname(fileURLToPath(import.meta.url))
const GTFS   = join(__dir, '../data/budapest_gtfs')
const OUT    = join(__dir, '../public/data/lines.json')

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

// ── 1. Routes — metro (1) + tram (0) + bus (3) + trolleybus (11) ─────────────

const TYPE_MAP = { '0': 'tram', '1': 'metro', '3': 'bus', '11': 'trolley' }

console.log('Loading routes…')
const routes = await readCsv(
  'routes.txt',
  r => TYPE_MAP[r.route_type] != null,
  r => ({
    id:        r.route_id,
    name:      r.route_short_name,
    type:      TYPE_MAP[r.route_type],
    color:     `#${r.route_color}`,
    textColor: `#${r.route_text_color}`,
    desc:      r.route_desc,
    sortOrder: Number(r.route_sort_order),
  })
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

  const totalDist = stops.length ? stops[stops.length - 1].dist : 0

  return { ...route, polylines, stops, totalDist }
})

// ── 7. Write ──────────────────────────────────────────────────────────────────

mkdirSync(join(__dir, '../public/data'), { recursive: true })
writeFileSync(OUT, JSON.stringify({ generated: new Date().toISOString(), routes: output }, null, 2))

const sizeKB = Math.round(JSON.stringify(output).length / 1024)
console.log(`\nDone! → ${OUT}`)
console.log(`  ${output.length} routes, ${sizeKB} KB`)
