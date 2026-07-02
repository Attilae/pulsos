// Warsaw (ZTM Warszawa). Static GTFS built + hosted by Mikołaj Kuranowski from
// ZTM open data — metro + tram + bus + rail (→ metro/tram/bus/hev voices; no
// trolleybus). GTFS-RT (vehicle positions + alerts) is public and needs no key.
//
//   Static GTFS + RT: https://mkuran.pl/gtfs/
//
// ⚠️ RT feeds are listed best-effort; the app is mock-only for now (see
// lib/shared/cities.js). Confirm the endpoints before enabling Live.

const RT = 'https://mkuran.pl/gtfs/warsaw'

export default {
  id:        'warsaw',
  name:      'Warsaw (ZTM)',
  timezone:  'Europe/Warsaw',
  staticGtfsUrl: 'https://mkuran.pl/gtfs/warsaw.zip',

  apiKeyEnv: null,
  auth:      { kind: 'none' },

  feeds: [
    { url: `${RT}/vehicles.pb`, entityTypes: ['vehicle'] },
    { url: `${RT}/alerts.pb`,   entityTypes: ['alert'] },
  ],

  pollMs:  5000,
  alertMs: 60000,

  // Metro reports no live VehiclePositions on most agencies — infer from TripUpdates.
  modesWithoutVehiclePositions: ['metro'],

  // Warsaw uses standard route_types (0 tram, 1 metro, 2 rail, 3 bus) — handled by
  // the shared resolver. Verify `typeCounts` after preprocess; add overrides if needed.
  routeTypeOverrides: {},

  mapLineTypes: ['tram', 'metro', 'trolley', 'bus', 'hev'],

  // Greater Warsaw bbox (approx); feed-side note naming + lng fallback only.
  // preprocess re-derives the real bbox from the GTFS stops.
  bounds: { latMin: 52.10, latMax: 52.36, lngMin: 20.85, lngMax: 21.20, centerLng: 21.01 },

  attribution: {
    text: 'Data © ZTM Warszawa / Mikołaj Kuranowski, OpenStreetMap contributors',
    licenseUrl: 'https://mkuran.pl/gtfs/',
  },
}
