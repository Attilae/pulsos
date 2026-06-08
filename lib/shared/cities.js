// Browser-safe city registry for the runtime city picker.
//
// Unlike feed/cities/* (which holds RT endpoints, auth, and is server-only),
// this only exposes what the frontend needs: a display name, the route-data URL
// (lines.<id>.json), and an optional live-feed WebSocket URL. A null liveWsUrl
// means that city is mock-only (no feed running), which disables the Live toggle.
//
// URLs resolve from NEXT_PUBLIC_* env so production Blob/feed URLs work; Budapest
// keeps the original env vars so existing deployments are unchanged.

export const CITIES = [
  {
    id:        'budapest',
    name:      'Budapest',
    linesUrl:  process.env.NEXT_PUBLIC_LINES_URL            || '/data/lines.json',
    // Live mode temporarily disabled for all cities (mock-only). To restore
    // Budapest live, change this back to:
    //   process.env.NEXT_PUBLIC_FEED_WS_URL || 'ws://localhost:3005'
    liveWsUrl: null,  // null → mock only
  },
  {
    id:        'helsinki',
    name:      'Helsinki',
    linesUrl:  process.env.NEXT_PUBLIC_LINES_URL_HELSINKI   || '/data/lines.helsinki.json',
    // Live mode temporarily disabled. To enable, change back to:
    //   process.env.NEXT_PUBLIC_FEED_WS_URL_HELSINKI || null
    liveWsUrl: null,  // null → mock only
  },
  {
    id:        'berlin',
    name:      'Berlin',
    linesUrl:  process.env.NEXT_PUBLIC_LINES_URL_BERLIN     || '/data/lines.berlin.json',
    // Mock-only for now. To enable Live, run a feed with CITY=berlin and set:
    //   process.env.NEXT_PUBLIC_FEED_WS_URL_BERLIN || null
    liveWsUrl: null,  // null → mock only
  },
]

export const DEFAULT_CITY_ID = process.env.NEXT_PUBLIC_DEFAULT_CITY || 'budapest'

export function getCityEntry(id) {
  return CITIES.find(c => c.id === id) ?? CITIES[0]
}
