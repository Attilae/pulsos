import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  contrastRatio, routeLineStyle, fitMixTarget, framingKey, overlayFitPadding, boundsFromRoutes, FIT_MARGIN,
} from '../lib/mapVisualPolicy.js'
import { quietBasemapStyle, BASEMAP_PALETTE } from '../lib/mapBasemapStyle.js'

const route = (id, color, stops) => ({ id, color, stops })
const stop = (lat, lon) => ({ lat, lon })

test('contrastRatio matches WCAG reference values', () => {
  assert.equal(Math.round(contrastRatio('#000000', '#ffffff')), 21)
  assert.equal(contrastRatio('#777', '#777'), 1)
  assert.equal(contrastRatio('not-a-colour', '#fff'), null)
})

test('active routes get a crisp line, and a casing only when contrast is low', () => {
  // Bright yellow: fine on the dark map, too faint on the light one.
  const yellow = route('y', '#f5d300', [])
  assert.equal(routeLineStyle(yellow, { active: true, theme: 'dark' }).casing, null)
  assert.ok(routeLineStyle(yellow, { active: true, theme: 'light' }).casing)
  // Dark navy: the reverse.
  const navy = route('n', '#1f3a68', [])
  assert.ok(routeLineStyle(navy, { active: true, theme: 'dark' }).casing)
  assert.equal(routeLineStyle(navy, { active: true, theme: 'light' }).casing, null)
  const { line } = routeLineStyle(navy, { active: true, theme: 'light' })
  assert.equal(line.weight, 3)
  assert.equal(line.dashArray, null)
  // An unparseable colour falls back to a cased line rather than an invisible one.
  assert.ok(routeLineStyle(route('x', 'red', []), { active: true }).casing)
})

test('off routes are dashed previews, stronger when the whole mix is off', () => {
  const r = route('a', '#3366ff', [])
  const off = routeLineStyle(r, { active: false })
  assert.equal(off.casing, null)
  assert.equal(off.line.weight, 1)
  assert.ok(off.line.dashArray)
  assert.ok(routeLineStyle(r, { active: false, allOff: true }).line.opacity > off.line.opacity)
})

test('fitMixTarget prefers audible routes, then previews, then the city', () => {
  const a = route('a', '#fff', [stop(52.5, 13.3), stop(52.6, 13.4)])
  const b = route('b', '#fff', [stop(52.3, 13.0)])
  const city = { latMin: 52, latMax: 53, lngMin: 12, lngMax: 14 }
  const audible = fitMixTarget([a, b], { b: true }, new Set(), city)
  assert.equal(audible.kind, 'audible')
  assert.deepEqual(audible.bounds, { latMin: 52.5, latMax: 52.6, lngMin: 13.3, lngMax: 13.4 })
  // Solo narrows "audible" the same way the engine does.
  assert.equal(fitMixTarget([a, b], {}, new Set(['b']), city).bounds.latMin, 52.3)
  assert.equal(fitMixTarget([a, b], { a: true, b: true }, new Set(), city).kind, 'previews')
  assert.equal(fitMixTarget([], {}, new Set(), city).kind, 'city')
  assert.equal(fitMixTarget([], {}, new Set(), null).kind, 'none')
  // Routes without usable stops don't count as framable.
  assert.equal(fitMixTarget([route('c', '#fff', [{ lat: NaN, lon: 1 }])], {}, new Set(), city).kind, 'city')
})

test('boundsFromRoutes handles negative longitudes', () => {
  const b = boundsFromRoutes([route('nyc', '#fff', [stop(40.7, -74.0), stop(40.8, -73.9)])])
  assert.deepEqual(b, { latMin: 40.7, latMax: 40.8, lngMin: -74.0, lngMax: -73.9 })
})

test('framingKey ignores lane state and changes with the city or the route list', () => {
  const routes = [route('a'), route('b')]
  const k = framingKey('berlin', routes)
  assert.equal(framingKey('berlin', [route('a'), route('b')]), k)
  assert.notEqual(framingKey('newyork', routes), k)
  assert.notEqual(framingKey('berlin', [route('a'), route('c')]), k)
})

test('overlayFitPadding pads only for overlays that overlap the map', () => {
  const map = { left: 0, top: 100, right: 1000, bottom: 900 }
  const legend = { left: 12, top: 112, right: 204, bottom: 400 }
  const controls = { left: 950, top: 112, right: 988, bottom: 250 }
  const attribution = { left: 0, top: 876, right: 400, bottom: 900 }
  const offscreen = { left: 2000, top: 0, right: 2100, bottom: 50 }
  const p = overlayFitPadding(map, { left: [legend], right: [controls, offscreen], bottom: [attribution] })
  assert.deepEqual(p.paddingTopLeft, [204 + FIT_MARGIN, FIT_MARGIN])
  assert.deepEqual(p.paddingBottomRight, [50 + FIT_MARGIN, 24 + FIT_MARGIN])
  // A legend wider than the map is capped at half its width.
  const huge = overlayFitPadding({ left: 0, top: 0, right: 300, bottom: 600 }, { left: [{ left: 0, top: 0, right: 290, bottom: 600 }] })
  assert.equal(huge.paddingTopLeft[0], 150 + FIT_MARGIN)
  // A top bar (the phone's Lanes button) pads the top, not the left.
  const phone = overlayFitPadding({ left: 0, top: 100, right: 390, bottom: 800 }, { top: [{ left: 12, top: 112, right: 120, bottom: 156 }] })
  assert.deepEqual(phone.paddingTopLeft, [FIT_MARGIN, 56 + FIT_MARGIN])
})

test('quietBasemapStyle removes noisy layers, recolours, and never mutates', () => {
  const style = {
    version: 8,
    sources: { openmaptiles: { type: 'vector', url: 'x' } },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': 'red' } },
      { id: 'water', type: 'fill', 'source-layer': 'water', paint: { 'fill-color': 'blue' } },
      { id: 'highway_minor', type: 'line', 'source-layer': 'transportation', paint: {} },
      { id: 'highway_major_inner', type: 'line', 'source-layer': 'transportation', paint: { 'line-color': '#333' } },
      { id: 'highway_name_other', type: 'symbol', 'source-layer': 'transportation_name' },
      { id: 'road_oneway', type: 'symbol', 'source-layer': 'transportation' },
      { id: 'poi_z14', type: 'symbol', 'source-layer': 'poi' },
      { id: 'building-3d', type: 'fill-extrusion', 'source-layer': 'building' },
      { id: 'place_other', type: 'symbol', 'source-layer': 'place' },
      { id: 'place_city', type: 'symbol', 'source-layer': 'place', paint: { 'text-color': '#fff' } },
      { id: 'something_new', type: 'line', 'source-layer': 'boundary', paint: { 'line-color': '#123' } },
    ],
  }
  const before = JSON.stringify(style)
  const out = quietBasemapStyle(style, 'light')
  assert.equal(JSON.stringify(style), before)
  assert.deepEqual(out.layers.map(l => l.id),
    ['background', 'water', 'highway_minor', 'highway_major_inner', 'place_city', 'something_new'])
  assert.equal(out.layers[0].paint['background-color'], BASEMAP_PALETTE.light.background)
  assert.equal(out.layers[1].paint['fill-color'], BASEMAP_PALETTE.light.water)
  assert.equal(out.layers[2].paint['line-opacity'], BASEMAP_PALETTE.light.minorRoadOpacity)
  assert.equal(out.layers[3].paint['line-color'], '#333')
  assert.equal(out.layers[3].paint['line-opacity'], BASEMAP_PALETTE.light.majorRoadOpacity)
  assert.equal(out.layers[4].paint['text-color'], BASEMAP_PALETTE.light.label)
  assert.equal(out.layers[5].paint['line-color'], '#123')
  assert.equal(out.sources, style.sources)
  assert.equal(quietBasemapStyle(style, 'unknown').layers[0].paint['background-color'], BASEMAP_PALETTE.dark.background)
})
