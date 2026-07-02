// Zürich (ZVV / VBZ — Verkehrsbetriebe Zürich). City-region static GTFS from
// the Zurich open-data portal — tram + bus (+ trolleybus; VBZ runs trolleys).
// Zürich has no metro, and this city feed excludes heavy rail / lake boats.
//
// Static GTFS is public, CC0, Zurich (ZVV tariff zone) only:
//   https://data.stadt-zuerich.ch/dataset/vbz_fahrplandaten_gtfs
//
// ⚠️ The download filename is YEAR-STAMPED (2026_google_transit.zip) — bump the
// year annually. GTFS-RT for Switzerland lives on opentransportdata.swiss, is
// NATIONWIDE and needs an API key, so it's out of scope here (the app is
// mock-only anyway; see lib/shared/cities.js). Leave `feeds` empty.

export default {
  id:        'zurich',
  name:      'Zürich (ZVV)',
  timezone:  'Europe/Zurich',
  staticGtfsUrl: 'https://data.stadt-zuerich.ch/dataset/vbz_fahrplandaten_gtfs/download/2026_google_transit.zip',

  apiKeyEnv: null,
  auth:      { kind: 'none' },

  feeds: [],  // Swiss RT is nationwide + key-gated — not wired.

  pollMs:  5000,
  alertMs: 60000,

  modesWithoutVehiclePositions: [],

  // Swiss GTFS may use HVT codes (900 tram, 800 trolleybus, 700 bus) — all handled
  // by the shared resolver. Verify `typeCounts` after preprocess; add overrides if needed.
  routeTypeOverrides: {},

  mapLineTypes: ['tram', 'metro', 'trolley', 'bus', 'hev'],

  // Greater Zürich bbox (approx); feed-side note naming + lng fallback only.
  // preprocess re-derives the real bbox from the GTFS stops.
  bounds: { latMin: 47.30, latMax: 47.44, lngMin: 8.44, lngMax: 8.63, centerLng: 8.54 },

  attribution: {
    text: 'Data © Zürcher Verkehrsverbund (ZVV) / VBZ, CC0',
    licenseUrl: 'https://data.stadt-zuerich.ch/dataset/vbz_fahrplandaten_gtfs',
  },
}
