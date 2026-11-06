# Reykjavík implementation plan

Status: **Planned**. City ID: `reykjavik`. [Shared implementation checklist](README.md). [Source documentation](https://www.straeto.is/en/about-straeto/open-data).

## Scope

Strætó capital-area bus routes; filter regional Iceland services deliberately.

## Static import tasks

- [ ] Fetch the public current GTFS ZIP. Confirm redistribution conditions and record attribution before release. Preserve Icelandic names.
- [ ] Implement and register `feed/cities/reykjavik.js` with timezone, bounds, attribution and supported modes.
- [ ] Add browser registry entry, preprocessing command, slim generation, server index loader, city facts and coverage checks using the shared checklist.
- [ ] Generate `public/data/lines.reykjavik.json`, `public/data/lines.reykjavik.slim.json` and `lib/server/routeIndex/reykjavik.js`.

## Live milestone

Apply for access and establish format, limits and reuse terms before implementing a live adapter. Ship the initial city in mock mode with `liveWsUrl: null`.

## City-specific acceptance

Bounds cover intended capital-area service, names retain diacritics, and regional routes do not dominate the picker.

- [ ] Complete automated validation and record imported coverage, payload sizes and source service dates.
- [ ] Exercise city switching, map routes, playback, save/reload and composer selection; document limitations.
