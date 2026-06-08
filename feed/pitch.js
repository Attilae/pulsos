// Geographic latitude → pentatonic note, for naming live arrival notes.
//
// The lat→note window is per-city: callers pass the active city's bounds
// (see feed/cities/*). Falls back to Budapest's range if none is supplied.
//
// ⚠️ Kept in sync with the copy in `lib/mockData.js` (the frontend's mock-lane
// display). This service is deployed standalone, so it can't import from lib/.
// If you change the mapping here, change it there too.

const PENTATONIC = ['C', 'D', 'E', 'G', 'A']
const DEFAULT_BOUNDS = { latMin: 47.35, latMax: 47.70 }  // Budapest

export function latToNote(lat, bounds = DEFAULT_BOUNDS) {
  const MIN_LAT = bounds?.latMin ?? DEFAULT_BOUNDS.latMin
  const MAX_LAT = bounds?.latMax ?? DEFAULT_BOUNDS.latMax
  const OCTAVES = [3, 4, 5]
  const total = PENTATONIC.length * OCTAVES.length
  const t     = Math.max(0, Math.min(1, (lat - MIN_LAT) / (MAX_LAT - MIN_LAT)))
  const step  = Math.round(t * (total - 1))
  return `${PENTATONIC[step % PENTATONIC.length]}${OCTAVES[Math.floor(step / PENTATONIC.length)]}`
}
