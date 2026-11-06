# City implementation plans

Branch: `feature/city-expansion-vienna`. Updated: 4 November 2026.

Vienna is implemented in mock mode by user request; listening and authenticated song save/reopen remain manual acceptance items. Other cities remain plans, not selectable placeholders. [Research and sources](../city-expansion-research-2026-11.md).

## Shared implementation checklist

Each city plan inherits these steps:

1. Validate the source archive, service dates, license/attribution, agency scope, route types, geometry and stop ordering. Keep raw GTFS in ignored `data/<id>_gtfs/` and credentials out of source.
2. Add `feed/cities/<id>.js` and register it in `feed/cities/index.js`. Use the correct timezone, mapLineTypes, derived bounds and attribution; keep `feeds: []` for an unimplemented live path.
3. Register browser URLs in `lib/shared/cities.js`: `NEXT_PUBLIC_LINES_URL_<CITY>` and `NEXT_PUBLIC_LINES_URL_<CITY>_SLIM` with committed local fallbacks. Keep `liveWsUrl: null`.
4. Add `preprocess:<id>` and include the city in `slim:all`. Run preprocessing and slim generation; retain source IDs. Add the city to `scripts/build_route_index.js` and the lazy loader in `lib/server/routeIndex.js`, then generate the index.
5. Add accurate city facts in `lib/shared/cityFacts.js` and update explicit city coverage in `test/ai-plan-apply.test.js` and `test/server-purity.test.js`. Verify composer plans against the generated index.
6. Update `CLAUDE.md`, run `npm run sync:agents`, and update `docs/multi-city-gtfs.md`. Confirm attribution, runtime switching, saved-song restoration and mobile payload behavior.
7. Run relevant pure-logic tests and `npm run build` without sharing `.next` with a running dev server. Manually exercise the picker, map, playback and save/reload; record any unverified behavior honestly.

## Release criteria

All generated full/slim/index files agree on route IDs and city metadata; supported route types and source attribution match actual imported coverage. No missing stops, invalid coordinates, empty lanes or credential leakage. Snapshot and composer city handling pass. A build alone does not establish audio behavior.

Live support is a separate milestone: verify actual decoded samples, static/realtime ID joins, timestamps, per-mode coverage, cadence, quotas and event semantics. Published predictions are not proof of observed arrivals. No plan implicitly enables Live app-wide.

## Per-city plans

- [Vienna](vienna.md): implemented in mock mode, 195 logical lines.
- [Stockholm](stockholm.md): planned.
- [Boston](boston.md): planned.
- [Brisbane](brisbane.md): planned.
- [Kuala Lumpur](kualalumpur.md): planned.
- [Reykjavík](reykjavik.md): planned.
- [Sydney](sydney.md): planned.
- [Oslo](oslo.md): planned.
- [Amsterdam](amsterdam.md): planned.
- [Paris](paris.md): planned.
- [San Francisco](sanfrancisco.md): planned.
