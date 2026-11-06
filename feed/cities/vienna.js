// Official Wiener Linien / Wiener Lokalbahnen GTFS (CC BY 4.0).
// Includes timetable-specific variants; preprocessing collapses these into
// agency/mode/line IDs and selects the most frequent scheduled shape per direction.
// No VOR-wide, ÖBB or third-party realtime coverage is implied.
export default {
  id: 'vienna',
  name: 'Vienna (Wiener Linien / WLB)',
  timezone: 'Europe/Vienna',
  staticGtfsUrl: 'https://www.wienerlinien.at/ogd_realtime/doku/ogd/gtfs/gtfs.zip',
  apiKeyEnv: null,
  auth: { kind: 'none' },
  feeds: [], // Official OGD departures need a separate adapter; mock-only.
  pollMs: 15000,
  alertMs: 60000,
  modesWithoutVehiclePositions: [],
  routeTypeOverrides: {},
  mapLineTypes: ['metro', 'tram', 'bus'],
  groupRouteVariants: true,
  bounds: { latMin: 48.00, latMax: 48.32, lngMin: 16.20, lngMax: 16.58, centerLng: 16.39 },
  attribution: {
    text: 'Data: Stadt Wien – Wiener Linien / Wiener Lokalbahnen, CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  },
}
