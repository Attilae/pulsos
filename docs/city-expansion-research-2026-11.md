# City expansion research

Researched: 4 November 2026. Scope: additions beyond Budapest, Helsinki, Berlin, Prague, New York, Zürich and Warsaw.

Implementation follow-up: [per-city plans and status](city-expansion/README.md). Vienna is now implemented on the feature branch; the findings below record the initial research.

## Recommendation

Start with **Stockholm, Boston and Brisbane**, then **Kuala Lumpur, Vienna and Reykjavík**. This balances practical data access, geographic expansion and distinctive route networks. These priorities are product judgments, not measured demand or tested integration results.

Leið currently runs every city in mock mode. Static GTFS availability therefore determines whether we can add a city now; live feeds are a separate future capability. A published GTFS-RT feed does not guarantee vehicle coordinates, observed arrivals, matching IDs, or compatibility with the existing feed implementation.

## Candidate comparison

Effort below is relative and provisional, assuming the existing preprocessing pipeline. No feed archives were imported or live feeds decoded during this research.

| Priority | City / scope | Static data | Future live path | Access and constraints | Assessment |
| --- | --- | --- | --- | --- | --- |
| 1 | Stockholm / SL | Daily GTFS Regional | GTFS-RT trip updates, positions and alerts | API key; CC0. Bronze live allowance is 30,000 calls/month; Silver is 2 million. Extended route types and calendar exceptions need attention. | Strong first European addition; low–medium effort. [Trafiklab](https://www.trafiklab.se/api/gtfs-datasets/gtfs-regional/) |
| 2 | Boston / MBTA | Official GTFS archive | Official protobuf trip updates, positions and alerts | Direct CDN feeds are documented separately from the keyed V3 JSON API. MBTA has its own developer license agreement to review before release. | Strong next US city; low–medium effort. [MBTA data and license documentation](https://github.com/mbta/gtfs-documentation), [live feeds](https://github.com/mbta/gtfs-documentation/blob/master/reference/gtfs-realtime.md) |
| 3 | Brisbane / South East Queensland | GTFS for bus, train, ferry and tram services | GTFS-RT trip updates, positions and alerts, including mode-specific endpoints | No authentication; CC BY 4.0. Regional coverage needs explicit geographic/operator filtering if labelled Brisbane. | Particularly clean access model; low–medium effort. [Translink](https://translink.com.au/about-translink/open-data) |
| 4 | Kuala Lumpur / Rapid KL | Separate rail, bus and feeder GTFS categories | Bus vehicle-position feeds; rail live feed is documented as unstable/unavailable | Static and live CC BY 4.0. Live updates every 30 seconds; no trip updates or alerts currently documented. About 2% of Rapid KL bus trips are excluded from static stop times. | Good first Asian addition in mock mode; medium effort, with separate feed categories to combine. [Schedules](https://developer.data.gov.my/realtime-api/gtfs-static.en), [live coverage](https://developer.data.gov.my/realtime-api/gtfs-realtime) |
| 5 | Vienna / Wiener Linien | Official GTFS listing | Operator-specific departure API | Operator states CC BY and no API key. A third-party GTFS-RT converter exists, but should not be mistaken for an official operator feed. | Good static-first candidate; low–medium effort for mock, higher for live. [Official GTFS catalogue](https://www.data.gv.at/datasets/ab4a73b6-1c2d-42e1-b4d9-049e04889cf0?locale=de), [operator open data](https://museum.wienerlinien.at/web/guest/open-data) |
| 6 | Reykjavík / Strætó | Public GTFS ZIP, including route geometry and stop times | Application required for live bus-location access | Static download is available; reuse conditions and live format/access terms still need confirmation. Restrict regional routes deliberately. | Strong connection to Leið's Icelandic identity; bus-only scope offers less mode variety. [Strætó](https://www.straeto.is/en/about-straeto/open-data) |
| 7 | Sydney / TfNSW | GTFS, including a timetable dataset designed for realtime matching | Mode-specific GTFS-RT feeds | API key; documented live refresh is 15 seconds. Check each selected dataset's license; TfNSW permits reuse for datasets carrying CC BY 4.0. | Attractive later addition; medium effort across multiple feeds. [Dataset documentation](https://opendata.prod.transport.nsw.gov.au/developers/documentation), [access, refresh and reuse FAQ](https://opendata.transport.nsw.gov.au/faqs) |
| 8 | Oslo / Ruter | Entur regional/national GTFS exports | RUT trip updates and alerts | Entur lists static data under NLOD. Its coverage table does **not** list RUT vehicle positions. GTFS-RT refreshes every 15 seconds. | Good mock candidate; future live mapping may require inferred positions or another source. [Schedules](https://developer.entur.no/open-data/timetable), [live coverage](https://developer.entur.no/open-data/realtime) |
| 9 | Amsterdam / GVB | Public Netherlands-wide GTFS through OVapi | Public GTFS-RT resources are listed | Large national archive requires filtering. GVB-specific live coverage, ID matching and the converted feed's applicable terms remain unverified; do not infer city coverage from a national feed listing. | Promising static candidate, medium effort. [Published feeds](https://gtfs.ovapi.nl/nl/), [underlying NDOV data portal](https://data.ndovloket.nl/) |
| 10 | Paris / Île-de-France | Regional GTFS, published three times daily | PRIM SIRI Lite arrivals APIs | Account and API-specific quotas. The catalogue lists 1,000 requests/day for bulk next arrivals and 1 million/day for unit requests. Dataset-specific reuse terms need review. | High recognition, medium effort for mock and higher for live adaptation. [Official national catalogue](https://transport.data.gouv.fr/datasets/reseau-urbain-et-interurbain-dile-de-france-mobilites?locale=fr) |
| 11 | San Francisco / selected Bay Area agencies | Agency-specific or consolidated GTFS | GTFS-RT trip updates, positions and alerts | Token required. Default quota: 60 requests/hour, with increases by request. Provider data agreement applies. Choose agencies and verify mode coverage. | Feasible mock addition; live is quota-gated. [511 official portal](https://511.org/open-data/transit) |

## Product fit

For a music-first product, I would audition route collections rather than rank cities only by size. Stockholm and Vienna are candidates for contrasting rail and surface routes; Brisbane brings river-oriented route geometry; Boston expands the US selection; Kuala Lumpur adds an Asian network; Reykjavík offers a distinctive connection to the name. These are creative hypotheses to test after import, not claims about how the cities will sound.

London deserves a later investigation: TfL provides open data and a Unified API, but the pages reviewed do not establish a ready-to-import official GTFS package. Confirm the schedule source and conversion work before estimating it alongside direct GTFS imports. [TfL open data](https://tfl.gov.uk/info-for/open-data-users/), [API documentation](https://tfl.gov.uk/info-for/open-data-users/api-documentation).

## Rollout and acceptance checks

1. Pilot Stockholm, Boston and Brisbane independently in mock mode. Validate an actual archive before committing to a public release order.
2. Check route types, stop ordering, shapes, calendar exceptions, frequency trips, route-ID stability, and source attribution. Filter regional feeds so the city label matches the included network.
3. Generate full and slim payloads plus the server route index. Review payload size and audition representative short, long and branching routes on desktop and phone.
4. Add Kuala Lumpur for geographic breadth; Vienna and Reykjavík for product identity and route variety, once their remaining source/access questions are resolved.
5. Assess live support separately. At five-second polling, one endpoint uses 17,280 requests/day, or 518,400 per 30 days. Stockholm's Bronze quota and 511's default quota cannot sustain that. Poll at the source's useful cadence and budget separately for each endpoint.
6. For live trials, decode sample feeds, measure ID match rates and staleness, distinguish predictions from observed arrivals, and verify position availability per mode. Existing app-wide Live disablement remains a separate release decision.

This is a source-based feasibility study. It does not establish feed uptime, successful imports, final license clearance, integration completion, or listener demand. The research itself changed no city configuration; subsequent implementation is tracked in the linked plans.
