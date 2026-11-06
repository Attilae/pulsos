# Sydney implementation plan

Status: **Planned**. City ID: `sydney`. [Shared implementation checklist](README.md). [Source documentation](https://opendata.prod.transport.nsw.gov.au/developers/documentation).

## Scope

TfNSW metropolitan trains, buses, ferries and light rail; exclude rural/regional services unless explicitly requested.

## Static import tasks

- [ ] Use timetable datasets designed for realtime matching. Obtain a private API key; check each dataset license. Merge mode feeds with collision-safe IDs if needed.
- [ ] Implement and register `feed/cities/sydney.js` with timezone, bounds, attribution and supported modes.
- [ ] Add browser registry entry, preprocessing command, slim generation, server index loader, city facts and coverage checks using the shared checklist.
- [ ] Generate `public/data/lines.sydney.json`, `public/data/lines.sydney.slim.json` and `lib/server/routeIndex/sydney.js`.

## Live milestone

Use Authorization header and mode-specific GTFS-RT; poll at documented useful cadence (currently 15 seconds). Ship the initial city in mock mode with `liveWsUrl: null`.

## City-specific acceptance

Each included mode has coherent stops/shapes and no ID collision; NSW-wide outliers do not set city bounds.

- [ ] Complete automated validation and record imported coverage, payload sizes and source service dates.
- [ ] Exercise city switching, map routes, playback, save/reload and composer selection; document limitations.
