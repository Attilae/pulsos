import { useEffect, useState } from 'react'
import { useCitySelection } from './CityContext.jsx'
import { getCityEntry, DEFAULT_CITY_ID } from './cities.js'

// The ~22 MB route/stop/polyline file per city. In production it's served from
// Vercel Blob (set NEXT_PUBLIC_LINES_URL[_<CITY>]); locally it falls back to
// /data/lines.<city>.json in public/. Upload with `npm run upload:lines`.
//
// Back-compat: the default city's URL, for any caller importing LINES_URL.
export const LINES_URL = getCityEntry(DEFAULT_CITY_ID).linesUrl

// Per-URL cache so switching cities at runtime is cheap and de-duplicated.
const cache = new Map()  // url → { routes, city, inflight }

export function fetchLines(url) {
  let entry = cache.get(url)
  if (entry?.routes) return Promise.resolve(entry)
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
        return entry
      })
      .catch(err => {
        cache.delete(url)  // allow retry on next mount
        throw err
      })
  }
  return entry.inflight
}

// Routes for the active city. Returns null until loaded.
export function useRoutes() {
  const { cityEntry } = useCitySelection()
  const url = cityEntry.linesUrl
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
  const url = cityEntry.linesUrl
  const [city, setCity] = useState(() => cache.get(url)?.city ?? null)

  useEffect(() => {
    let cancelled = false
    setCity(cache.get(url)?.city ?? null)
    fetchLines(url).then(e => { if (!cancelled) setCity(e.city) }).catch(() => {})
    return () => { cancelled = true }
  }, [url])

  return city
}
