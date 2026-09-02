# Stop demand signals

The static route preprocessor enriches every emitted stop with a compact
`signals` object. The browser never calls passenger-data APIs; source data is
joined once at build time and travels with `lines.<city>.json` (and its slim
copy).

```json
{
  "id": "stop-id",
  "name": "Central Station",
  "lat": 47.0,
  "lon": 8.0,
  "signals": {
    "departures": 412.5,
    "routes": 6,
    "centrality": 0.72,
    "demand": 0.84,
    "source": "schedule",
    "ridership": 18420
  }
}
```

- `departures` is the estimated departures on an average service day. GTFS
  calendars, calendar exceptions, and frequency-based trips are included.
- `routes` is the number of distinct routes serving the stop or parent station.
- `centrality` is a city-normalized transfer score (`routes - 1`).
- `demand` is the 0–1 pitch signal. It uses ridership when available; otherwise
  it combines normalized departures (65%) and centrality (35%).
- `source` records which branch won. `ridership` is only emitted when matched.

Values are log-normalized between the city's 5th and 95th percentiles so a
single major hub cannot collapse the rest of the melody into its lowest notes.
The DAW's **Demand** pitch contour maps `demand` across the lane's full scale
register. It is the **default contour** for new lanes (as of snapshot schema
version 4; songs saved before that are migrated with every lane pinned to
Geographic, so they still play what they were saved with). Demand falls back to
Geographic when an older route file has no signals.

## Optional ridership exports

Ridership source files are intentionally ignored by Git. Put downloads in
`data/<city>_ridership/`, then run the normal `npm run preprocess:<city>` and
`node scripts/slim_lines.js --city <city>` commands. Missing directories never
fail a build; the schedule signal remains complete for all seven cities.

### New York

Supported cached CSV filenames:

- `subway.csv`: MTA Subway Hourly Ridership. The adapter recognizes
  `station_complex`, `station_complex_id`, `ridership`, `latitude`, and
  `longitude`. Station name plus coordinates bridges station-complex IDs to the
  subway GTFS parent stop.
- `bus.csv`: MTA Bus Stop Level Ridership. The adapter recognizes `stop_id`,
  `boardings`, and `alightings`. The current Leið MTA feed is subway-only, but
  this is ready for a future combined feed.
- `ridership.csv`: optional canonical/fallback filename.

Official datasets:

- https://data.ny.gov/d/5wq4-mkjj
- https://data.ny.gov/d/fvdm-uavx

### Zürich

Place the native VBZ files `REISENDE.csv` and `HALTESTELLEN.csv` in
`data/zurich_ridership/`. The adapter sums `Einsteiger + Aussteiger` and uses
the matching table's `Haltestellenlangname` to bridge VBZ internal IDs to Swiss
GTFS SLOIDs. A canonical `ridership.csv` is also accepted.

Official dataset:

- https://data.stadt-zuerich.ch/dataset/vbz_fahrgastzahlen_ogd

### Helsinki

Place HRI CSV or GeoJSON exports in `data/helsinki_ridership/`. The adapter
accepts common English/Finnish boarding fields and joins by stop ID, normalized
name, then coordinates. HRI's newer Espoo download is a GeoPackage; export its
point layer to GeoJSON first so preprocessing remains dependency-free.

Official catalog:

- https://hri.fi/data/en_GB/dataset/hsl-n-nousijamaarat-pysakeittain
- https://hri.fi/data/en_GB/dataset/espoon-joukkoliikennenousut

## Canonical fallback CSV

All three adapters accept a `ridership.csv` with any useful subset of:

```csv
stop_id,stop_name,latitude,longitude,ridership,boardings,alightings
```

Matching priority is exact GTFS stop ID, then normalized name (disambiguated by
coordinates), then the nearest stop within 250 metres. Child platforms inherit
their parent station's signals.
