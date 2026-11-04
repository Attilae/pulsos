# Paris implementation plan

Status: **Planned**. City ID: `paris`. [Shared implementation checklist](README.md). [Source documentation](https://transport.data.gouv.fr/datasets/reseau-urbain-et-interurbain-dile-de-france-mobilites?locale=fr).

## Scope

Selected Île-de-France metro/tram/rail/bus routes, with explicit regional boundary.

## Static import tasks

- [ ] Use regional GTFS; inspect geometry, ID stability, and applicable dataset reuse terms. Keep initial scope manageable.
- [ ] Implement and register `feed/cities/paris.js` with timezone, bounds, attribution and supported modes.
- [ ] Add browser registry entry, preprocessing command, slim generation, server index loader, city facts and coverage checks using the shared checklist.
- [ ] Generate `public/data/lines.paris.json`, `public/data/lines.paris.slim.json` and `lib/server/routeIndex/paris.js`.

## Live milestone

PRIM account and SIRI Lite adapter needed. Budget bulk and unit request quotas separately; do not put SIRI endpoints in the protobuf decoder. Ship the initial city in mock mode with `liveWsUrl: null`.

## City-specific acceptance

Static routes load independently of PRIM credentials; live remains off until adapter and quota tests pass.

- [ ] Complete automated validation and record imported coverage, payload sizes and source service dates.
- [ ] Exercise city switching, map routes, playback, save/reload and composer selection; document limitations.
