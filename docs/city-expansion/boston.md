# Boston implementation plan

Status: **Planned**. City ID: `boston`. [Shared implementation checklist](README.md). [Source documentation](https://github.com/mbta/gtfs-documentation).

## Scope

MBTA network; label regional commuter services accurately.

## Static import tasks

- [ ] Download MBTA_GTFS.zip from the official CDN. Review the developer license and extension fields. Preserve branch route IDs.
- [ ] Implement and register `feed/cities/boston.js` with timezone, bounds, attribution and supported modes.
- [ ] Add browser registry entry, preprocessing command, slim generation, server index loader, city facts and coverage checks using the shared checklist.
- [ ] Generate `public/data/lines.boston.json`, `public/data/lines.boston.slim.json` and `lib/server/routeIndex/boston.js`.

## Live milestone

Use documented CDN protobuf feeds rather than introduce the V3 JSON API adapter. Confirm cadence and matching IDs. Ship the initial city in mock mode with `liveWsUrl: null`.

## City-specific acceptance

Subway branches remain distinct; commuter rail maps to hev and ferry to the existing bus voice.

- [ ] Complete automated validation and record imported coverage, payload sizes and source service dates.
- [ ] Exercise city switching, map routes, playback, save/reload and composer selection; document limitations.
