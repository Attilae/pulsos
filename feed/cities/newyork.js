// New York (MTA). Uses the supplemented NYC Subway static GTFS — subway + the
// Staten Island Railway only (route_type 1 → metro, route_type 2 → hev), so no
// tram/trolley/bus voices. First US city → NEGATIVE longitudes (pitch stays safe
// because it derives from each route's own routeBounds; see docs/multi-city-gtfs.md).
//
// Static GTFS is public, no key:
//   https://web.mta.info/developers/files/google_transit_supplemented.zip
//   (mirror: https://rrgtfsfeeds.s3.amazonaws.com/gtfs_supplemented.zip)
//
// ⚠️ GTFS-RT for the subway needs no key (v2.0.0) but is SHARDED by line group
// and TripUpdates-only (no VehiclePositions). Left best-effort below because the
// app runs mock-only for now (see lib/shared/cities.js). CONFIRM the sharded feed
// URLs before enabling Live.
//   docs: https://www.mta.info/developers

export default {
  id:        'newyork',
  name:      'New York (MTA)',
  timezone:  'America/New_York',
  staticGtfsUrl: 'https://web.mta.info/developers/files/google_transit_supplemented.zip',

  apiKeyEnv: null,
  auth:      { kind: 'none' },

  feeds: [
    // TODO: NYC subway RT is sharded by line group (ACE, BDFM, G, JZ, NQRW, L, 1234567, SIR)
    // and is TripUpdates + Alerts only. Add the per-shard URLs before enabling Live, e.g.:
    // { url: 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs',      entityTypes: ['trip', 'alert'] },
    // { url: 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-ace',  entityTypes: ['trip', 'alert'] },
  ],

  pollMs:  30000,
  alertMs: 60000,

  // Subway has no live VehiclePositions — infer from TripUpdates.
  modesWithoutVehiclePositions: ['metro'],

  routeTypeOverrides: {},

  // Supersets kept for consistency; the supplemented feed is effectively metro + hev.
  mapLineTypes: ['tram', 'metro', 'trolley', 'bus', 'hev'],

  // NYC bbox (approx) — NEGATIVE longitudes. Used feed-side for note naming + lng
  // fallback only; preprocess re-derives the real bbox from the GTFS stops.
  bounds: { latMin: 40.50, latMax: 40.92, lngMin: -74.05, lngMax: -73.70, centerLng: -73.95 },

  attribution: {
    text: 'Data © Metropolitan Transportation Authority (MTA)',
    licenseUrl: 'https://www.mta.info/developers',
  },
}
