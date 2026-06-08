// City registry for the feed service. Select with the CITY env var
// (default: budapest). Each descriptor is the single source of truth for that
// city's GTFS-RT endpoints, auth, route-type quirks, and geographic bounds.

import budapest from './budapest.js'
import helsinki from './helsinki.js'
import berlin from './berlin.js'

const CITIES = { budapest, helsinki, berlin }

export function getCity(id) {
  const city = CITIES[id]
  if (!city) {
    throw new Error(
      `Unknown CITY "${id}". Known cities: ${Object.keys(CITIES).join(', ')}`
    )
  }
  return city
}

export { CITIES }
