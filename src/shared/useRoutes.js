import { useEffect, useState } from 'react'

let cachedRoutes = null
let inflight = null

export function useRoutes() {
  const [routes, setRoutes] = useState(cachedRoutes)

  useEffect(() => {
    if (cachedRoutes) return
    if (!inflight) {
      inflight = fetch('/data/lines.json')
        .then(r => r.json())
        .then(d => { cachedRoutes = d.routes; return d.routes })
    }
    inflight.then(r => setRoutes(r))
  }, [])

  return routes
}
