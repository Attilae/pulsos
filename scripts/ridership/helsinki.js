import { existsSync, readFileSync, readdirSync } from 'fs'
import { extname, join } from 'path'
import { addRidership, createStopMatcher, genericRecord, readTable } from './shared.js'

// HRI publishes the regional 2016 layer as CSV/GeoJSON and newer Espoo data as
// GIS files. Exporting a GPKG layer to GeoJSON preserves its properties and lets
// this adapter stay dependency-free.
export async function loadHelsinkiRidership(dir, stopMeta) {
  const matcher = createStopMatcher(stopMeta)
  const out = new Map()
  let rows = 0
  for (const name of readdirSync(dir)) {
    const file = join(dir, name)
    const ext = extname(name).toLowerCase()
    if (ext === '.csv') {
      rows += await readTable(file, row => {
        const record = genericRecord(row)
        const stopId = matcher(record)
        addRidership(out, stopId, record.value, record)
      })
    } else if (ext === '.geojson' || ext === '.json') {
      if (!existsSync(file)) continue
      const json = JSON.parse(readFileSync(file, 'utf8'))
      for (const feature of json.features ?? []) {
        const coordinates = feature.geometry?.type === 'Point' ? feature.geometry.coordinates : []
        const record = genericRecord({
          ...feature.properties,
          longitude: coordinates[0],
          latitude: coordinates[1],
        })
        const stopId = matcher(record)
        if (addRidership(out, stopId, record.value, record)) rows++
      }
    }
  }
  return { values: out, rows, source: 'HSL/HRI' }
}
