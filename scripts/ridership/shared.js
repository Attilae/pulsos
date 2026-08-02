import { createReadStream, existsSync } from 'fs'
import { createInterface } from 'readline'
import { canonicalStopId } from '../lib/stopSignals.js'

function delimiterOf(line) {
  const counts = { ',': 0, ';': 0, '\t': 0 }
  let quoted = false
  for (const ch of line) {
    if (ch === '"') quoted = !quoted
    else if (!quoted && ch in counts) counts[ch]++
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
}

function parseRow(line, delimiter) {
  const out = []
  let current = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { current += '"'; i++ }
      else quoted = !quoted
    } else if (ch === delimiter && !quoted) {
      out.push(current)
      current = ''
    } else current += ch
  }
  out.push(current)
  return out
}

export async function readTable(file, onRow) {
  if (!existsSync(file)) return 0
  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity })
  let headers = null
  let delimiter = ','
  let count = 0
  for await (const raw of rl) {
    const line = raw.replace(/^\uFEFF/, '').trimEnd()
    if (!line) continue
    if (!headers) {
      delimiter = delimiterOf(line)
      headers = parseRow(line, delimiter).map(h => h.trim())
      continue
    }
    const values = parseRow(line, delimiter)
    const row = Object.fromEntries(headers.map((h, i) => [h, values[i] ?? '']))
    onRow(row)
    count++
  }
  return count
}

export function keyOf(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '')
}

export function field(row, ...aliases) {
  const wanted = new Set(aliases.map(keyOf))
  for (const [key, value] of Object.entries(row ?? {})) if (wanted.has(keyOf(key))) return value
  return undefined
}

export function numberOf(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  let s = String(value ?? '').trim().replace(/[\s']/g, '')
  if (!s) return null
  if (s.includes(',') && !s.includes('.')) s = s.replace(',', '.')
  else s = s.replace(/,/g, '')
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

export function normalizeName(value) {
  return String(value ?? '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function haversineM(a, b) {
  const toRad = d => d * Math.PI / 180
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 6371000 * 2 * Math.asin(Math.sqrt(x))
}

export function createStopMatcher(stopMeta) {
  const byName = new Map()
  const canonical = new Map()
  for (const [rawId, raw] of Object.entries(stopMeta)) {
    const id = canonicalStopId(rawId, stopMeta)
    const parent = stopMeta[id] ?? raw
    const item = canonical.get(id) ?? {
      id,
      name: parent.name ?? raw.name,
      lat: Number.isFinite(parent.lat) ? parent.lat : raw.lat,
      lon: Number.isFinite(parent.lon) ? parent.lon : raw.lon,
    }
    canonical.set(id, item)
    for (const name of [raw.name, parent.name]) {
      const key = normalizeName(name)
      if (!key) continue
      if (!byName.has(key)) byName.set(key, new Set())
      byName.get(key).add(id)
    }
  }

  function nearest(ids, lat, lon) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return ids.length === 1 ? ids[0] : null
    let best = null
    let bestM = Infinity
    for (const id of ids) {
      const stop = canonical.get(id)
      if (!Number.isFinite(stop?.lat) || !Number.isFinite(stop?.lon)) continue
      const metres = haversineM({ lat, lon }, stop)
      if (metres < bestM) { best = id; bestM = metres }
    }
    return bestM <= 250 ? best : null
  }

  return ({ id, name, lat, lon }) => {
    const rawId = String(id ?? '').trim()
    if (rawId && stopMeta[rawId]) return canonicalStopId(rawId, stopMeta)
    const named = [...(byName.get(normalizeName(name)) ?? [])]
    const namedMatch = nearest(named, lat, lon)
    if (namedMatch) return namedMatch
    return nearest([...canonical.keys()], lat, lon)
  }
}

export function addRidership(out, stopId, value, detail = {}) {
  if (!stopId || !Number.isFinite(value) || value < 0) return false
  const current = out.get(stopId) ?? { ridership: 0, boardings: 0, alightings: 0, records: 0 }
  current.ridership += value
  current.boardings += Number.isFinite(detail.boardings) ? detail.boardings : 0
  current.alightings += Number.isFinite(detail.alightings) ? detail.alightings : 0
  current.records++
  out.set(stopId, current)
  return true
}

export function genericRecord(row) {
  const boardings = numberOf(field(row, 'boardings', 'boarding', 'entries', 'einsteiger', 'nousut', 'nousijamaarat'))
  const alightings = numberOf(field(row, 'alightings', 'alighting', 'exits', 'aussteiger'))
  const explicit = numberOf(field(row, 'ridership', 'passengers', 'passenger_count', 'matkustajat', 'nousijamaar'))
  const value = explicit ?? ((boardings ?? 0) + (alightings ?? 0))
  return {
    id: field(row, 'stop_id', 'stopid', 'gtfs_stop_id', 'station_complex_id', 'haltestellen_id'),
    name: field(row, 'stop_name', 'station_complex', 'station_name', 'name', 'haltestellenlangname', 'nimi'),
    lat: numberOf(field(row, 'lat', 'latitude', 'stop_lat', 'y')),
    lon: numberOf(field(row, 'lon', 'lng', 'longitude', 'stop_lon', 'x')),
    boardings,
    alightings,
    value,
  }
}
