# Brisbane implementation plan

Status: **Planned**. City ID: `brisbane`. [Shared implementation checklist](README.md). [Source documentation](https://translink.com.au/about-translink/open-data).

## Scope

Brisbane routes from South East Queensland; decide whether Gold Coast tram is in scope before naming the dataset.

## Static import tasks

- [ ] Download SEQ GTFS, CC BY 4.0, no authentication. Add an explicit route/agency/geographic filter if a Brisbane-only scope is chosen.
- [ ] Implement and register `feed/cities/brisbane.js` with timezone, bounds, attribution and supported modes.
- [ ] Add browser registry entry, preprocessing command, slim generation, server index loader, city facts and coverage checks using the shared checklist.
- [ ] Generate `public/data/lines.brisbane.json`, `public/data/lines.brisbane.slim.json` and `lib/server/routeIndex/brisbane.js`.

## Live milestone

Use public mode-specific GTFS-RT feeds and confirm per-mode coverage and cadence. Ship the initial city in mock mode with `liveWsUrl: null`.

## City-specific acceptance

No accidental statewide bounds; train, bus and ferry remain selectable, with trams only when scope includes them.

- [ ] Complete automated validation and record imported coverage, payload sizes and source service dates.
- [ ] Exercise city switching, map routes, playback, save/reload and composer selection; document limitations.
