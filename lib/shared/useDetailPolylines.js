import { useEffect, useState } from 'react'
import { linesUrlFor } from './cities.js'

// Full-resolution map geometry for the desktop map.
//
// The app loads every city's *slim* route file (useRoutes.js): identical stops,
// so identical music, with Douglas–Peucker-thinned polylines. Only the map
// needs the detailed lines, and only once it's opened, so MapView asks for
// them here. Just the polylines are kept (route id → polylines); the rest of the
// full file is dropped after parsing, and only the latest city is cached.

let cached = null   // { url, promise }

function fetchDetail(url) {
  if (cached?.url === url) return cached.promise
  const promise = fetch(url)
    .then(r => {
      if (!r.ok) throw new Error(`lines fetch ${r.status} for ${url}`)
      return r.json()
    })
    .then(d => new Map((d.routes ?? []).map(r => [r.id, r.polylines])))
  promise.catch(() => { if (cached?.promise === promise) cached = null })
  cached = { url, promise }
  return promise
}

// Map of route id → full polylines for `cityEntry`, or null until loaded (and
// always null when disabled, or when the city has no separate slim build).
export function useDetailPolylines(cityEntry, enabled = true) {
  const full = linesUrlFor(cityEntry, { slim: false })
  const slim = linesUrlFor(cityEntry, { slim: true })
  const url = enabled && full && full !== slim ? full : null
  const [detail, setDetail] = useState(null)

  useEffect(() => {
    setDetail(null)
    if (!url) return undefined
    let cancelled = false
    fetchDetail(url).then(m => { if (!cancelled) setDetail(m) }, () => {})
    return () => { cancelled = true }
  }, [url])

  return detail
}
