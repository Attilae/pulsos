# GTFS-as-Salt — Design / Taxonomy

> **Deliverable: design only.** This document classifies BKK GTFS / GTFS-RT fields by their
> fitness as a randomness "salt," and specifies how a **volatile (live-entropy)** salt would
> feed the three generative surfaces. Implementation of the salt itself is a follow-up.
> Field references throughout point at [`docs/bkk-api.md`](./bkk-api.md).

## Context

The app turns transit data into music. Today the "random" parts of note generation use raw
`Math.random()`, which is disconnected from the data:

- `generatePitchMap()` (`src/mappings.js:369`) — `randomWalk` / `random` strategies for the
  DAW **stop-rail** (one note per stop on a track).
- `randomFromScale()` (`src/mappings.js:108`) — the **per-event fallback** note when no pitch
  map exists (live mode, MixerTab randomize).
- MotifTab **reroll** (`src/tabs/MotifTab.jsx:64` → `motifEngine.js:20`) — `seed` is a
  `Math.random()` float used only as a positional offset into the route.

The idea: drive that randomness from **GTFS data as a salt** so the notes are a product of the
live network, not a coin flip. The *same* salt vocabulary also drives parameter automation —
which is already half-built in `AutomationTrack` (`src/automationTrack.js`) where volatile
fields (delay, occupancy, speed, bearing, congestion) map to instrument params.

The chosen character is **volatile**: the salt is (re)derived from live fields each poll/event,
so the music keeps shifting as the network moves — generative, never frozen.

---

## Salt taxonomy — which GTFS fields, and why

Every field below comes from `docs/bkk-api.md`. Two axes matter: **stability** (does it change
between polls?) and **entropy** (how many distinct values / how unpredictable?). For a *volatile*
salt we want high-entropy fields that move on every poll.

### Tier 1 — prime volatile salt (high entropy, changes constantly)

| Field | Feed | Type | Why it's good salt |
|---|---|---|---|
| `timestamp` (uint64, Vehicle Positions) | every 5 s | continuous | Monotonic, unique each poll. The master entropy clock — mix into every seed. |
| `position.odometer` (double, metres) | every 5 s | continuous | Cumulative, never repeats, differs per vehicle. Excellent fine-grained entropy. |
| `position.speed` (m/s) | every 5 s | continuous | Noisy real-world float; jitters constantly while moving. |
| `position.bearing` (0–359°) | every 5 s | continuous | Turns with the route; good circular entropy (already used for pan). |
| `delay` / `arrival.delay` (int32 s) | every 5 s | semi-continuous | Drifts with traffic; the network's "mood." Already an automation source. |
| `arrival.uncertainty` (int32 s) | every 5 s | semi-continuous | Literally a confidence/noise measure — chaotic by nature. |
| `occupancyPercentage` (0–100+) | every 5 s | bucketed | Rises/falls over a trip; coarser but live. |
| `congestionLevel` (0–4) | every 5 s | low-cardinality | Few values — weak alone, useful mixed in. |

### Tier 2 — semi-stable salt (changes slowly; "drift" terms)

| Field | Type | Role in a volatile scheme |
|---|---|---|
| `trip.startTime` / `trip.startDate` | per trip / per day | Slow drift — make a line re-voice across trips/days without per-poll chaos. |
| `currentStopSequence` / `stopId` | per stop | Advances stop-by-stop — natural step counter for a salted walk along the rail. |
| `occupancyStatus` (enum 0–8) | per stop-ish | Coarse bucket; pairs with `occupancyPercentage`. |

### Tier 3 — identity salt (constant; *fingerprint*, not volatile)

> Excluded as the primary driver under the volatile choice, but documented because mixing one
> identity term into the seed keeps each line recognizable while the volatile terms move it.

`vehicle.id`, `trip.tripId`, `trip.routeId`, `shape_id`, `block_id` (strings → hash);
`stop_id`, `shape_dist_traveled`, `stop_lat/lon`; `route_color` (hex → int directly).

### Not salt (avoid)

Enumerated low-cardinality status that the engine already maps *meaningfully* —
`currentStatus`, `scheduleRelationship`, alert `cause`/`effect`/`severity`. These should keep
driving structure deterministically (ADSR, mode switches), not be burned as entropy.

---

## How a volatile salt feeds each surface

The common primitive (to be added to `src/mappings.js` in the build phase): a deterministic PRNG
seeded from a salt, so "random" is a pure function of GTFS values.

```
hashStringToInt(str)   // xmur3 / FNV-1a → uint32   (for string IDs)
mulberry32(seed)       // uint32 → () => float 0..1  (fast seeded PRNG)
makeSalt(...parts)     // mix mixed string|number parts → one uint32 seed
```

Volatile recipe: `seed = makeSalt(timestamp, odometer ?? delay ?? 0, identityHash)` — Tier-1
terms dominate, one Tier-3 term keeps the line's flavor.

### 1. DAW stop-rail — `generatePitchMap()` (`src/mappings.js:369`, consumed at `engine.js:925`)

- Add an optional `rng` argument; `randomWalk` / `random` call `rng()` instead of `Math.random()`.
- Add a `'volatileWalk'` strategy: a scale-degree random walk whose `rng` is seeded from the
  current live salt, re-seeded each poll cycle. Result: the rail's note sequence re-rolls as the
  network state changes (new timestamp/odometer/delay) but is internally coherent within a frame.
- Engine wiring: `_buildRoutePart` would refresh the salted map on a cadence (e.g. each loop or
  on significant delay change) rather than once at part build.

### 2. Per-event fallback — `randomFromScale()` (`src/mappings.js:108`, called at `engine.js:936`)

- Add an optional `rand` arg defaulting to `Math.random`.
- In `handleVehicleUpdate` (`engine.js:717`), the live event already carries `delay`, `speed`,
  `occupancyPct`, `lat/lng`. Seed a per-event PRNG from those + the (to-be-plumbed) `timestamp`,
  and pass `rand` in. The fallback note then reflects the vehicle's live state at that instant.

### 3. MotifTab reroll — (`src/tabs/MotifTab.jsx:64`, `motifEngine.js:20`)

- `seed` stays a float but is sourced from a live GTFS field instead of `Math.random()`:
  a "Salt source" dropdown (timestamp / odometer / delay / occupancy) feeds `setSeed`.
- Optional auto-reroll: poll the chosen field and update `seed`, so motifs evolve live and the
  exported MIDI is a snapshot of the network at download time.

---

## Parameter automation (already built — note for completeness)

`AutomationTrack` (`src/automationTrack.js`) + `AUTOMATION_SOURCES` already consume the Tier-1/2
volatile fields (`arrival.delay`, `delay.delta`, `dwell.deviation`, `uncertainty`, `occupancy`,
`speed`, `congestion`, `bearing.*`) via the `normalize*` helpers in `mappings.js:295–358`,
mapping each to 0–1 and onto synth/FX params in `engine.js:_applyAutomation`. Gaps a build pass
could close: add `odometer` and `timestamp` as automation sources for the longest, smoothest
sweeps. No redesign needed — this confirms the salt vocabulary is consistent across both halves
(notes + automation).

---

## Open implementation notes (for the follow-up build)

- **Plumb `timestamp`**: the per-poll vehicle timestamp is the master entropy term but isn't
  currently threaded into `handleVehicleUpdate`'s `data`. Add it at the server/feed boundary
  (`server/bkkFeed.js`) and through the event shape.
- **Determinism vs. liveness tradeoff**: pure volatile = notes never stable. If that feels too
  unstable in testing, quantize the volatile term (e.g. floor `timestamp` to the loop boundary)
  so it re-rolls once per loop, not per poll.
- **No mock-feed entropy**: mock playback has no live timestamp/odometer — fall back to a seeded
  walk keyed off stop ids so mock mode is still deterministic and demoable.

## Verification (for the build phase, not this pass)

- Unit: `mulberry32` + `makeSalt` produce identical streams for identical salts, divergent for
  different ones; `generatePitchMap(..., rng)` is reproducible given a fixed `rng`.
- Manual: run the app (`npm run dev`), play a line in DAW view, confirm the stop-rail notes shift
  as live delay/occupancy change and that MotifTab reroll tracks the chosen salt source.
