# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Concept

A web DAW that sonifies live public transport. Each transit line is a track; each station
arrival triggers a note. Budapest (BKK) is the first city; the architecture is meant to stay
city-agnostic (GTFS-RT is a global standard). Inspired by trainjazz.com.

Music-first: every data decision serves the sound, and the UI should feel like a DAW, not a
dashboard.

## Commands

Two processes run side by side in development — **both are required for BKK Live mode**:

```bash
npm run dev        # Vite frontend (default http://localhost:5173)
npm run server     # Node WebSocket + HTTP backend on :3005 (PORT in .env)
```

```bash
npm run build      # Vite production build → dist/
npm run preview    # Serve the production build
npm run preprocess # Regenerate public/data/lines.json from data/budapest_gtfs/
```

There is **no test runner and no linter configured** — don't assume `npm test` exists.

### Environment (.env, gitignored)

- `BKK_API_KEY` — **required**; the server exits on startup without it. Free key from
  https://opendata.bkk.hu/data-sources
- `OPENROUTER_API_KEY` — required only for the AI Composer (`POST /api/compose`)
- `OPENROUTER_MODEL` — optional override (default `anthropic/claude-sonnet-4.5`)
- `PORT` — server port (default 3005)

### Data pipeline gotchas

- `public/data/lines.json` is the preprocessed route/stop/polyline file the **frontend** loads
  (~23 MB, committed). Regenerate it with `npm run preprocess`, which reads the raw GTFS in
  `data/budapest_gtfs/` (gitignored — not in the repo by default).
- The **server** independently downloads + caches the BKK static GTFS to
  `server/cache/gtfs_lookup.json` (gitignored) on first run via `server/gtfsLoader.js`. Bump
  `CACHE_VERSION` there when changing the lookup schema, or delete the cache to force a rebuild.
- The frontend has **no Vite proxy**: it fetches `/data/lines.json` from `public/`, and reaches
  the live backend through hardcoded `http://localhost:3005` / `ws://localhost:3005`
  (`src/liveClient.js`, `src/tabs/MixerTab.jsx`).

## Architecture

### Client/server split

- **Server** (`server/`): polls BKK GTFS-RT protobuf feeds and fans events out over WebSocket.
  - `bkkFeed.js` — `BkkFeed extends EventEmitter`. Polls VehiclePositions + TripUpdates every
    5 s and Alerts every 60 s, diffs against previous state, and emits `arrival`,
    `vehicle_update`, `trip_update`, `alert_update`. Also infers metro train positions from
    TripUpdates (metro has no live VehiclePositions). Exposes `getSnapshot()` for `/api/snapshot`.
  - `gtfsLoader.js` — loads static GTFS into a stop/route/metro-trip lookup; maps GTFS
    `route_type` → DAW line type (`metro`/`tram`/`trolley`/`bus`/`hev`).
  - `index.js` — Express + `ws` server. Broadcasts every feed event to all WS clients; also
    proxies `/api/compose` to OpenRouter (keeps the key server-side, forces JSON output).

- **Frontend** (`src/`): React 19 + Tone.js. `App.jsx` is a 5-tab shell. Each tab loads the
  shared route data via `useRoutes()` (`/data/lines.json`) but otherwise owns its own audio engine.

### The main DAW (Map/DAW tab)

`src/tabs/MixerTab.jsx` is the heart of the app and by far the largest piece of state. It:
- owns **all per-track settings** (volumes, pans, mutes, solos, sound modes, scales, synth types,
  ADSR, filters, EQs, pitch maps + strategies, octave/glide/legato/drone/speed/loop-region, FX
  send matrix, automation lane configs, FX bus state, BPM, master volume),
- instantiates **one `TransitEngine`** (`src/engine.js`) and mirrors every UI change into it via
  `engine.setX(...)` handlers,
- renders three children sharing that state: `DawView.jsx` (the track-lane DAW UI),
  `MapView.jsx` (Leaflet live map), and `AIComposerPanel.jsx`.

Two playback modes, both driven by `TransitEngine`:
- **mock** — `engine.startMock()` schedules `Tone.Part`s that fire notes from each route's
  per-stop pitch map on a synthetic timeline (the city "plays itself" deterministically).
- **live** — `engine.startLive()` + `LiveClient` WebSocket; real BKK arrivals call
  `handleVehicleCrossed` → `engine.triggerLiveNote()`.

### TransitEngine (`src/engine.js`)

The audio graph and the single source of truth for sound. Roughly:

```
per-route synth / VehicleVoice / Sampler
   → per-route insert FX (filter, EQ, pan, volume)
   → per-line-type Volume+Panner bus (metro/tram/trolley/bus/hev)
   → AlertLayer (service-alert-driven reverb + scale/mode)
   → Tone.Destination
   ⇗ parallel FX sends (FxTrack buses: reverb/delay/etc.) via a send matrix
NetworkState (drone hum + hub-convergence chords) → AlertLayer input
```

- Most settings **persist across start/stop** (stored in plain `_xxx` maps on the instance) and
  are re-applied when a synth/part is (re)built.
- Supporting modules: `vehicleVoice.js` (per-vehicle FM voice pool, modulated by speed/occupancy/
  delay), `fxTrack.js` (`FX_BUSES`, `FX_PARAM_SPECS`, `AUTOMATION_TARGETS`, `FxTrack`),
  `automationTrack.js` (`AutomationTrack`, `AUTOMATION_SOURCES` — route a live data field to an
  audio param), `networkState.js` (`NetworkState`), `alertLayer.js` (`AlertLayer`).

### Musical mapping (`src/mappings.js`)

Pure, side-effect-free functions — the place to change *how data becomes music*: `latToNote`
(geographic pitch), the `normalizeX` family (GTFS field → 0..1 for automation), `SCALES`/`MODES`,
seeded RNG (`hashStringToInt`/`mulberry32`/`makeSalt`), and `generatePitchMap` with the
`PITCH_MAP_STRATEGIES` (`geographic`/`randomWalk`/`volatileWalk`/`index`/`random`). `mockData.js`
holds mock-mode data and a duplicate `latToNote` the server imports.

### Persistence & AI

- **Songs**: `persistence.js` (localStorage CRUD) + `songState.js` (`buildSnapshot`/
  `applySnapshot` serialize the whole MixerTab state) + `useSongPersistence.js` (autosave hook) +
  `SongMenu.jsx`. Adding new per-track state means threading it through `buildSnapshot`/
  `applySnapshot` too, not just MixerTab.
- **AI Composer**: `ai/composer.js` builds the system prompt from the live route list and
  validates the model's JSON plan; the server proxies the call; `applyAIPlan` in MixerTab applies
  a plan by **replaying the same handlers a human would click** (order matters — see the comment
  there).

### Other tabs

`DrumMachineTab`, `LoopCapturerTab`, `HeadphoneTab`, `MotifTab` are largely self-contained, each
backed by its own engine in `src/engines/` (`drumEngine`, `loopEngine`, `motifEngine`,
`phonesEngine`). They reuse the same `useRoutes()` data but do not share `TransitEngine`.

### Line → instrument convention

`metro` → pitched lead/bass · `tram`/`trolley` → rhythmic perc · `bus` → pads/textures ·
`hev` → low melodic/cello · MÁV rail → long sustained pads. Line-type colors live in
`LINE_TYPE_COLORS` (`engine.js`).

## Docs

`docs/bkk-api.md` (GTFS-RT field reference), `docs/vst-plugin-plan.md` (planned JUCE VST3/AU port
reusing the existing Node server), `docs/gtfs-salt.md`.

## Planned (not yet wired in)

The root-level `*.js` Pencil scripts (`headphone-orbit.js`, `loop-waveform.js`, `track-viz.js` —
they use the `pencil.*` API with `@schema`/`@input` directives) and the `transport.pen` design
document are generative visualizations intended for future use in the UI. They are not imported
by the app yet — leave them in place.
