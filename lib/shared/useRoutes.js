import { useEffect, useState } from 'react'

// The ~22 MB route/stop/polyline file. In production it's served from Vercel
// Blob (set NEXT_PUBLIC_LINES_URL); locally it falls back to /data/lines.json
// in public/. Upload with `npm run upload:lines`.
const LINES_URL = process.env.NEXT_PUBLIC_LINES_URL || '/data/lines.json'

let cachedRoutes = null
let inflight = null

export function useRoutes() {
  const [routes, setRoutes] = useState(cachedRoutes)

  useEffect(() => {
    if (cachedRoutes) return
    if (!inflight) {
      inflight = fetch(LINES_URL)
        .then(r => r.json())
        .then(d => { cachedRoutes = d.routes; return d.routes })
    }
    inflight.then(r => setRoutes(r))
  }, [])

  return routes
}
