// Quiet, theme-aware basemap styles for the map view (pure; no MapLibre import).
//
// The basemap is OpenFreeMap's own `dark` and `positron` styles, fetched at
// runtime and filtered here rather than copied into the repo: the styles,
// sprites, glyphs and tile sources stay OpenFreeMap's (and keep their
// attribution, which comes from the tile source's TileJSON), and we only
// remove and recolour layers. Removing layers keeps the geography quiet so the
// coloured transit routes carry the picture: no road names, one-way arrows,
// shields, airport labels or hamlet labels; rivers, major roads, districts and
// city labels stay.

export const BASEMAP_STYLE_URLS = {
  dark: 'https://tiles.openfreemap.org/styles/dark',
  light: 'https://tiles.openfreemap.org/styles/positron',
}

// Neutral land/water per theme, close to the app's --bg (n-1000 / n-10) so the
// map reads as part of the surface rather than a picture behind it. Water is a
// touch cooler than land in both themes; parks barely separate from land.
export const BASEMAP_PALETTE = {
  dark: {
    background: '#0e0f11', water: '#16191e', land: '#111215', park: '#131518',
    building: '#141518', label: '#7d838e', labelHalo: '#0e0f11', minorRoadOpacity: 0.5, majorRoadOpacity: 0.55,
  },
  light: {
    background: '#f7f8fa', water: '#d6dde4', land: '#f1f2f4', park: '#eaede8',
    building: '#eceef1', label: '#6b7280', labelHalo: '#f7f8fa', minorRoadOpacity: 0.6, majorRoadOpacity: 0.75,
  },
}

const DROPPED_SOURCE_LAYERS = new Set(['transportation_name', 'aerodrome_label', 'poi', 'housenumber', 'mountain_peak'])
const DROPPED_IDS = new Set([
  'road_oneway', 'road_oneway_opposite',
  'highway_path', 'road_pier', 'road_area_pier',
  'aeroway-taxiway', 'aeroway-runway-casing', 'aeroway-runway', 'aeroway-area',
  // Neighbourhood/hamlet names: the densest label class and the least useful.
  'place_other', 'label_other',
])
// Major roads and motorways stay as orientation, but under the routes' contrast.
const MAJOR_ROAD = /^highway_(major|motorway)_/
const MINOR_ROAD_IDS = new Set(['highway_minor', 'railway_minor', 'railway_minor_dashline', 'railway_service', 'railway_service_dashline'])

function dropLayer(layer) {
  if (DROPPED_IDS.has(layer.id)) return true
  if (DROPPED_SOURCE_LAYERS.has(layer['source-layer'])) return true
  if (layer.type === 'fill-extrusion') return true
  return false
}

/**
 * Returns a new style object: the source style with noisy layers removed and
 * land/water/labels recoloured for `theme` ('dark' | 'light'). The input is not
 * mutated. Unknown layer ids pass through unchanged, so an upstream style edit
 * degrades to "less tuned", never to a broken map.
 */
export function quietBasemapStyle(style, theme) {
  const p = BASEMAP_PALETTE[theme === 'light' ? 'light' : 'dark']
  const layers = []
  for (const src of style?.layers ?? []) {
    if (dropLayer(src)) continue
    const layer = { ...src, paint: { ...(src.paint ?? {}) }, layout: { ...(src.layout ?? {}) } }
    const id = layer.id
    if (layer.type === 'background') layer.paint['background-color'] = p.background
    else if (id === 'water') layer.paint['fill-color'] = p.water
    else if (id === 'landuse_residential' || id === 'landcover_ice_shelf' || id === 'landcover_glacier') layer.paint['fill-color'] = p.land
    else if (id === 'landuse_park' || id === 'park' || id === 'landcover_wood') layer.paint['fill-color'] = p.park
    else if (id === 'building') layer.paint['fill-color'] = p.building
    else if (MINOR_ROAD_IDS.has(id)) layer.paint['line-opacity'] = p.minorRoadOpacity
    else if (layer.type === 'line' && MAJOR_ROAD.test(id)) layer.paint['line-opacity'] = p.majorRoadOpacity
    if (layer.type === 'symbol' && (layer['source-layer'] === 'place' || layer['source-layer'] === 'water_name' || layer['source-layer'] === 'waterway')) {
      layer.paint['text-color'] = p.label
      layer.paint['text-halo-color'] = p.labelHalo
    }
    if (!Object.keys(layer.layout).length) delete layer.layout
    layers.push(layer)
  }
  return { ...style, layers }
}
