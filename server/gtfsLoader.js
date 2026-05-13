import AdmZip from 'adm-zip'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CACHE_DIR = join(__dirname, 'cache')
const CACHE_FILE = join(CACHE_DIR, 'gtfs_lookup.json')
const GTFS_URL = 'https://go.bkk.hu/api/static/v1/public-gtfs/budapest_gtfs.zip'

// GTFS route_type → DAW instrument type
function routeTypeToLineType(routeType) {
  switch (Number(routeType)) {
    case 0:   return 'tram'   // Tram / villamosok
    case 1:   return 'metro'  // Subway
    case 2:   return 'hev'    // Rail (MÁV)
    case 3:   return 'bus'    // Bus
    case 109: return 'hev'    // Suburban rail (HÉV)
    case 800: return 'tram'   // Trolleybus
    default:  return 'bus'
  }
}

function parseCSV(text) {
  const lines = text.trim().split('\n')
  const rawHeaders = lines[0]
  // strip BOM and whitespace from headers
  const headers = rawHeaders.split(',').map(h => h.trim().replace(/^﻿/, '').replace(/\r$/, ''))
  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue
    const values = []
    let cur = ''
    let inQ = false
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ }
      else if (ch === ',' && !inQ) { values.push(cur.trim().replace(/\r$/, '')); cur = '' }
      else { cur += ch }
    }
    values.push(cur.trim().replace(/\r$/, ''))
    const row = {}
    headers.forEach((h, idx) => { row[h] = values[idx] ?? '' })
    rows.push(row)
  }
  return rows
}

export async function loadGtfs() {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true })

  if (existsSync(CACHE_FILE)) {
    console.log('[gtfs] Using cached lookup')
    return JSON.parse(readFileSync(CACHE_FILE, 'utf-8'))
  }

  console.log('[gtfs] Downloading budapest_gtfs.zip …')
  const res = await fetch(GTFS_URL)
  if (!res.ok) throw new Error(`GTFS download failed: ${res.status} ${res.statusText}`)

  const buffer = Buffer.from(await res.arrayBuffer())
  const zip = new AdmZip(buffer)

  const stops  = parseCSV(zip.readAsText('stops.txt'))
  const routes = parseCSV(zip.readAsText('routes.txt'))

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
  for (const r of routes) {
    routeMap[r.route_id] = {
      id:        r.route_id,
      shortName: r.route_short_name,
      type:      Number(r.route_type),
      lineType:  routeTypeToLineType(r.route_type),
      color:     r.route_color ? `#${r.route_color}` : null,
    }
  }

  const lookup = { stops: stopMap, routes: routeMap }
  writeFileSync(CACHE_FILE, JSON.stringify(lookup))
  console.log(`[gtfs] Cached ${Object.keys(stopMap).length} stops, ${Object.keys(routeMap).length} routes`)

  return lookup
}
