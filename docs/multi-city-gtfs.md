# Multi-city GTFS support

The app ("Leið") was built around Budapest (BKK), but the architecture is meant to stay
city-agnostic — GTFS and GTFS-RT are global standards. This document explains how transit feeds
differ between agencies, which cities are cheap to add, how the route-type mapping generalizes,
and the per-city **config abstraction** the codebase now uses.

> TL;DR for adding a city: write one descriptor under `feed/cities/<id>.js`, run
> `npm run preprocess -- --city <id> --gtfs data/<id>_gtfs`, set `CITY=<id>` for the feed service,
> and point `NEXT_PUBLIC_LINES_URL` at the generated `lines.<id>.json`. No engine code changes.

## How GTFS-RT feeds differ per agency

GTFS-RT is a single protobuf wire format (`FeedMessage` → `FeedEntity` → one of `TripUpdate` /
`VehiclePosition` / `Alert`), so the **decode path is identical for every agency** — we use
[`gtfs-realtime-bindings`](https://www.npmjs.com/package/gtfs-realtime-bindings)
(`transit_realtime.FeedMessage.decode(buf)`) unchanged. What varies is the delivery wrapper:

- **Auth** — no convention exists:
  - **none**: BART, NYC subway (feed v2.0.0).
  - **query param**: BKK (`?key=…`), 511 SF Bay (`?api_key=…&agency=SF`), CTA.
  - **HTTP header**: Digitransit/HSL (`digitransit-subscription-key`), Switzerland
    (`Authorization`), Paris PRIM.
  - Common quirk: Trips/Vehicles keyed but **Alerts left open**.
- **Endpoint shape** — most agencies expose **three URLs** (VehiclePositions / TripUpdates /
  Alerts), but a minority ship a **combined** feed (NYC subway: TripUpdates + Alerts in one), and
  some **shard by line group** (NYC: separate URLs for ACE, BDFM, G, …). The config models this as
  a **list of `{ url, entityTypes }`**, not three fixed fields.
- **Update frequency** — ~30 s for TripUpdates, 1–5 s for VehiclePositions is typical. BKK's 5 s /
  60 s cadence is normal. Respect each agency's stated cadence and quota; don't poll faster.
- **VehiclePositions coverage is partial and mode-dependent.** Heavy-rail/metro systems frequently
  provide **no** live positions (trains tracked by signal block, not GPS) — **BKK metro and NYC
  subway are identical here**. So treat VehiclePositions as optional per mode and always have a
  TripUpdate-derived fallback. The config field `modesWithoutVehiclePositions` drives this; the
  feed's `_emitMetroUpdates()` infers positions from `stopTimeUpdate` times.

Sources: [GTFS-RT proto](https://gtfs.org/documentation/realtime/proto/),
[GTFS-RT best practices](https://gtfs.org/documentation/realtime/realtime-best-practices/),
[NYC subway GTFS-RT reference](https://www.mta.info/document/134521),
[511 open data](https://511.org/open-data/transit).

## Candidate cities, by onboarding friction

Best music candidates = rich multimodal networks (metro + tram/light-rail + bus, ideally ferry)
with low-friction keys and reliable feeds.

**Tier 1 — easiest, do these first**

- **Helsinki — HSL / Digitransit** *(our chosen second city)*. Best architectural fit: BKK also
  runs on Digitransit/OpenTripPlanner, so the data model is nearly identical. Metro + tram + bus +
  commuter rail + ferry. Free instant self-service key (header `digitransit-subscription-key`).
  Static GTFS: `https://infopalvelut.storage.hsldev.com/gtfs/hsl.zip`. **RT lives at
  `realtime.hsl.fi` — the older `api.digitransit.fi` RT endpoints are deprecated.** Confirm exact
  RT URLs from current HSL docs before shipping.
  [Digitransit realtime APIs](https://digitransit.fi/en/developers/apis/5-realtime-api/),
  [HSL open data](https://www.hsl.fi/en/hsl/open-data).
- **San Francisco Bay Area — 511 SF Bay**. One key, one regional feed covering Muni, BART,
  Caltrain, AC Transit, VTA, ferries — huge modal variety. Query-param auth. **BART needs no key**
  (good zero-friction smoke test). Note: **negative longitudes** — see gotchas.
  [511 transit data](https://511.org/open-data/transit),
  [BART GTFS-RT](https://www.bart.gov/schedules/developers/gtfs-realtime).
- **New York — MTA**. Subway feeds need **no key** (v2.0.0). Subway is **sharded by line group**
  and **TripUpdates-only** — validates the metro-inference path against a second city for free.
  [MTA developers](https://www.mta.info/developers).
- **Berlin — VBB**. Now a **first-party** GTFS-RT feed run by OpenDataVBB at
  `https://production.gtfsrt.vbb.de/data` — **no key**, 60 req/min, CC-BY 4.0. Single **combined**
  feed (TripUpdate-dominant; sparse VehiclePositions, so the TripUpdate-inference path applies to
  rail modes). U-Bahn + S-Bahn + tram + bus + ferry + regional rail. Static GTFS (CC-BY 4.0,
  refreshed Wed/Fri): VBB open data (permanent mirror: vbb-gtfs.jannisr.de). Implemented as
  `feed/cities/berlin.js` (mock-only until Live is enabled).
  [VBB GTFS-RT](https://production.gtfsrt.vbb.de/), [OpenDataVBB](https://github.com/OpenDataVBB/gtfs-rt-feed).

**Tier 2 — more friction**

- **Chicago CTA** — key required; native realtime is partly its own JSON API.
- **Switzerland (opentransportdata.swiss)** — clean docs, key (`Authorization`), rail-heavy.
- **Paris IDFM/PRIM** — very multimodal, but native realtime is partly **SIRI**, not GTFS-RT;
  needs a SIRI→GTFS-RT bridge.
- **Amsterdam — OVapi (GVB)** — no key, but the GTFS + GTFS-RT (`gtfs.ovapi.nl/nl/*.pb`) are
  **nation-wide** (~40 NL agencies, ~1.3 GB uncompressed); needs a GVB agency-filter step in both
  preprocess and the feed before it's a clean single-city add.

## Standard + extended route types

Our `routeTypeToLineType()` (shared as `lib/routeTypes.js`, mirrored in `feed/routeTypes.js`)
maps a GTFS `route_type` to one of the engine's **five existing voices** —
`metro | tram | trolley | bus | hev` — so adding a city never needs new synth wiring. Rail /
suburban collapse to `hev` (sustained pads / cello) and ferries to `bus` (textural pads). It
handles both the **standard** small integers and the **extended (HVT)** codes EU agencies use:

| Standard | Meaning | → lineType |
|---|---|---|
| 0 | Tram / light rail | tram |
| 1 | Subway / metro | metro |
| 2 | Rail | hev |
| 3 | Bus | bus |
| 4 | Ferry | bus |
| 5 | Cable tram | tram |
| 7 | Funicular | tram |
| 11 | Trolleybus | trolley |
| 12 | Monorail | metro |

Extended codes are bucketed by leading digits (`Math.floor(value / 100)`):

| Range | Meaning | → lineType |
|---|---|---|
| 100s | Railway (109 = suburban / S-Bahn / HÉV-equivalent) | hev |
| 200s | Coach | bus |
| 400–600s | Urban railway / metro / underground | metro |
| 700s | Bus | bus |
| 800 | Trolleybus | trolley |
| 900s | Tram | tram |
| 1000s / 1200s | Water / ferry | bus |
| 1400s | Funicular | tram |

A city can pass `routeTypeOverrides` (exact `route_type` → lineType) in its descriptor for any
agency that deviates. Note: BKK's feed previously left trolleybus (type 11) mapping to `bus`; the
unified resolver classifies it as `trolley`, matching what the frontend route data already shows.

References: [GTFS schedule reference](https://gtfs.org/documentation/schedule/reference/),
[extended route types](https://developers.google.com/transit/gtfs/reference/extended-route-types).

## Feed discovery / registries

- **Mobility Database** — current canonical catalog (replaced TransitFeeds Feb 2024); 6000+ feeds,
  has an API. Best programmatic source for a city's feed URLs + auth metadata.
  [mobilitydatabase.org](https://mobilitydatabase.org/).
- **Transitland Atlas** — open feed registry; per-agency `.dmfr.json` files describe feed URLs.
  [github.com/transitland/transitland-atlas](https://github.com/transitland/transitland-atlas).
- **TransitFeeds** — **deprecated (gone Dec 2025); do not build on it.**

## The per-city descriptor

Defined once and consumed on both sides. Because the feed service deploys standalone and cannot
import from `lib/`, it keeps its own copy under `feed/cities/` (same synced-copy convention as
`feed/pitch.js`). Frontend-facing fields (bounds, center, attribution) are **auto-derived from the
static GTFS during `npm run preprocess`** and embedded in `lines.<city>.json`, so the browser gets
them from the file it already loads.

```js
{
  id: 'helsinki', name: 'Helsinki (HSL)', timezone: 'Europe/Helsinki',
  staticGtfsUrl: 'https://infopalvelut.storage.hsldev.com/gtfs/hsl.zip',
  apiKeyEnv: 'HSL_API_KEY',                       // process.env[...] lookup
  auth: { kind: 'header', name: 'digitransit-subscription-key' },
                                                  // or { kind:'query', name:'key' } / { kind:'none' }
  feeds: [                                        // 1..N — combined / split / sharded
    { url: '…/VehiclePositions.pb', entityTypes: ['vehicle'] },
    { url: '…/TripUpdates.pb',      entityTypes: ['trip'] },
    { url: '…/ServiceAlerts.pb',    entityTypes: ['alert'] },
  ],
  pollMs: 5000, alertMs: 60000,
  modesWithoutVehiclePositions: ['metro'],        // triggers TripUpdate position inference
  routeTypeOverrides: {},                         // optional route_type → lineType tweaks
  bounds: { latMin, latMax, lngMin, lngMax, centerLng }, // feed-side pitch + lng fallback
  attribution: { text: 'Data © HSL', licenseUrl: '…' },
}
```

The note-mapping (`lib/mappings.js`) and the audio engine stay city-agnostic: pitch is computed
per route from each route's **own** bounding box (`routeBounds(stops)` + `geoToMidi(..., bounds)`),
and the city-wide fallbacks read a settable `cityBounds` (`setCityBounds()`), defaulting to
Budapest.

## Gotchas when generalizing

- **Timezones** — read `agency.txt` `agency_timezone`; never hardcode `Europe/Budapest`.
  Cross-midnight service (`24:xx:xx` times) is a classic bug.
- **Coordinate bounds** — derive the bbox from the static GTFS stops, not constants. Budapest's box
  won't fit Helsinki (~60°N) or SF (~37°N). **US cities have negative longitudes**, which break any
  positive-lng assumption — keep pitch/pan on per-route `routeBounds`.
- **Attribution / license** — most feeds require a named attribution string (HSL CC-BY-4.0, 511,
  Swiss ODbL-style, IDFM ETALAB/ODbL). Carry `attribution` per city and surface it in the UI.
- **Rate limits** — keyed APIs enforce per-key quotas; a 5 s poll × N feeds adds up. The feed
  service is a single shared poller fanning out over WebSocket, which keeps us within quota — just
  keep `pollMs` per-city.
- **Agency protobuf extensions** — e.g. NYC's `nyct` extension. The base bindings decode standard
  fields fine; only add extension bindings if you want the extra fields (we don't, for note
  triggering).

## Tooling

- **`gtfs-realtime-bindings`** (MobilityData) is fully agency-agnostic — only the fetch/auth
  wrapper changes per city.
- There's no dominant "normalize any agency to one shape" JS library; the realistic pattern (what
  this codebase does) is: base bindings for decode + a thin per-agency adapter for fetch/auth/URLs
  + a static-GTFS lookup (`gtfsLoader.js`) to resolve route_type, stop coords, and line type.
