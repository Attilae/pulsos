# San Francisco implementation plan

Status: **Planned**. City ID: `sanfrancisco`. [Shared implementation checklist](README.md). [Source documentation](https://511.org/open-data/transit).

## Scope

Start with an explicit agency set, such as Muni; Bay Area rail/ferries expand scope separately.

## Static import tasks

- [ ] Obtain 511 token and review data agreement; use agency-specific GTFS to avoid a giant regional browser payload.
- [ ] Implement and register `feed/cities/sanfrancisco.js` with timezone, bounds, attribution and supported modes.
- [ ] Add browser registry entry, preprocessing command, slim generation, server index loader, city facts and coverage checks using the shared checklist.
- [ ] Generate `public/data/lines.sanfrancisco.json`, `public/data/lines.sanfrancisco.slim.json` and `lib/server/routeIndex/sanfrancisco.js`.

## Live milestone

Default 60 calls/hour cannot support five-second polling. Obtain a quota increase or design an appropriately paced adapter. Ship the initial city in mock mode with `liveWsUrl: null`.

## City-specific acceptance

Negative-longitude pitch/pan and bounds work; selected agencies match payload, attribution and city label.

- [ ] Complete automated validation and record imported coverage, payload sizes and source service dates.
- [ ] Exercise city switching, map routes, playback, save/reload and composer selection; document limitations.
