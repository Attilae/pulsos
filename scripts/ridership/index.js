import { existsSync } from 'fs'
import { join } from 'path'
import { loadNewYorkRidership } from './newyork.js'
import { loadZurichRidership } from './zurich.js'
import { loadHelsinkiRidership } from './helsinki.js'

const ADAPTERS = {
  newyork: loadNewYorkRidership,
  zurich: loadZurichRidership,
  helsinki: loadHelsinkiRidership,
}

export async function loadRidership(cityId, dataRoot, stopMeta) {
  const adapter = ADAPTERS[cityId]
  const dir = join(dataRoot, `${cityId}_ridership`)
  if (!adapter || !existsSync(dir)) return { values: new Map(), rows: 0, source: null }
  return adapter(dir, stopMeta)
}
