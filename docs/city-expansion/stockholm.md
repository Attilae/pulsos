# Stockholm implementation plan

Status: **Planned**. City ID: `stockholm`. [Shared implementation checklist](README.md). [Source documentation](https://www.trafiklab.se/api/gtfs-datasets/gtfs-regional/).

## Scope

SL region; explicitly exclude overlapping regional operators in the first import.

## Static import tasks

- [ ] Obtain a server-side Trafiklab key. Use GTFS Regional sl, CC0. Handle extended route types and calendar_dates-based service.
- [ ] Implement and register `feed/cities/stockholm.js` with timezone, bounds, attribution and supported modes.
- [ ] Add browser registry entry, preprocessing command, slim generation, server index loader, city facts and coverage checks using the shared checklist.
- [ ] Generate `public/data/lines.stockholm.json`, `public/data/lines.stockholm.slim.json` and `lib/server/routeIndex/stockholm.js`.

## Live milestone

Add keyed trip/position/alert endpoints separately; select a quota tier from actual calls per month, not minute limits alone. Ship the initial city in mock mode with `liveWsUrl: null`.

## City-specific acceptance

SL modes and calendar exceptions produce valid demand signals; credentials never enter generated payloads.

- [ ] Complete automated validation and record imported coverage, payload sizes and source service dates.
- [ ] Exercise city switching, map routes, playback, save/reload and composer selection; document limitations.
