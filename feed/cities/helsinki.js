// Helsinki (HSL). HSL runs on Digitransit/OpenTripPlanner, like BKK, so the
// data model is nearly identical.
//
// ⚠️ CONFIRM these endpoint URLs against current HSL docs before relying on
// live data — the older api.digitransit.fi RT endpoints are deprecated in
// favour of realtime.hsl.fi. The realtime.hsl.fi GTFS-RT feeds are public
// (no key); the Digitransit *routing* API (different product) needs a
// `digitransit-subscription-key` header. If HSL later gates these feeds, set
// `apiKeyEnv: 'HSL_API_KEY'` and `auth: { kind: 'header', name: 'digitransit-subscription-key' }`.
//   docs: https://digitransit.fi/en/developers/apis/5-realtime-api/

const RT = 'https://realtime.hsl.fi/realtime'

export default {
  id:        'helsinki',
  name:      'Helsinki (HSL)',
  timezone:  'Europe/Helsinki',
  staticGtfsUrl: 'https://infopalvelut.storage.hsldev.com/gtfs/hsl.zip',

  apiKeyEnv: null,
  auth:      { kind: 'none' },

  feeds: [
    { url: `${RT}/vehicle-positions/v2/hsl`, entityTypes: ['vehicle'] },
    { url: `${RT}/trip-updates/v2/hsl`,      entityTypes: ['trip'] },
    { url: `${RT}/service-alerts/v2/hsl`,    entityTypes: ['alert'] },
  ],

  pollMs:  5000,
  alertMs: 60000,

  // Safe default: infer metro positions from TripUpdates if HSL's metro feed
  // lacks live VehiclePositions. Flip to [] if metro positions are present.
  modesWithoutVehiclePositions: ['metro'],

  // HSL uses standard route_types (0 tram, 1 metro, 3 bus, 4 ferry) plus 109
  // for commuter rail — all handled by the shared resolver. No overrides needed.
  routeTypeOverrides: {},

  // Line types drawn on the map / loaded as tracks (preprocess).
  mapLineTypes: ['tram', 'metro', 'trolley', 'bus', 'hev'],

  // Greater Helsinki bounding box (approx); used feed-side for note naming.
  bounds: { latMin: 60.10, latMax: 60.34, lngMin: 24.78, lngMax: 25.25, centerLng: 24.94 },

  attribution: {
    text: 'Data © Helsingin seudun liikenne (HSL), CC BY 4.0',
    licenseUrl: 'https://www.hsl.fi/en/hsl/open-data',
  },
}
