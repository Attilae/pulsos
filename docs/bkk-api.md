# BKK Open Data API — Field Reference

Budapest public transport data is exposed via the **GTFS-RT** (General Transit Feed Specification — Realtime) standard plus a daily static **GTFS** ZIP. All real-time feeds use Protocol Buffers binary format.

---

## Authentication

All endpoints require an API key as a query parameter.

```
?key=YOUR_API_KEY
```

Register for a free key at **https://opendata.bkk.hu/data-sources**

---

## Real-Time Feeds

Three binary `.pb` endpoints, all under the same base URL:

```
https://go.bkk.hu/api/query/v1/ws/gtfs-rt/full/
```

| Feed | Endpoint | Update rate |
|---|---|---|
| Vehicle Positions | `VehiclePositions.pb` | Every **5 seconds** |
| Trip Updates | `TripUpdates.pb` | Every **5 seconds** |
| Service Alerts | `Alerts.pb` | Every **60 seconds** |

Parse with [`gtfs-realtime-bindings`](https://github.com/MobilityData/gtfs-realtime-bindings) or any protobuf library using the [GTFS-RT `.proto` schema](https://github.com/google/transit/blob/master/gtfs-realtime/proto/gtfs-realtime.proto).

**Network coverage (as of 2024):**
- 371 routes
- 6,178 stops
- ~1,900 vehicles (metro, trams, buses, trolleybuses, HÉV suburban rail)
- ~43,000 departures per day

---

## Feed 1 — Vehicle Positions

Real-time position and status of every active vehicle.

### Top-level fields

| Field | Type | Description |
|---|---|---|
| `vehicle.id` | string | Internal vehicle identifier — use this as your stable key across polls |
| `vehicle.label` | string | User-visible label (route number or vehicle number) |
| `vehicle.licensePlate` | string | Physical licence plate (rarely used) |
| `trip.tripId` | string | Identifies the scheduled trip this vehicle is running |
| `trip.routeId` | string | Links to `routes.txt` in the static feed |
| `trip.startTime` | string | Scheduled start time of this trip (HH:MM:SS) |
| `trip.startDate` | string | Service date (YYYYMMDD) |
| `timestamp` | uint64 | Unix timestamp (seconds) when position was recorded |

### Position

| Field | Type | Description |
|---|---|---|
| `position.latitude` | float | Current GPS latitude — **required** |
| `position.longitude` | float | Current GPS longitude — **required** |
| `position.bearing` | float | Compass heading in degrees, 0–359, clockwise from north |
| `position.speed` | float | Instantaneous speed in **metres per second** |
| `position.odometer` | double | Cumulative distance travelled in metres |

### Stop status

| Field | Type | Description |
|---|---|---|
| `currentStatus` | enum | See table below |
| `stopId` | string | The stop the vehicle is at or approaching |
| `currentStopSequence` | uint32 | Ordinal index of that stop on this trip |

**`currentStatus` enum values:**

| Value | Name | Meaning |
|---|---|---|
| `0` | `INCOMING_AT` | Vehicle is approaching the stop |
| `1` | `STOPPED_AT` | Vehicle is stationary at the stop (doors open) |
| `2` | `IN_TRANSIT_TO` | Vehicle has departed, travelling to next stop |

### Occupancy

| Field | Type | Description |
|---|---|---|
| `occupancyStatus` | enum | Coarse 9-level bucket (see below) |
| `occupancyPercentage` | uint32 | 0–100+, values above 100 mean overloaded |
| `multiCarriageDetails` | array | Per-carriage breakdown (metro trains with multiple cars) |

**`occupancyStatus` enum values:**

| Value | Name | Approx % |
|---|---|---|
| `0` | `EMPTY` | ~5% |
| `1` | `MANY_SEATS_AVAILABLE` | ~25% |
| `2` | `FEW_SEATS_AVAILABLE` | ~50% |
| `3` | `STANDING_ROOM_ONLY` | ~70% |
| `4` | `CRUSHED_STANDING_ROOM_ONLY` | ~88% |
| `5` | `FULL` | ~100% |
| `6` | `NOT_ACCEPTING_PASSENGERS` | 100% |
| `7` | `NO_DATA_AVAILABLE` | unknown |
| `8` | `NOT_BOARDABLE` | N/A |

**`multiCarriageDetails` array** (when present — mainly metro trains):

Each element describes one carriage:

| Field | Type | Description |
|---|---|---|
| `label` | string | Carriage identifier |
| `occupancyStatus` | enum | Same enum as above, per carriage |
| `occupancyPercentage` | uint32 | Per-carriage percentage |

### Congestion

| Field | Type | Description |
|---|---|---|
| `congestionLevel` | enum | Road traffic state around the vehicle |

| Value | Name |
|---|---|
| `0` | `UNKNOWN_CONGESTION_LEVEL` |
| `1` | `RUNNING_SMOOTHLY` |
| `2` | `STOP_AND_GO` |
| `3` | `CONGESTION` |
| `4` | `SEVERE_CONGESTION` |

---

## Feed 2 — Trip Updates

Predicted arrival/departure times and schedule deviations for each active trip.

### Top-level fields

| Field | Type | Description |
|---|---|---|
| `trip.tripId` | string | Identifies which scheduled trip this update is for |
| `trip.scheduleRelationship` | enum | Whether this trip is running as planned (see below) |
| `vehicle.id` | string | The vehicle running this trip — matches `vehicle.id` in Vehicle Positions |
| `timestamp` | uint64 | When this prediction was generated (Unix seconds) |
| `delay` | int32 | **Overall trip delay in seconds.** Positive = late, negative = early. |

### `scheduleRelationship` enum (trip-level)

| Value | Name | Meaning |
|---|---|---|
| `0` | `SCHEDULED` | Running as planned |
| `1` | `ADDED` | An extra unscheduled trip |
| `2` | `UNSCHEDULED` | Frequency-based service without a fixed schedule |
| `3` | `CANCELED` | This trip will not run |
| `5` | `REPLACEMENT` | Replaces a cancelled trip |
| `6` | `DUPLICATED` | Duplicate of another trip (extra service) |
| `7` | `DELETED` | Trip has been removed from service |

### Per-stop predictions (`stopTimeUpdate` array)

Each element is a prediction for one stop on the trip, ordered by sequence:

| Field | Type | Description |
|---|---|---|
| `stopSequence` | uint32 | Position of this stop in the trip |
| `stopId` | string | Which stop |
| `arrival.time` | int64 | Predicted Unix arrival timestamp |
| `arrival.delay` | int32 | Seconds early/late at this stop |
| `arrival.uncertainty` | int32 | Confidence in seconds (0 = certain; higher = less confident) |
| `departure.time` | int64 | Predicted Unix departure timestamp |
| `departure.delay` | int32 | Seconds early/late at departure |
| `departure.uncertainty` | int32 | Confidence at departure |
| `departureOccupancyStatus` | enum | Expected occupancy *after* this stop (same enum as vehicle positions) |
| `scheduleRelationship` | enum | Stop-level override (see below) |

**`scheduleRelationship` enum (stop-level):**

| Value | Name | Meaning |
|---|---|---|
| `0` | `SCHEDULED` | Normal stop |
| `1` | `SKIPPED` | Vehicle will not stop here |
| `2` | `NO_DATA` | No prediction available |
| `3` | `UNSCHEDULED` | Stop added for frequency-based service |

---

## Feed 3 — Service Alerts

Disruptions, detours, and service changes. Updated every 60 seconds.

### Top-level fields

| Field | Type | Description |
|---|---|---|
| `activePeriod` | array | Time windows when the alert is active — each has `start` and `end` (Unix timestamps) |
| `informedEntity` | array | Which parts of the network are affected (see below) |
| `cause` | enum | Why the disruption is happening |
| `effect` | enum | What impact it has on service |
| `severityLevel` | enum | How severe |
| `headerText` | TranslatedString | Short summary (multilingual) |
| `descriptionText` | TranslatedString | Full description (multilingual) |
| `url` | TranslatedString | Link to external info page |
| `causeDetail` | TranslatedString | Agency-specific cause description |
| `effectDetail` | TranslatedString | Agency-specific effect description |

### `informedEntity` array

Each element scopes the alert to part of the network. Multiple elements mean the alert applies to all of them:

| Field | Type | Description |
|---|---|---|
| `agencyId` | string | Entire agency affected |
| `routeId` | string | Specific route affected |
| `routeType` | int32 | Entire vehicle type affected (0=tram, 1=metro, 2=rail, 3=bus…) |
| `directionId` | uint32 | Only one direction (0 or 1) |
| `stopId` | string | Specific stop affected |
| `trip` | TripDescriptor | Specific trip affected |

### `cause` enum

| Value | Name |
|---|---|
| `1` | `UNKNOWN_CAUSE` |
| `2` | `TECHNICAL_PROBLEM` |
| `3` | `STRIKE` |
| `4` | `DEMONSTRATION` |
| `5` | `ACCIDENT` |
| `6` | `HOLIDAY` |
| `7` | `WEATHER` |
| `8` | `MAINTENANCE` |
| `9` | `CONSTRUCTION` |
| `10` | `POLICE_ACTIVITY` |
| `11` | `MEDICAL_EMERGENCY` |
| `12` | `OTHER_CAUSE` |

### `effect` enum

| Value | Name |
|---|---|
| `1` | `NO_SERVICE` |
| `2` | `REDUCED_SERVICE` |
| `3` | `SIGNIFICANT_DELAYS` |
| `4` | `DETOUR` |
| `5` | `ADDITIONAL_SERVICE` |
| `6` | `MODIFIED_SERVICE` |
| `7` | `STOP_MOVED` |
| `8` | `NO_EFFECT` |
| `9` | `UNKNOWN_EFFECT` |
| `10` | `ACCESSIBILITY_ISSUE` |
| `11` | `OTHER_EFFECT` |

### `severityLevel` enum

| Value | Name |
|---|---|
| `0` | `UNKNOWN_SEVERITY` |
| `1` | `INFO` |
| `2` | `WARNING` |
| `3` | `SEVERE` |

---

## Static Feed — GTFS ZIP

Downloaded once daily (or on first run). Contains the reference data that the real-time feeds link to by ID.

```
https://go.bkk.hu/api/static/v1/public-gtfs/budapest_gtfs.zip
```

License: **CC0 1.0** (public domain)

### Key files

#### `stops.txt`

| Column | Description |
|---|---|
| `stop_id` | Unique ID — matches `stopId` in real-time feeds |
| `stop_name` | Human-readable name |
| `stop_lat` | Latitude |
| `stop_lon` | Longitude |
| `stop_code` | Short passenger-facing code |
| `location_type` | 0=stop, 1=station, 2=entrance, 3=node, 4=boarding area |
| `parent_station` | For hierarchical stops (platform inside a station) |
| `platform_code` | Platform letter/number |
| `wheelchair_boarding` | 0=unknown, 1=accessible, 2=not accessible |

#### `routes.txt`

| Column | Description |
|---|---|
| `route_id` | Unique ID — matches `routeId` in real-time feeds |
| `route_short_name` | The number/letter passengers see (e.g. "4", "M2", "H5") |
| `route_long_name` | Full descriptive name |
| `route_type` | Vehicle type (see below) |
| `route_color` | Official hex colour (without `#`) |
| `route_text_color` | Text colour for contrast |

**`route_type` values used by BKK:**

| Value | Vehicle type |
|---|---|
| `0` | Tram (villamos) |
| `1` | Metro (metró) |
| `2` | Rail / MÁV intercity |
| `3` | Bus (busz) |
| `109` | HÉV suburban rail |
| `800` | Trolleybus (trolibusz) |

#### `trips.txt`

| Column | Description |
|---|---|
| `trip_id` | Unique ID — matches `tripId` in real-time feeds |
| `route_id` | Which route |
| `service_id` | Links to `calendar.txt` for which days it runs |
| `trip_headsign` | Destination shown on vehicle front |
| `direction_id` | `0` = outbound, `1` = inbound |
| `block_id` | Groups sequential trips served by the same physical vehicle |
| `shape_id` | Links to `shapes.txt` for the route geometry |

#### `stop_times.txt`

Scheduled arrival and departure time at every stop for every trip.

| Column | Description |
|---|---|
| `trip_id` | Which trip |
| `stop_id` | Which stop |
| `stop_sequence` | Order of this stop on the trip |
| `arrival_time` | Scheduled arrival (HH:MM:SS — can exceed 24:00 for overnight) |
| `departure_time` | Scheduled departure |
| `shape_dist_traveled` | Cumulative metres along the route polyline at this stop |
| `timepoint` | `1` = exact time, `0` = approximate |
| `pickup_type` | `0` = regular, `1` = no pickup, `2` = phone ahead, `3` = coordinate with driver |
| `drop_off_type` | Same codes as `pickup_type` |

#### `shapes.txt`

The precise polyline geometry for each route, one row per point:

| Column | Description |
|---|---|
| `shape_id` | Links from `trips.shape_id` |
| `shape_pt_lat` | Latitude of this polyline point |
| `shape_pt_lon` | Longitude |
| `shape_pt_sequence` | Order along the route |
| `shape_dist_traveled` | Cumulative metres from the first point |

#### `frequencies.txt`

For frequency-based services (where vehicles run "every N minutes" rather than at fixed times):

| Column | Description |
|---|---|
| `trip_id` | Which trip this headway applies to |
| `start_time` | Start of this headway window |
| `end_time` | End of this headway window |
| `headway_secs` | Seconds between successive departures |
| `exact_times` | `0` = approximate headway, `1` = exact dispatch times |

#### `calendar.txt` / `calendar_dates.txt`

Define which `service_id` values run on which days, and any holiday overrides.

---

## Correlating the feeds

| You have | You want | How |
|---|---|---|
| `stopId` (real-time) | Stop name, coordinates | Look up in `stops.txt` keyed by `stop_id` |
| `routeId` (real-time) | Route name, colour, vehicle type | Look up in `routes.txt` keyed by `route_id` |
| `tripId` (Vehicle Position) | Schedule deviation | Match to `tripId` in Trip Updates |
| `vehicleId` (VP) | Delay data | Match `vehicle.id` in Trip Updates |
| `tripId` (Trip Update) | Route geometry | → `trips.shape_id` → `shapes.txt` |
| `tripId` + `stopSequence` | Scheduled time | Look up in `stop_times.txt` |

---

## Practical notes

- The real-time feeds contain only **currently active** vehicles. A vehicle that has finished its trip or is in the depot will disappear between polls.
- `vehicle.id` is the most stable identifier across polls. `entity.id` (the feed entity ID) is a fallback when `vehicle.id` is absent.
- `occupancyPercentage` is not available for all vehicle types — fall back to `occupancyStatus` when it is `null`.
- `position.bearing` and `position.speed` may be absent (field not set) even when `latitude`/`longitude` are present.
- `trip.delay` at the trip level is the most convenient source of overall lateness. Per-stop `arrival.delay` is more granular but requires iterating `stopTimeUpdate`.
- The static GTFS ZIP is regenerated daily. The real-time feeds reference IDs that exist in the static data, so re-download the ZIP periodically (the app caches it in `server/cache/`).
