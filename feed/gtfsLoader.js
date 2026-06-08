import AdmZip from 'adm-zip'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { routeTypeToLineType } from './routeTypes.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CACHE_DIR = join(__dirname, 'cache')
const CACHE_VERSION = 3  // bump when lookup schema changes

// Split one CSV line into fields, honoring double-quoted fields (so commas and
// surrounding quotes inside a quoted field are handled). Used for both the
// header row and data rows — some agencies (e.g. VBB) quote their headers too.
function splitCSVLine(line) {
  const values = []
  let cur = ''
  let inQ = false
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ }
    else if (ch === ',' && !inQ) { values.push(cur.trim().replace(/\r$/, '')); cur = '' }
    else { cur += ch }
  }
  values.push(cur.trim().replace(/\r$/, ''))
  return values
}

function parseCSV(text) {
  const lines = text.trim().split('\n')
  // strip BOM from the first header, then quote-aware split (handles quoted headers)
  const headers = splitCSVLine(lines[0].replace(/^﻿/, ''))
  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue
    const values = splitCSVLine(line)
    const row = {}
    headers.forEach((h, idx) => { row[h] = values[idx] ?? '' })
    rows.push(row)
  }
  return rows
}

// Build the stop/route/trip lookup for a given city descriptor (feed/cities/*).
export async function loadGtfs(cfg) {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true })

  const cacheFile = join(CACHE_DIR, `gtfs_lookup_${cfg.id}.json`)
  const inferModes = new Set(cfg.modesWithoutVehiclePositions ?? [])

  if (existsSync(cacheFile)) {
    const cached = JSON.parse(readFileSync(cacheFile, 'utf-8'))
    if (cached._version === CACHE_VERSION) {
      console.log(`[gtfs] Using cached lookup (${cfg.id})`)
      return cached
    }
    console.log('[gtfs] Cache version mismatch — rebuilding')
  }

  console.log(`[gtfs] Downloading static GTFS for ${cfg.name} …`)
  const res = await fetch(cfg.staticGtfsUrl)
  if (!res.ok) throw new Error(`GTFS download failed: ${res.status} ${res.statusText}`)

  const buffer = Buffer.from(await res.arrayBuffer())
  const zip = new AdmZip(buffer)

  const stops  = parseCSV(zip.readAsText('stops.txt'))
  const routes = parseCSV(zip.readAsText('routes.txt'))
  const trips  = parseCSV(zip.readAsText('trips.txt'))

  const stopMap = {}
  for (const s of stops) {
    stopMap[s.stop_id] = {
      id:   s.stop_id,
      name: s.stop_name,
      lat:  parseFloat(s.stop_lat),
      lng:  parseFloat(s.stop_lon),
    }
  }

  const routeMap = {}
  // Route IDs whose lineType needs TripUpdate position inference (e.g. metro).
  const inferRouteIds = new Set()
  for (const r of routes) {
    const lineType = routeTypeToLineType(r.route_type, cfg.routeTypeOverrides)
    routeMap[r.route_id] = {
      id:        r.route_id,
      shortName: r.route_short_name,
      type:      Number(r.route_type),
      lineType,
      color:     r.route_color ? `#${r.route_color}` : null,
    }
    if (inferModes.has(lineType)) inferRouteIds.add(r.route_id)
  }

  // Only store trip→route mapping for inference-mode trips (keeps cache lean).
  const tripRoutes = {}
  for (const t of trips) {
    if (inferRouteIds.has(t.route_id)) {
      tripRoutes[t.trip_id] = t.route_id
    }
  }

  const lookup = { _version: CACHE_VERSION, city: cfg.id, stops: stopMap, routes: routeMap, tripRoutes }
  writeFileSync(cacheFile, JSON.stringify(lookup))
  console.log(`[gtfs] Cached ${Object.keys(stopMap).length} stops, ${Object.keys(routeMap).length} routes, ${Object.keys(tripRoutes).length} inference trips`)

  return lookup
}
