#!/usr/bin/env node
// Produce a phone-sized copy of a city's route data.
//
//   node scripts/slim_lines.js --city berlin [--tolerance 0.0002]
//
// Some cities are enormous — Berlin is 65 MB, Prague 53 MB. The cost on a
// phone isn't the download (it compresses and caches) but JSON.parse and the
// resulting heap: tens of megabytes of text become hundreds of megabytes of JS
// objects, and mobile WebKit kills the tab well before that leaves room for an
// audio graph and a Leaflet map.
//
// ONLY polyline vertices are thinned. `stops` is copied verbatim, because stop
// coordinates drive geoToMidi / routeBounds / the whole pitch mapping and MIDI
// export — dropping one would change the music. Polylines are consumed solely
// by MapView's <Polyline>, where a few metres of positional error is invisible.
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const city = arg('city')
if (!city) {
  console.error('Usage: node scripts/slim_lines.js --city <id> [--tolerance <degrees>]')
  process.exit(1)
}

// ~0.0002° ≈ 20 m at mid latitudes: below one line-width at city zoom levels.
const TOLERANCE = Number(arg('tolerance', '0.0002'))

// Ramer–Douglas–Peucker. Iterative rather than recursive — a long metro line
// can be tens of thousands of points and blows the call stack.
function simplify(points, tolerance) {
  if (points.length < 3) return points
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  const stack = [[0, points.length - 1]]

  while (stack.length) {
    const [first, last] = stack.pop()
    let maxDist = 0
    let index = 0
    const [x1, y1] = points[first]
    const [x2, y2] = points[last]
    const dx = x2 - x1
    const dy = y2 - y1
    const denom = Math.hypot(dx, dy)

    for (let i = first + 1; i < last; i++) {
      const [x, y] = points[i]
      // Perpendicular distance to the segment; degenerate segments fall back
      // to plain point distance.
      const dist = denom === 0
        ? Math.hypot(x - x1, y - y1)
        : Math.abs(dy * x - dx * y + x2 * y1 - y2 * x1) / denom
      if (dist > maxDist) { maxDist = dist; index = i }
    }

    if (maxDist > tolerance) {
      keep[index] = 1
      stack.push([first, index], [index, last])
    }
  }

  return points.filter((_, i) => keep[i])
}

// Budapest is the default city, so the preprocessor mirrors it to the
// unsuffixed lines.json that lib/shared/cities.js falls back to. Mirror the
// same naming here.
const named = path.join('public', 'data', `lines.${city}.json`)
// The browser's default-city URLs are deliberately unsuffixed. The full
// preprocessor also writes lines.budapest.json for Blob upload, but using that
// file here would leave /data/lines.slim.json stale after every slim:all run.
const src = city === 'budapest'
  ? path.join('public', 'data', 'lines.json')
  : named
if (!fs.existsSync(src)) {
  console.error(`No such file: ${named} — run npm run preprocess:${city} first.`)
  process.exit(1)
}

const raw = fs.readFileSync(src, 'utf8')
const data = JSON.parse(raw)

let before = 0
let after = 0
for (const route of data.routes ?? []) {
  for (const line of route.polylines ?? []) {
    before += line.coords.length
    line.coords = simplify(line.coords, TOLERANCE)
    after += line.coords.length
  }
  // Round what's left: 5 decimal places is ~1 m, and the extra digits are pure
  // payload. Stops are deliberately untouched.
  for (const line of route.polylines ?? []) {
    line.coords = line.coords.map(([lat, lon]) => [
      Math.round(lat * 1e5) / 1e5,
      Math.round(lon * 1e5) / 1e5,
    ])
  }
}

data.slim = { tolerance: TOLERANCE, generated: new Date().toISOString() }

const out = src.replace(/\.json$/, '.slim.json')
fs.writeFileSync(out, JSON.stringify(data))

const mb = n => `${(n / 1024 / 1024).toFixed(1)} MB`
console.log(`${city}: ${before.toLocaleString()} → ${after.toLocaleString()} polyline points`)
console.log(`  ${src}  ${mb(raw.length)}`)
console.log(`  ${out}  ${mb(fs.statSync(out).size)}`)
