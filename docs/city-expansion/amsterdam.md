# Amsterdam implementation plan

Status: **Planned**. City ID: `amsterdam`. [Shared implementation checklist](README.md). [Source documentation](https://gtfs.ovapi.nl/nl/).

## Scope

GVB first; NS and surrounding operators require a later scope decision.

## Static import tasks

- [ ] Filter national GTFS by agency before deriving routes and bounds. Verify applicable terms for the converted feed and underlying NDOV data.
- [ ] Implement and register `feed/cities/amsterdam.js` with timezone, bounds, attribution and supported modes.
- [ ] Add browser registry entry, preprocessing command, slim generation, server index loader, city facts and coverage checks using the shared checklist.
- [ ] Generate `public/data/lines.amsterdam.json`, `public/data/lines.amsterdam.slim.json` and `lib/server/routeIndex/amsterdam.js`.

## Live milestone

Validate actual GVB coverage and ID matching in published national protobuf feeds before adding endpoints. Ship the initial city in mock mode with `liveWsUrl: null`.

## City-specific acceptance

Only selected agencies remain in payload/index; national archive size does not become browser payload size.

- [ ] Complete automated validation and record imported coverage, payload sizes and source service dates.
- [ ] Exercise city switching, map routes, playback, save/reload and composer selection; document limitations.
