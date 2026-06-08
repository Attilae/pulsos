// Budapest (BKK) — the original city. Values extracted verbatim from the
// pre-refactor hardcoded feed so behaviour is unchanged.
//
// GTFS-RT is one combined service exposed as three .pb endpoints under a common
// base; auth is an API key in the `key` query param.

const BASE = 'https://go.bkk.hu/api/query/v1/ws/gtfs-rt/full'

export default {
  id:        'budapest',
  name:      'Budapest (BKK)',
  timezone:  'Europe/Budapest',
  staticGtfsUrl: 'https://go.bkk.hu/api/static/v1/public-gtfs/budapest_gtfs.zip',

  apiKeyEnv: 'BKK_API_KEY',
  auth:      { kind: 'query', name: 'key' },

  feeds: [
    { url: `${BASE}/VehiclePositions.pb`, entityTypes: ['vehicle'] },
    { url: `${BASE}/TripUpdates.pb`,      entityTypes: ['trip'] },
    { url: `${BASE}/Alerts.pb`,           entityTypes: ['alert'] },
  ],

  pollMs:  5000,
  alertMs: 60000,

  // BKK metro reports no live VehiclePositions — infer them from TripUpdates.
  modesWithoutVehiclePositions: ['metro'],

  routeTypeOverrides: {},

  // Line types drawn on the map / loaded as tracks (preprocess). Budapest has
  // historically excluded HÉV/MÁV rail from the route file.
  mapLineTypes: ['tram', 'metro', 'trolley', 'bus'],

  // Used feed-side for note naming (latToNote) and the longitude fallback.
  bounds: { latMin: 47.35, latMax: 47.70, lngMin: 18.87, lngMax: 19.27, centerLng: 19.05 },

  attribution: { text: 'Data © BKK', licenseUrl: 'https://opendata.bkk.hu/' },
}
