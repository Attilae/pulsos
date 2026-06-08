// Berlin (VBB — Verkehrsverbund Berlin-Brandenburg). First-party, public,
// no API key. GTFS-RT is a single COMBINED feed (TripUpdate-dominant; sparse
// VehiclePositions), so we list the same URL twice — once for the positions
// poll (trip/vehicle) and once for the alerts poll — since feed/bkkFeed.js
// resolves feed URLs by entityType.
//   RT feed: https://production.gtfsrt.vbb.de/ (no auth, 60 req/min, CC-BY 4.0)
//   Static GTFS: VBB open data (refreshed Wed/Fri, CC-BY 4.0)
//   docs: https://www.vbb.de/vbb-services/api-open-data/

const RT = 'https://production.gtfsrt.vbb.de/data'

export default {
  id:        'berlin',
  name:      'Berlin (VBB)',
  timezone:  'Europe/Berlin',
  staticGtfsUrl: 'https://www.vbb.de/fileadmin/user_upload/VBB/Dokumente/API-Datensaetze/gtfs-mastscharf/GTFS.zip',

  apiKeyEnv: null,
  auth:      { kind: 'none' },

  feeds: [
    { url: RT, entityTypes: ['trip', 'vehicle'] }, // combined feed, polled on pollMs
    { url: RT, entityTypes: ['alert'] },           // same URL, polled on alertMs
  ],

  pollMs:  5000,
  alertMs: 60000,

  // VBB RT is TripUpdate-dominant; rail modes report few/no VehiclePositions.
  // Infer positions from TripUpdates for rail-like modes (matters only for Live).
  modesWithoutVehiclePositions: ['metro', 'hev'],

  routeTypeOverrides: {},

  // S-Bahn / regional rail included so the map has rail tracks; tune later if noisy.
  mapLineTypes: ['tram', 'metro', 'trolley', 'bus', 'hev'],

  // Greater Berlin+Brandenburg bbox (feed-side note naming + lng fallback only;
  // preprocess re-derives the real bbox from the GTFS stops).
  bounds: { latMin: 52.30, latMax: 52.70, lngMin: 13.05, lngMax: 13.80, centerLng: 13.40 },

  attribution: {
    text: 'Data © Verkehrsverbund Berlin-Brandenburg (VBB), CC BY 4.0',
    licenseUrl: 'https://www.vbb.de/vbb-services/api-open-data/',
  },
}
