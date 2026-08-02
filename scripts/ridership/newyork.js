import { existsSync } from 'fs'
import { join } from 'path'
import { addRidership, createStopMatcher, genericRecord, readTable } from './shared.js'

// Accepts cached Socrata exports:
//   subway.csv — MTA Subway Hourly Ridership (station_complex, ridership, lat/lon)
//   bus.csv    — MTA Bus Stop Level Ridership (stop_id, boardings, alightings)
// The app's current MTA GTFS is subway-only, but bus support is intentionally
// kept here for a future combined feed.
export async function loadNewYorkRidership(dir, stopMeta) {
  const matcher = createStopMatcher(stopMeta)
  const out = new Map()
  const files = ['subway.csv', 'bus.csv', 'ridership.csv']
  let rows = 0
  for (const name of files) {
    const file = join(dir, name)
    if (!existsSync(file)) continue
    rows += await readTable(file, row => {
      const record = genericRecord(row)
      const stopId = matcher(record)
      addRidership(out, stopId, record.value, record)
    })
  }
  return { values: out, rows, source: 'MTA' }
}
