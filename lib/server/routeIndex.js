// Per-city route lookup for the MCP composition tools. Reads the committed,
// generated indexes in ./routeIndex/ (scripts/build_route_index.js), never the
// multi-megabyte lines.<city>.json files. Each city loads lazily, on first use;
// the import map below is static so the bundler includes every index.

const LOADERS = {
  budapest: () => import('./routeIndex/budapest.js'),
  helsinki: () => import('./routeIndex/helsinki.js'),
  berlin: () => import('./routeIndex/berlin.js'),
  prague: () => import('./routeIndex/prague.js'),
  newyork: () => import('./routeIndex/newyork.js'),
  zurich: () => import('./routeIndex/zurich.js'),
  warsaw: () => import('./routeIndex/warsaw.js'),
}

export const ROUTE_TYPES = ['metro', 'tram', 'trolley', 'bus', 'hev']

const cache = new Map()

/** The city's full route list, or null for a city with no index. */
export async function getRouteIndex(cityId) {
  const load = LOADERS[cityId]
  if (!load) return null
  if (!cache.has(cityId)) cache.set(cityId, load().then(mod => mod.default))
  return cache.get(cityId)
}

// Case- and accent-insensitive, so "Moricz" finds "Móricz Zsigmond körtér".
const fold = (text) => String(text ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/**
 * Filter a city's routes. With a query, exact name matches rank first, then
 * name prefixes, then any name/terminus/id substring; otherwise the index's own
 * order (the GTFS sort order) is kept.
 * @returns {Promise<{ routes: object[], total: number } | null>} null for an unknown city
 */
export async function searchRoutes(cityId, { type = null, query = null, limit = 50 } = {}) {
  const all = await getRouteIndex(cityId)
  if (!all) return null
  let rows = type ? all.filter(route => route.type === type) : all
  const q = fold(query).trim()
  if (q) {
    const rank = (route) => {
      const name = fold(route.name)
      if (name === q) return 0
      if (name.startsWith(q)) return 1
      if (name.includes(q) || fold(route.desc).includes(q) || fold(route.id) === q) return 2
      return -1
    }
    rows = rows
      .map((route, index) => ({ route, index, score: rank(route) }))
      .filter(row => row.score >= 0)
      .sort((a, b) => a.score - b.score || a.index - b.index)
      .map(row => row.route)
  }
  return { routes: rows.slice(0, limit), total: rows.length }
}

/** How many lines of each type a city has — a cheap overview for the composer guide. */
export async function routeTypeCounts(cityId) {
  const all = await getRouteIndex(cityId)
  if (!all) return null
  const counts = {}
  for (const route of all) counts[route.type] = (counts[route.type] ?? 0) + 1
  return counts
}
