# Oslo implementation plan

Status: **Planned**. City ID: `oslo`. [Shared implementation checklist](README.md). [Source documentation](https://developer.entur.no/open-data/timetable).

## Scope

Ruter Oslo region from Entur regional exports.

## Static import tasks

- [ ] Prefer regional GTFS over Norway-wide files; record NLOD attribution. Choose basic or extended route types intentionally.
- [ ] Implement and register `feed/cities/oslo.js` with timezone, bounds, attribution and supported modes.
- [ ] Add browser registry entry, preprocessing command, slim generation, server index loader, city facts and coverage checks using the shared checklist.
- [ ] Generate `public/data/lines.oslo.json`, `public/data/lines.oslo.slim.json` and `lib/server/routeIndex/oslo.js`.

## Live milestone

Entur RUT trip updates/alerts refresh every 15 seconds. Its published coverage table lacks RUT vehicle positions; investigate prediction-derived behavior separately. Ship the initial city in mock mode with `liveWsUrl: null`.

## City-specific acceptance

Regional scope and timezone are correct; no fabricated GPS positions or claims of observed station arrivals.

- [ ] Complete automated validation and record imported coverage, payload sizes and source service dates.
- [ ] Exercise city switching, map routes, playback, save/reload and composer selection; document limitations.
