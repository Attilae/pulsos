# Pitch maps, transit data, and musical structure

Research date: 2026-10-01. This records the baseline before the pitch feature was implemented. Code inspection and numerical checks establish mapping behavior, but no listening test was performed. The subsequent implementation and verification results are in [pitch-map-feature.md](pitch-map-feature.md).

## Current behavior

Fresh lanes use the **Demand** pitch contour with variety zero. Geographic is still available and is also a compatibility fallback. All seven cities currently have `liveWsUrl: null`, so the shipping experience uses mock playback.

The main mapping is `generatePitchMap` in [lib/mappings.js](../lib/mappings.js). Its conceptual pipeline is:

```mermaid
flowchart LR
  A[Ordered GTFS stops] --> B[Selected contour]
  B --> C[Scale degree]
  C --> D[Root and scale intervals]
  D --> E[Per-stop degree edits]
  E --> F[Octave and chromatic transpose]
  F --> G[Scheduled instrument notes]
```

Timing is calculated separately from pitch: distance through the route places stops on a shared musical grid, and lane resolution and loop windows determine which events play and when. Playback follows a synthetic musical timeline rather than the original GTFS timetable. Arpeggiation adds a further musical transformation after the stop pitches are generated.

### Demand and its scale mapping

Demand is a build-time stop attribute. [scripts/lib/stopSignals.js](../scripts/lib/stopSignals.js) computes average scheduled departures using service calendars, calendar exceptions, and frequency expansion. Platforms are grouped through their parent stations for signal accumulation.

The signal called centrality is the number of distinct serving routes minus one, bounded below by zero. It is not graph betweenness centrality. Each raw departure/centrality signal is transformed with `log1p`, normalized between the city's fifth and ninety-fifth percentiles, and clipped to 0–1. The schedule-derived score is:

```text
demand = 0.65 * normalizedDepartures + 0.35 * normalizedCentrality
```

When a valid passenger-count value exists, its normalized value replaces that schedule score. Otherwise `source` is `schedule`. Thus Demand usually measures service intensity and interchange connectivity; it does not establish actual passenger demand. The value is fixed in the emitted route JSON and does not change with time of day or each playback pass.

For a scale with N pitch classes and variety zero:

```text
d = round(demand * (3*N - 1))
midi = rootMidi + 12*floor(d/N) + scaleIntervals[d mod N]
```

The normal fresh configuration is C major rooted at C3. There are 21 selectable positions, C3 through B5, before lane edits/transposition. The generator itself has generic D4/Dorian defaults, but the ordinary DAW supplies its own root/scale. Older snapshots explicitly retain Geographic through migration. Example:

| Demand | Degree index, starting at zero | Note in C major |
| --- | ---: | --- |
| 0 | 0 | C3 |
| 0.25 | 5 | A3 |
| 0.5 | 10 | F4 |
| 0.75 | 15 | D5 |
| 1 | 20 | B5 |

This is quantization into scale degrees, not a linear frequency conversion. Higher demand means a higher scale position. A one-degree pitch edit means moving to the next scale note, which may be one or two semitones away in a seven-note scale. Octave shift then moves by multiples of twelve semitones; lane chromatic transpose moves by individual semitones and can move notes outside the original scale.

### Geographic and the other contours

Geographic uses the route's own coordinate bounds. Latitude selects a scale note within an octave; longitude selects the octave/register. It uses stop coordinates from static GTFS, not continuously changing vehicle GPS. Route normalization means that the same station can receive different pitches on different routes. Bounds enforce a minimum span of 0.004 degrees on each axis, but that angular width has different physical sizes across axes and cities. Longitude bucket boundaries can create abrupt octave jumps.

The other two available contours are Random walk and Arch. Random walk takes seeded degree steps, influenced by stop spacing, with a pull toward latitude. Arch uses a sine curve over stop index: low at the first and last stop, high in the middle. Both still add longitude-based register. Neither derives its phrase shape from the original timetable.

Variety supplies deterministic perturbation based on route/stop identity, amplified by inter-stop spacing. It does not reroll a new melody on each pass. This differs from note chance, whose random decision is made during playback. Nonzero Geographic variety can expand its degree range toward two octaves while longitude still adds register, so Variety changes range as well as local note choice. Duplicate lanes have different synthetic route IDs, so with nonzero variety they can receive a different melody rather than a strictly transposed copy.

If no stop has a finite demand score, the whole route falls back to Geographic. If only some stops lack scores, those stops use normalized latitude as their scalar input.

### Consistency concerns

1. **Scale chosen while stopped:** a static trace indicates that a fresh lane's selected scale can be omitted from the start configuration. `handleScale` updates `trackScales`, but start constructs `soundModes` from the sparse `trackSoundModes` map. The engine defaults missing entries to C major. Investigate `components/tabs/MixerTab.jsx` around lines 856 and 1135, `lib/engine.js` around lines 1460 and 1478, and `lib/snapshotPlayer.js` around line 65. Browser reproduction is still needed: start a fresh lane, select a different root/scale while stopped, then compare note labels, sound, and MIDI.
2. **Dormant Live mapping:** `handleVehicleCrossed` in MixerTab calculates geographic pitches, then applies octave shift. It does not apply the selected Demand/other contour, per-stop degree edits, or lane chromatic transpose. `triggerLiveNote` accepts that calculated note. The feed also computes a legacy latitude-only pentatonic note in `feed/pitch.js`, but the main DAW caller computes its own. Restoring Live should include a mapping parity check.
3. **Repeated stations:** per-stop pitch, velocity, and chance edits use `stop.id`. A trip visiting the same stop twice therefore cannot give those visits independent edits. Use a stop occurrence identity for event editing and retain station identity separately.
4. **Arpeggiator export:** reconstructed MIDI and session recording represent stop roots rather than every generated arp note. Arp also snaps off-scale roots down into its scale, so a chromatic transpose can behave differently with arp enabled. These are code-trace findings requiring playback/export reproduction.
5. **Live transport is unwired:** the callback described above is passed to MapView, but MapView does not accept or invoke it. Searches found no `new LiveClient` and no callers of the engine's full vehicle/trip/alert handlers. Changing city feed URLs alone therefore does not restore the current DAW's Live path. The earlier project documentation's config-only restoration claim appears stale.

## Measurements using the existing Budapest data

Read-only calculations used the real `generatePitchMap` and `snapStopsToGrid` functions with `public/data/lines.budapest.slim.json`, C3 major, variety zero, and default snapping. All stops in these examples survived snapping. Adjacent repeats and intervals below exclude the final-to-first loop boundary.

| Line | Stops | Demand: unique notes | Demand: range | Demand: adjacent repeats | Geographic: unique notes | Geographic: largest adjacent jump |
| --- | ---: | ---: | --- | --- | ---: | ---: |
| M1 | 11 | 2 | B4–F5 | 8/10 | 8 | 14 semitones |
| M2 | 11 | 3 | B4–F5 | 6/10 | 9 | 12 semitones |
| Tram 4 | 19 | 5 | F4–A5 | 13/18 | 9 | 14 semitones |

M1 has ten stops with demand exactly 0.65; Deák is approximately 0.835. M2 has nine stops at 0.65, plus Deák and Keleti. All these values are schedule-derived. This demonstrates a limitation of using service intensity alone as a melody: many stops on the same line receive identical data. More bins, route normalization, or percentile ranking cannot distinguish exact ties without another feature or an explicit musical transformation.

These statistics do not establish that one contour sounds better. Repeated pitches can be useful in bass and percussion, while wide leaps may work for some instruments. The problem is limited control over these outcomes.

An inspection of all seven full city payloads found generation dates of August 2, 2026 and `ridershipStops: 0` throughout. The current Demand input is therefore schedule-derived in every city. Berlin has 74 routes with repeated stop IDs, so independent occurrence editing has relevance beyond unusual circular routes. Some routes have no note stops; absent direction IDs are one possible cause, not a demonstrated explanation for every empty route.

## What the research supports

**GTFS supplies structured journeys.** A route groups trips; trips specify ordered stop visits. Stop times contain schedule timing and optional distance along the shape. Direction is an optional trip label, not a geographic bearing. Parent stations support grouping platforms. Source: [GTFS Schedule reference](https://gtfs.org/documentation/schedule/reference/).

**Shapes describe the actual travel path.** The official guidance explicitly discourages representing a curved path between stops as a single straight segment. This supports using shape geometry for travel-distance and curvature features. Source: [GTFS shapes guidance](https://gtfs.org/resources/gtfs-schedule-feature-guides/shapes/).

**Live observations have optional features.** Vehicle positions can provide stop sequence/status, measurement timestamp, bearing, and speed; speed is in meters per second. Optional fields cannot be assumed available across cities. Source: [GTFS Realtime reference](https://gtfs.org/documentation/realtime/reference/).

**GPS needs temporal context.** Buildings, signal blockage, and reflected signals can degrade position accuracy. Raw coordinate fluctuations should not immediately become new musical notes. Source: [GPS.gov accuracy explanation](https://www.gps.gov/gps-accuracy-0).

**Map matching can use a sequence of observations.** Newson and Krumm's 2009 work combines spatial noise and plausible path transitions in an HMM. For Leið, a simpler sequence-aware projection onto a known trip shape is a reasonable first experiment; full road-network matching is not automatically necessary. Source: [Microsoft Research, Hidden Markov Map Matching Through Noise and Sparseness](https://www.microsoft.com/en-us/research/publication/hidden-markov-map-matching-noise-sparseness/).

**Scale mapping is an established sonification technique.** The Sonification Handbook demonstrates quantizing values into a pentatonic scale and using separate sound dimensions for values, slopes, and curvature. It supports treating feature choice, mapping, and musical presentation as distinct decisions. Source: [Grond and Berger, Parameter Mapping Sonification](https://sonification.de/handbook/chapters/chapter15/).

**Normalization scope is a design choice.** Highcharts documents mapping within individual series or across shared axes, linear/logarithmic functions, and explicit pitch ranges and scales. Those are useful precedents for making Leið's route/city normalization and register configurable. Source: [Highcharts advanced sonification mapping](https://www.highcharts.com/docs/sonification/advanced-mapping).

**Musical structure requires evaluation.** Tsuchiya and Freeman's 2018 study examines how listeners explore melodies using time and pitch resolution controls. Its findings support evaluating resolution and repetition rather than assuming more notes are better. Source: [ICAD 2018 proceedings, paper beginning on printed page 42](https://repository.gatech.edu/bitstreams/6954f9c6-c2fe-4610-b007-42753b356f53/download).

**Aesthetic mappings are promising, with limited evidence.** The 2025 Data Melodification FM workshop paper explores melody, harmony, rhythm, and unintended emotional meaning. Its evaluation was informal and involved a few listeners trained in classical music; it is inspiration, not proof of an optimal transit mapping. Source: [Zhang, Grellscheid, and Garrison, Data Melodification FM](https://arxiv.org/html/2510.00222v1).

The following design recommendations are my synthesis of those sources and the inspected app, not established GTFS-to-music rules. Coordinates and transit schedules do not imply a natural key or musical scale.

## Recommended improvements, in order

### 1. Establish one pitch resolver

Use one pure calculation for displayed notes, mock playback, Song playback, MIDI export, and Live events. Inputs should explicitly include scale/root, contour, feature normalization, range, variety/seed, occurrence edits, octave, and chromatic transpose. WAV continues to capture the actual output.

Confirm the stopped-scale issue first. Add focused tests for scale/root startup parity, missing signals, repeated stops, and the order of pitch transformations. This prevents new contour work from hiding existing inconsistencies.

### 2. Separate data features from melodic range and shape

Add a one/two/three-octave span and an optional limit on adjacent scale-degree movement. Keep an unrestricted setting for the existing behavior. Resolve the loop-boundary jump as well as internal jumps. For static maps, precompute the complete phrase deterministically so playback and export agree.

Offer city normalization for comparison and route normalization for local variation, explaining the distinction. When the source has exact ties, offer a blend with another meaningful feature rather than presenting normalization as a cure. Demand can also drive accent, velocity, or filter brightness while another feature drives pitch.

### 3. Improve the retained GTFS data

The current preprocessing chooses the first trip in CSV order for each route/direction. Only direction zero supplies note stops. Missing direction IDs can produce a key that fails the later direction-zero lookup. Group trips by direction and ordered stop pattern; select a representative using service-weighted frequency, and retain alternatives when useful. Treat an absent direction as an explicit fallback, not as an accidentally missing route.

Retain `patternId`, representative `tripId`, `shapeId`, `stopSequence`, stop occurrence key, parent station, arrival/departure offsets, timing provenance, and distance provenance. The current distance fallback adds straight-line distances between stops; project stop visits onto the ordered trip shape when possible. Mark straight-line and interpolated fallbacks so downstream mappings know their limits.

### 4. Try mappings that express different properties of the city

| Transit feature | Proposed musical role | Reason and tradeoff |
| --- | --- | --- |
| Demand/service intensity | Accent or brightness; optional pitch component | Retains busy-stop emphasis without making every equally served station the same pitch. |
| Route geometry projected into local meters | Bounded pitch contour | Allows one smooth pitch axis instead of separate latitude/longitude octave buckets. Optional principal-axis projection sacrifices fixed north/east meaning. |
| Distance from a chosen city center | Pitch contour | Can make an inward/outward journey rise and fall; center choice is an explicit artistic decision. |
| Change in heading along the shape | Signed scale-degree movement | Turns become melodic gestures. Use circular angle differences so 359° to 1° is a small turn. Smooth short noisy segments. |
| Inter-stop travel time or distance | Rhythm | Compress a journey into a phrase while preserving relative spacing; retain grid quantization as an adjustable musical constraint. |
| Dwell duration | Note length | Longer stops sustain longer, with bounded durations. Missing/interpolated times need a fallback. |
| Shared station or interchange | Common pitch anchor or chord tone | Connecting lines can share a musical identity. Requires station grouping and a shared harmonic context. |
| Live speed | Modulation rate or brightness | Adds motion without constantly changing the underlying tune. Smooth observations; do not interpret missing speed as zero. |
| Live delay | Controlled rhythmic displacement or tension | Expresses disruption; the amount of displacement needs a cap so the piece remains playable. |

Avoid using cumulative journey distance directly as the sole pitch value if the goal is varied melody: it mostly produces an ascending staircase. Journey progress is more useful as phrase phase; spacing, curvature, central distance, or demand provide non-monotonic features.

### 5. Add optional harmonic coordination

Scale membership alone does not ensure satisfying simultaneous notes. Independent roots, chromatic lane transposes, and unrestricted registers can still clash. An optional shared key and slow chord progression could constrain strong-beat bass/hub events to chord tones, with other notes chosen from the scale. Neighboring voices could prefer nearby pitches.

Pentatonic is a useful preset to audition because it reduces the pitch vocabulary; it is not a guarantee of pleasant music. Keep seven-note scales and independent lane keys available. The musical interpretation should remain editable rather than being inferred from a city's name or coordinates.

### 6. Harden Live before reopening it

Retain trip instance, stop sequence, current status, vehicle measurement timestamp, and data-quality flags in the feed payload. Reject duplicate/out-of-order observations and separate approaching a stop from arriving at it. Event identity should include vehicle, trip instance, and stop occurrence. Prefer supplied sequence/status, then shape progress, then a proximity fallback with hysteresis.

The current feed change predicate can miss coordinate-only updates. Check that alongside city WebSocket wiring before relying on movement modulation. Preserve the stable stop melody and use live data for timing and expression first.

Missing occupancy is currently replaced with 50%; inferred metro vehicles also receive synthetic speed/bearing values. Preserve unknown versus observed versus inferred provenance rather than treating these defaults as measurements. Check static feed cache age as well as cache schema version.

GTFS best practices recommend vehicle/trip data no older than 90 seconds and positions within 200 meters of the trip shape unless a detour applies. These are feed-quality guidelines, not musical trigger thresholds. Source: [GTFS Realtime best practices](https://gtfs.org/documentation/realtime/realtime-best-practices/).

## Suggested experiment

Compare existing Demand, existing Geographic, and a bounded blend of projected geometry plus demand on M1, M2, Tram 4, and routes from other cities. Keep synth, key, BPM, volume, and rhythm fixed while comparing pitch. Then separately compare distance-based and schedule-based rhythm.

Record unique-note count, repeat ratio, interval distribution, largest jump including the loop boundary, register, and sensitivity to missing data. Listen for recognizable motifs, useful bass/lead behavior, pleasant overlaps, and whether changing a stop feature produces an understandable musical change. Include counterexamples such as circular routes, repeated stops, missing directions, short workings, and tied demand scores.

The first implementation should be small: consistent scale application, adjustable register span, bounded movement, and an optional geometry/demand blend. More elaborate network harmony and Live modulation can follow once that comparison establishes a useful musical result.

## Existing proposal to carry forward

[docs/gtfs-salt.md](gtfs-salt.md) already proposes live telemetry as changing seeds for pitch walks, updated at loop boundaries. It is a design proposal, not an implemented path. Current jitter/walks already have deterministic route/stop seeds, and the transport wiring described above is missing. If changing melodies from live telemetry is desired, update that proposal to the current architecture and keep phrase-boundary changes explicit. Hashing telemetry creates variation, but generally does not preserve an interpretable relationship such as higher speed producing higher pitch.
