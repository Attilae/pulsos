import { existsSync } from 'fs'
import { join } from 'path'
import { addRidership, createStopMatcher, field, genericRecord, readTable } from './shared.js'

// Native VBZ export adapter. HALTESTELLEN.csv maps the internal stop id used by
// REISENDE.csv to a name; the Zürich GTFS uses Swiss SLOIDs, so the final join is
// by normalized stop name (and coordinates when a generic file supplies them).
export async function loadZurichRidership(dir, stopMeta) {
  const matcher = createStopMatcher(stopMeta)
  const out = new Map()
  const names = new Map()
  let rows = 0
  const stopsFile = join(dir, 'HALTESTELLEN.csv')
  if (existsSync(stopsFile)) {
    await readTable(stopsFile, row => {
      const id = field(row, 'Haltestellen_Id', 'Haltestellennummer')
      const name = field(row, 'Haltestellenlangname', 'Haltestellenkurzname')
      if (id && name) names.set(String(id), name)
    })
  }

  const journeys = join(dir, 'REISENDE.csv')
  if (existsSync(journeys)) {
    rows += await readTable(journeys, row => {
      const record = genericRecord(row)
      record.name = record.name ?? names.get(String(record.id ?? ''))
      const stopId = matcher(record)
      addRidership(out, stopId, record.value, record)
    })
  }

  const generic = join(dir, 'ridership.csv')
  if (existsSync(generic)) {
    rows += await readTable(generic, row => {
      const record = genericRecord(row)
      const stopId = matcher(record)
      addRidership(out, stopId, record.value, record)
    })
  }
  return { values: out, rows, source: 'VBZ' }
}
