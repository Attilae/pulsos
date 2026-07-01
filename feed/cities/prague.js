// Prague (PID — Pražská integrovaná doprava). The best modal fit after Budapest:
// metro + tram + trolleybus + bus + funicular + ferries + trains, so it exercises
// all five engine voices (metro|tram|trolley|bus|hev).
//
// Static GTFS is public, CC-BY 4.0, regenerated daily (~04:00–04:30):
//   https://pid.cz/en/opendata/  →  http://data.pid.cz/PID_GTFS.zip
//
// ⚠️ GTFS-RT is served via the Golemio API and needs a free access-token key
// (header `X-Access-Token`). It's left best-effort below because the app runs
// mock-only for now (see lib/shared/cities.js). CONFIRM the Golemio realtime
// endpoint URLs and set GOLEMIO_API_KEY before enabling Live.
//   docs: https://api.golemio.cz/pid/docs/openapi/

export default {
  id:        'prague',
  name:      'Prague (PID)',
  timezone:  'Europe/Prague',
  staticGtfsUrl: 'http://data.pid.cz/PID_GTFS.zip',

  // Live is disabled app-wide; these are aspirational until the Golemio RT
  // endpoints are confirmed. PID GTFS-RT requires a key in the X-Access-Token header.
  apiKeyEnv: 'GOLEMIO_API_KEY',
  auth:      { kind: 'header', name: 'X-Access-Token' },

  feeds: [
    // TODO: confirm Golemio GTFS-RT URLs before enabling Live.
    // { url: 'https://api.golemio.cz/v2/pid/vehiclepositions/gtfsrt/vehicle_positions.pb', entityTypes: ['vehicle'] },
    // { url: 'https://api.golemio.cz/v2/pid/vehiclepositions/gtfsrt/trip_updates.pb',      entityTypes: ['trip'] },
  ],

  pollMs:  5000,
  alertMs: 60000,

  // Metro reports no live VehiclePositions on most agencies — infer from TripUpdates.
  modesWithoutVehiclePositions: ['metro'],

  // PID uses standard route_types (0 tram, 1 metro, 2 rail, 3 bus, 4 ferry,
  // 7 funicular, 11 trolleybus) — all handled by the shared resolver. Add
  // overrides here only if `typeCounts` after preprocess shows a misclassification.
  routeTypeOverrides: {},

  // All five line types drawn on the map / loaded as tracks (preprocess).
  mapLineTypes: ['tram', 'metro', 'trolley', 'bus', 'hev'],

  // Greater Prague bbox (approx); used feed-side for note naming + lng fallback.
  // preprocess re-derives the real bbox from the GTFS stops.
  bounds: { latMin: 49.94, latMax: 50.18, lngMin: 14.22, lngMax: 14.71, centerLng: 14.44 },

  attribution: {
    text: 'Data © Pražská integrovaná doprava (PID), CC BY 4.0',
    licenseUrl: 'https://pid.cz/en/opendata/',
  },
}
