# Kuala Lumpur implementation plan

Status: **Planned**. City ID: `kualalumpur`. [Shared implementation checklist](README.md). [Source documentation](https://developer.data.gov.my/realtime-api/gtfs-static.en).

## Scope

Rapid KL rail, bus and MRT feeder categories; KTMB is a separately scoped expansion.

## Static import tasks

- [ ] Merge category archives with namespaced IDs if collisions exist. Retain category provenance and CC BY 4.0 attribution. Account for documented missing bus trips.
- [ ] Implement and register `feed/cities/kualalumpur.js` with timezone, bounds, attribution and supported modes.
- [ ] Add browser registry entry, preprocessing command, slim generation, server index loader, city facts and coverage checks using the shared checklist.
- [ ] Generate `public/data/lines.kualalumpur.json`, `public/data/lines.kualalumpur.slim.json` and `lib/server/routeIndex/kualalumpur.js`.

## Live milestone

Bus position feeds only initially, 30-second cadence. Stable Rapid Rail realtime and trip updates are not currently established. Ship the initial city in mock mode with `liveWsUrl: null`.

## City-specific acceptance

Rail and bus categories coexist without duplicate IDs or broken stop/trip references; rail is never labelled live.

- [ ] Complete automated validation and record imported coverage, payload sizes and source service dates.
- [ ] Exercise city switching, map routes, playback, save/reload and composer selection; document limitations.
