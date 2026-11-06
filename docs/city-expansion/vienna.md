# Vienna implementation plan

Status: **Implemented in mock mode; manual acceptance partly complete**. City ID: `vienna`. [Shared implementation checklist](README.md). [Source documentation](https://www.wienerlinien.at/ogd_realtime/doku/ogd/gtfs/gtfs.zip).

## Scope

Wiener Linien and Wiener Lokalbahnen; metro, tram and bus. Do not imply VOR-wide or ÖBB coverage.

## Static import tasks

- [x] Use the operator GTFS ZIP and CC BY attribution. Inspected same-name variants and added stable logical IDs for snapshots/composer plans; original IDs remain as sourceRouteIds.
- [x] Implement and register `feed/cities/vienna.js` with timezone, bounds, attribution and supported modes.
- [x] Add browser registry entry, preprocessing command, slim generation, server index loader, city facts and coverage checks using the shared checklist.
- [x] Generate `public/data/lines.vienna.json`, `public/data/lines.vienna.slim.json` and `lib/server/routeIndex/vienna.js`.

## Live milestone

Keep feeds empty. An official OGD departure adapter would be a separate task; do not depend on a third-party converter. Ship the initial city in mock mode with `liveWsUrl: null`.

## City-specific acceptance

U1–U4/U6 and representative tram/bus routes survive import, with nonempty ordered stops and geometry.

- [x] Complete automated validation and record imported coverage, payload sizes and source service dates.
- [ ] Exercise city switching, map routes, playback, save/reload and composer selection; document limitations.

## Import record

- Downloaded the official archive on 4 November 2026. SHA-256: `dbb7d05eafd984b8d706e02c374cd3905fbcfc0bfdb4030cc6e09573fe817638`.
- Source agencies: Wiener Linien (`04`) and Wiener Lokalbahnen (`03`). Calendar period: 14 December 2025 through 12 December 2026. Refresh the archive for the next timetable period.
- 905 source route records become 195 logical lines: 5 metro, 31 tram, 159 bus. Full JSON: 6,774,650 bytes; slim JSON: 895,516 bytes. Composer index: 195 entries.
- Metro: U1 (24 stops), U2 (21), U3 (21), U4 (20), U6 (24). Badner Bahn `BB` is a 37-stop tram route from Oper to Baden Josefsplatz in the representative pattern.
- Stable logical IDs use city/agency/source mode/short name, e.g. `vienna:04:1:U1`. All source timetable IDs are retained in `sourceRouteIds`; a future live adapter must translate them explicitly.
- Representative shape selection sums full-calendar service weights and frequency expansion by shape. This is deterministic for a given archive and includes seasonal/replacement lines. It is not a current-day timetable. The selected direction-0 stops define the lane, as in the existing pipeline.
- Demand sums source trips against logical line IDs, so route variants do not inflate transfer counts. No passenger-count adapter is required.

## Reproduce

Download and extract the official ZIP into ignored `data/vienna_gtfs/`, then run:

```sh
npm run preprocess:vienna
npm run slim:lines -- --city vienna
npm run index:routes -- --city vienna
node --test test/route-variants.test.js test/vienna-data.test.js test/ai-plan-apply.test.js test/server-purity.test.js
```

The city works without environment changes. Optional Blob overrides:
`NEXT_PUBLIC_LINES_URL_VIENNA` and `NEXT_PUBLIC_LINES_URL_VIENNA_SLIM`.

## Validation

- Full `npm test`: 572 passed, zero failed.
- `npm run build`: passed in an isolated copy at `/tmp/leid-vienna-build`, keeping the development `.next` separate. No additional dependencies were installed.
- Automated checks cover variant identity, service/frequency-weighted pattern selection, unchanged musical stops between full/slim data, index parity, valid coordinates/demand values, all five metro lines and WLB identity.
- Browser checks using the agent-browser skill: selected Vienna, rendered metro lanes, enabled U1 and started/stopped playback, observed U1/Oberlaa note events, reloaded and confirmed Vienna remained selected, and rendered desktop/phone maps with source attribution. No browser errors reported in the test session.
- Remaining manual acceptance: listen to audio and exercise authenticated song save/reopen. The browser playback check established control/event behavior, not listening quality; no paid AI generation or cloud preset write was performed.

## City-fact sources

The composer fact pool uses [Stadt Wien's U-Bahn anniversary](https://presse.wien.gv.at/kategoriennavigation/-/asset_publisher/zraFORwNk9Zp/content/2011-05-08-vor-35-jahren-begann-in-wien-das-u-bahn-zeitalter),
[Stadt Wien's construction history](https://presse.wien.gv.at/kategoriennavigation/-/asset_publisher/zraFORwNk9Zp/content/2014-11-03-45-jahre-u-bahn-bau-happy-birthday-wiener-u-bahn)
and [Vienna Tourist Board's subway guide](https://www.wien.info/en/travel-info/transport/subway-360332).
