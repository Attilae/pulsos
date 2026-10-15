import { useEffect, useState } from 'react'
import { useCitySelection } from './CityContext.jsx'
import { getCityEntry, linesUrlFor, DEFAULT_CITY_ID } from './cities.js'

// The route/stop/polyline file per city — 2 MB (New York) to 65 MB (Berlin).
// In production it's served from Vercel Blob (set NEXT_PUBLIC_LINES_URL[_<CITY>]);
// locally it falls back to /data/lines.<city>.json in public/. Upload with
// `npm run upload:lines`.
//
// Every device loads the slim build where one exists: same stops (so the same
// music), thinned map polylines. The cost being avoided is JSON.parse and heap,
// not bandwidth — mobile WebKit kills tabs long before a 65 MB parse finishes,
// and on desktop the full file was ~10× the parse time and heap for detail only
// the map draws. The desktop map fetches the full polylines itself when it's
// opened (useDetailPolylines.js).
//
// Back-compat: the default city's URL, for any caller importing LINES_URL.
export const LINES_URL = getCityEntry(DEFAULT_CITY_ID).linesUrl

// Per-URL cache so switching cities at runtime is cheap and de-duplicated.
// Bounded: a full city is 20-65 MiB of heap once parsed, and keeping every city
// visited this session added up to ~200 MiB. The most recently used
// MAX_CACHED_CITIES stay; a component still holding an evicted city's routes
// keeps them alive until it lets go, and a later visit fetches again (usually
// from the HTTP cache).
const MAX_CACHED_CITIES = 2
const cache = new Map()  // url → { routes, city, inflight }, least recently used first

function touch(url, entry) {
  cache.delete(url)
  cache.set(url, entry)
}

function evict() {
  let loaded = 0
  for (const entry of cache.values()) if (entry.routes) loaded++
  for (const [url, entry] of cache) {
    if (loaded <= MAX_CACHED_CITIES) break
    if (!entry.routes) continue          // never drop an in-flight fetch
    cache.delete(url)
    loaded--
  }
}

export function fetchLines(url) {
  let entry = cache.get(url)
  if (entry?.routes) { touch(url, entry); return Promise.resolve(entry) }
  if (!entry) { entry = {}; cache.set(url, entry) }
  if (!entry.inflight) {
    entry.inflight = fetch(url)
      .then(r => {
        if (!r.ok) throw new Error(`lines fetch ${r.status} for ${url}`)
        return r.json()
      })
      .then(d => {
        entry.routes = d.routes
        entry.city = d.city ?? null
        if (cache.get(url) === entry) { touch(url, entry); evict() }
        return entry
      })
      .catch(err => {
        if (cache.get(url) === entry) cache.delete(url)  // allow retry on next mount
        throw err
      })
  }
  return entry.inflight
}

// Routes for the active city. Returns null until loaded.
export function useRoutes() {
  const { cityEntry } = useCitySelection()
  const url = linesUrlFor(cityEntry, { slim: true })
  const [routes, setRoutes] = useState(() => cache.get(url)?.routes ?? null)

  useEffect(() => {
    let cancelled = false
    setRoutes(cache.get(url)?.routes ?? null)
    fetchLines(url).then(e => { if (!cancelled) setRoutes(e.routes) }).catch(() => {})
    return () => { cancelled = true }
  }, [url])

  return routes
}

// The `city` metadata block embedded in lines.json (id/name/timezone/center/
// bounds/attribution) for the active city, or null for legacy files without it.
export function useCity() {
  const { cityEntry } = useCitySelection()
  const url = linesUrlFor(cityEntry, { slim: true })
  const [city, setCity] = useState(() => cache.get(url)?.city ?? null)

  useEffect(() => {
    let cancelled = false
    setCity(cache.get(url)?.city ?? null)
    fetchLines(url).then(e => { if (!cancelled) setCity(e.city) }).catch(() => {})
    return () => { cancelled = true }
  }, [url])

  return city
}
