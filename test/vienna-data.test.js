import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { getCity } from '../feed/cities/index.js'
import { getCityEntry } from '../lib/shared/cities.js'
import { getRouteIndex, searchRoutes } from '../lib/server/routeIndex.js'

const load = suffix => JSON.parse(readFileSync(new URL(`../public/data/lines.vienna${suffix}.json`, import.meta.url)))
const full = load('')
const slim = load('.slim')

test('Vienna full, slim and composer data agree on identity, musical stops and attribution', async () => {
  assert.equal(getCityEntry('vienna').id, 'vienna')
  assert.equal(getCityEntry('vienna').liveWsUrl, null)
  assert.deepEqual(getCity('vienna').feeds, [])
  assert.equal(full.city.timezone, 'Europe/Vienna')
  assert.deepEqual(slim.city, full.city)
  assert.match(full.city.attribution.text, /Wiener Linien/)
  const index = await getRouteIndex('vienna')
  assert.deepEqual(index.map(r => r.id), full.routes.map(r => r.id))
  assert.deepEqual(slim.routes.map(r => r.id), full.routes.map(r => r.id))
  assert.equal(new Set(index.map(r => r.id)).size, index.length)
  for (const [i, route] of full.routes.entries()) {
    assert.deepEqual(slim.routes[i].stops, route.stops)
    assert.equal(index[i].stopCount, route.stops.length)
    assert.ok(route.stops.length > 1, route.id)
    assert.ok(route.polylines.some(p => p.coords.length > 1), route.id)
    assert.ok(getCity('vienna').mapLineTypes.includes(route.type), route.id)
    for (const stop of route.stops) {
      assert.ok(Number.isFinite(stop.lat) && Number.isFinite(stop.lon), route.id)
      assert.ok(stop.signals?.demand >= 0 && stop.signals.demand <= 1, route.id)
    }
  }
})

test('Vienna exposes one of each metro line and preserves WLB as its own logical line', async () => {
  assert.deepEqual(full.routes.filter(r => r.type === 'metro').map(r => r.name).sort(), ['U1', 'U2', 'U3', 'U4', 'U6'])
  const u1 = await searchRoutes('vienna', { query: 'U1', type: 'metro' })
  assert.equal(u1.total, 1)
  assert.equal(u1.routes[0].id, 'vienna:04:1:U1')
  assert.ok(full.routes.find(r => r.name === 'U1').sourceRouteIds.length > 1)
  const wlb = full.routes.filter(r => r.name === 'BB')
  assert.equal(wlb.length, 1)
  assert.equal(wlb[0].id, 'vienna:03:0:BB')
  assert.equal(wlb[0].type, 'tram')
})
