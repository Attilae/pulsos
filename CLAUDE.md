# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Note:** `AGENTS.md` at the repo root is a near-verbatim copy of this file for Codex. When you
> change architectural guidance here, mirror the same edit into `AGENTS.md` so the two don't drift.

## Concept

A web DAW that sonifies live public transport, branded **"Leið"** (Icelandic for "the way/route";
the title lives in `app/layout.jsx`). Each transit line is a track; each station
arrival triggers a note. Budapest (BKK) was the first city; the app is now **multi-city**
with a runtime city picker — **seven cities**: Budapest, Helsinki/HSL, Berlin/VBB, Prague/PID,
New York/MTA, Zürich/ZVV, and Warsaw/ZTM — via a per-city descriptor abstraction.
GTFS-RT is a global standard, so adding a city needs config, not engine changes. **Live mode is
currently disabled app-wide** (every city's `liveWsUrl` is `null` in `lib/shared/cities.js`, so
all cities run mock-only and the Live toggle is disabled); the descriptors and `startLive` path
are intact, so restoring Live is a config change (see that file's inline comments). See
`docs/multi-city-gtfs.md` and the **Multi-city** section below. Inspired by trainjazz.com.

Music-first: every data decision serves the sound, and the UI should feel like a DAW, not a
dashboard.

## Topology

The app is a **Next.js (App Router) app deployed on Vercel** plus a **separate always-on feed
service**. The feed can't run on Vercel serverless (it's a stateful 5 s poller broadcasting
over WebSocket), so it's a standalone Node process (Railway/Fly/Render/Docker). See
`docs/nextjs-migration-plan.md` for the full rationale and migration history.

```
Next app (Vercel)                          feed service (always-on)
  app/         Next routes + API       ──WS──▶  feed/index.js  (GTFS-RT poll + WS fan-out)
  components/  React UI (client-only)   proxy   feed/bkkFeed.js, gtfsLoader.js, pitch.js
  lib/         auth, DB, persistence, audio engine, mappings    feed/cities/  (per-city descriptors)
  public/      lines.<city>.json, static
```

## Commands

```bash
npm run dev        # Next dev server (http://localhost:3000)
npm run feed       # feed service: WS + HTTP on :3005 (CITY + PORT in feed env; default city budapest)
```

Both are required for **Live** mode. `npm run dev` alone is enough for **mock** mode.

```bash
npm run build      # next build
npm run start      # serve the production build
npm run preprocess:budapest  # regenerate public/data/lines.budapest.json (+ mirror to lines.json)
npm run preprocess:helsinki  # regenerate public/data/lines.helsinki.json
npm run preprocess:berlin    # regenerate public/data/lines.berlin.json
npm run preprocess:prague    # regenerate public/data/lines.prague.json
npm run preprocess:newyork   # regenerate public/data/lines.newyork.json
npm run preprocess:zurich    # regenerate public/data/lines.zurich.json
npm run preprocess:warsaw    # regenerate public/data/lines.warsaw.json
# generic form: node scripts/preprocess_lines.js --city <id> [--gtfs data/<id>_gtfs]
npm run upload:lines # upload public/data/lines.json to Vercel Blob (needs BLOB_READ_WRITE_TOKEN)
npm run db:generate # drizzle-kit: emit SQL migration from lib/db/schema.js
npm run db:migrate  # drizzle-kit: apply migrations to DATABASE_URL
npm run db:push     # drizzle-kit: push schema directly (dev)
npm test            # node --test — the only tests so far are billing/entitlement logic
```

`npm test` runs the built-in Node test runner (`node --test`). Coverage is **minimal** — two
files, both pure logic: `test/billing-plans.test.js` (`lib/billing/plans.js`) and
`test/ai-plan-apply.test.js` (`lib/ai/planApply.js` + `lib/shared/cityFacts.js`). There is **no
linter configured** and the audio/UI code has no tests. Don't assume broad test coverage exists.
Run a single test file with `node --test test/ai-plan-apply.test.js`.

### Environment

**Next app** (`.env`, gitignored — see `.env.example`):
- `DATABASE_URL` — Postgres (Vercel Postgres / Neon). Required for auth + presets.
- `BETTER_AUTH_SECRET` (≥32 chars), `BETTER_AUTH_URL`, `NEXT_PUBLIC_APP_URL` — Better Auth.
- `OPENROUTER_API_KEY` — required only for the AI Composer (`POST /api/compose`).
- `OPENROUTER_MODEL` — optional override (default `anthropic/claude-sonnet-4.5`).
- `NEXT_PUBLIC_LINES_URL` — Vercel Blob URL for the **default city's** `lines.json` in production;
  unset locally (falls back to `public/data/lines.json`). `BLOB_READ_WRITE_TOKEN` — only for
  `upload:lines`.
- **Per-city frontend vars** (resolved in `lib/shared/cities.js`): `NEXT_PUBLIC_LINES_URL_<CITY>`
  and `NEXT_PUBLIC_FEED_WS_URL_<CITY>` (e.g. `_HELSINKI`) point a non-default city at its Blob URL
  and feed. A null/unset feed URL makes that city **mock-only** (Live toggle disabled).
  `NEXT_PUBLIC_DEFAULT_CITY` — initial city id (default `budapest`).
- `RESEND_API_KEY`, `EMAIL_FROM` — magic-link email; **optional in dev** (links print to the
  server console when unset).
- `FEED_HTTP_URL` — server-side, where `/api/snapshot` proxies to (default `http://localhost:3005`).
- `NEXT_PUBLIC_FEED_WS_URL` — browser connects to the feed's WebSocket directly.

**Feed service** (`feed/.env`, gitignored — see `feed/.env.example`):
- `CITY` — which descriptor in `feed/cities/` to serve (default `budapest`). Unknown id → the
  process exits. One feed process serves one city; run multiple processes (different `PORT`/`CITY`)
  for multiple live cities.
- `BKK_API_KEY` — required **only when `CITY=budapest`** (the descriptor's `apiKeyEnv`); the process
  exits if its declared key is missing. `CITY=helsinki` needs no key (HSL RT feeds are public).
  Free BKK key: https://opendata.bkk.hu/data-sources
- `PORT` — default 3005.
- `ALLOWED_ORIGINS` — comma-separated CORS allowlist (`*` default; set to the Vercel origin
  in production).

### Data pipeline gotchas

- `public/data/lines.<city>.json` is the preprocessed route/stop/polyline file the **frontend**
  loads per city (~22 MB each). Regenerate with `npm run preprocess:<city>`, which reads the raw
  GTFS in `data/<city>_gtfs/` (gitignored). Each file embeds a `city` metadata block
  (id/name/timezone/center/bounds/attribution) **derived from the GTFS stops** at build time, plus
  routes mapped through `routeTypeToLineType` (filtered to the descriptor's `mapLineTypes`).
  Budapest also **mirrors** to `lines.json` (the default-city dev fallback). In production each is
  served from **Vercel Blob** (`npm run upload:lines` → set `NEXT_PUBLIC_LINES_URL[_<CITY>]`).
- The **feed service** independently downloads + caches each city's static GTFS to
  `feed/cache/gtfs_lookup_<city>.json` (gitignored) on first run via `feed/gtfsLoader.js`
  (`loadGtfs(cfg)`). Bump `CACHE_VERSION` there when changing the lookup schema, or delete the
  cache to force a rebuild.
- The frontend has **no Vite proxy** (Vite is gone). It fetches the active city's route data via
  the URL from `cities.js` (`lib/shared/useRoutes.js`, per-URL cached), reaches stateless backend
  logic via same-origin `/api/*` route handlers, and the live WebSocket via the active city's
  `liveWsUrl` (`lib/liveClient.js`).

## Architecture

### `app/` — Next.js routes

- `page.jsx` — `'use client'`; loads the whole DAW (`components/App.jsx`) via `next/dynamic` with
  `ssr: false`, so the browser-only audio/map code never executes on the server. **Phones load the
  real app** — the old `MobileGate`/`isMobileDevice.js` block is gone; see **Mobile** below. The
  native-app direction is still in `docs/mobile-app-plan.md`.
- `layout.jsx` — root layout; imports `leaflet/dist/leaflet.css`.
- `api/auth/[...all]/route.js` — all Better Auth endpoints.
- `api/compose/route.js` — proxies prose → JSON plan through OpenRouter (key stays server-side).
- `api/snapshot/route.js` — proxies `GET` to the feed service; degrades to `{vehicles:[]}` if
  the feed is unreachable.
- `api/presets/route.js` + `api/presets/[id]/route.js` — user-scoped song CRUD (`PUT` = upsert).
- `api/presets/[id]/share/route.js` — owner toggles a public share link;
  `api/shared/[shareId]/route.js` — public read-only view of a shared song (the client imports a
  copy via Save As).
- `api/compositions/route.js` + `api/compositions/[id]/route.js` — user-scoped **composition**
  CRUD (Song Chainer's presets-of-presets; see below), mirroring the `api/presets` contract.
- `api/entitlements/route.js` (+ `api/entitlements/claim`) and `api/billing/{checkout,portal,webhook}`
  — the **Free/Pro billing** surface (see the Billing section below).

### `lib/` — auth, DB, persistence, and the audio engine (non-UI logic)

- `auth.js` / `auth-client.js` — Better Auth (email+password + magic link) via the Drizzle
  adapter; server config + React client.
- `email.js` — Resend sender with a dev console fallback.
- `db/schema.js` — Drizzle schema: `user`/`session`/`account`/`verification` (Better Auth) +
  `presets` (`state jsonb`, plus a nullable `share_id` for public share links) + `compositions`
  (`items jsonb` — an ordered list of `{presetId, bars, transition}`; see Song Chainer below).
  `db/index.js` — pooled `pg` client.
- `persistence.js` — song CRUD against `/api/presets` (async; same export names as the old
  localStorage module) + share helpers (`shareSong`/`unshareSong`/`loadShared`).
  `songState.js` — `buildSnapshot`/`applySnapshot`. `useSongPersistence.js` — autosave hook,
  **session-gated** (no save when signed out); also imports a `?shared=<id>` link on load.
  `compositions.js` — analogous async CRUD for Song Chainer compositions against
  `/api/compositions`.
- **Audio engine + mapping** (all client-only, imported by the UI): `engine.js`
  (`TransitEngine`), `mappings.js`, `mockData.js`, `vehicleVoice.js`, `granularVoice.js`,
  `fxTrack.js`, `automationTrack.js`, `networkState.js`, `alertLayer.js`, `liveClient.js`,
  `engines/` (the four secondary-tab engines), `ai/composer.js`, `shared/useRoutes.js`,
  `audioExport.js` (WAV recording of live output — see below), `snapshotPlayer.js` +
  `songChainPlayer.js` (Song Chainer's standalone playback — see below).

### `components/` — React UI (client-only)

`App.jsx` is a 6-tab shell (Map/DAW, Drum Machine, Loop Capturer, Headphone, Motif, and **Song**
— the Song Chainer) with an `AuthControl` (sign-in/up + magic link) in the header. Each
tab loads shared route data via `useRoutes()` (`/data/lines.json`) but owns its own audio engine.
Cross-area imports use the `@/` alias (e.g. `@/lib/engine.js`); same-area imports stay relative.
The header also hosts a **driver.js onboarding tour** (`components/TourMenu.jsx`, steps in
`lib/tourSteps.js`) that auto-starts once for new visitors and can be replayed.

**Tabs stay mounted once visited**: `App.jsx` keeps a `mounted` `Set` of every tab id opened this
session (seeded with `'mixer'`); switching tabs toggles a `display: none` pane rather than
unmounting, so a tab's full local state (loaded routes, mixer config, drum pattern, DAW layout,
playhead) survives the switch instead of resetting. Every tab component takes an `active` prop and
is individually responsible for pausing itself when hidden — e.g. `MixerTab` stops `TransitEngine`
mock playback on `active` going false if it was running, since all tabs share one
`Tone.Transport`/destination, but leaves state untouched for instant resume.

#### The main DAW (Map/DAW tab)

`components/tabs/MixerTab.jsx` is the heart of the app and by far the largest piece of state. It:
- owns **all per-track settings** (volumes, pans, disabled/solo, scales (root + scale type — the
  earlier per-track perc/harm sound modes and drone mode were removed from the DAW UI), synth
  types, ADSR, filters, EQs, octave/glide/legato/speed/loop-region, per-track arpeggiator
  configs, per-track granular-layer configs, FX send matrix, automation lane configs, FX bus
  state, BPM, master volume),
- instantiates **one `TransitEngine`** (`lib/engine.js`) and mirrors every UI change into it via
  `engine.setX(...)` handlers,
- renders three children sharing that state: `DawView.jsx` (track-lane DAW UI), `MapView.jsx`
  (Leaflet live map), and `AIComposerPanel.jsx`,
- wires song persistence via `useSongPersistence` (`lib/`) + `SongMenu.jsx`,
- offers **MIDI export** (per-track and full-mix) via `lib/midiExport.js` — it reconstructs note
  events either from a route's loop pitch map (`buildLoopMidiEvents`) or from a live
  `MidiSessionRecorder` that `engine.js` feeds as notes fire, then writes a `.mid` blob with
  `@tonejs/midi`,
- offers **WAV export** (per-track stem and full-mix) via `lib/audioExport.js` — unlike MIDI
  export this captures **real-time audio** by tapping live Tone.js nodes
  (`engine.getMasterOutputNode()` / `engine.getRouteOutputNode(routeId)`) with a `PcmRecorder`
  during one playback pass, then encodes/downloads WAV blobs (`exportRouteAudio`/
  `exportMixAudio`; `defaultCaptureDuration` sizes the capture to the longest audible loop).

**Disable / solo / duplication** (replacing the old mute-only model):
- `disabledRoutes` (was `mutedRoutes`) — mirrored to `engine._routeDisabled` via
  `setRouteDisabled(routeId, disabled)`. Disabling a route doesn't just zero its gain: it skips
  note-triggering entirely in the mock `Tone.Part` callback and in `triggerLiveNote`, hides the
  route on the map, and excludes it from MIDI/WAV export. Freshly picked routes (new song, city
  switch, session reset) start **all disabled** (`allDisabledMap`) so the user builds the mix
  lane-by-lane.
- Solo is Ableton-style: a plain click on a track's solo button replaces the solo set with just
  that track; Cmd/Ctrl-click toggles additive membership (`handleSolo(routeId, additive)`).
  Gating happens at note-trigger time in the engine (`_soloRoutes`), same mechanism as disable.
- Active (soloed or non-disabled) tracks are **excluded as automation-lane sources** in
  `DawView.jsx`'s `AutomationLane` — picking one as a source would make it vanish from the
  instrument view once music starts.
- `handleDuplicateTrack(sourceId)` clones a track's full per-track config (including arp/granular
  configs) into a new synthetic route id (`<sourceId>~dup~<ts><rand>`) for **chord voicing**, so
  stacked duplicates harmonize rather than unison. Duplicate lanes are audio-only and hidden from
  the map. Duplicate descriptors are now just `{ id, sourceId, name }` — per-stop offsets moved to
  `trackPitchOffsets` (below); `songState.js`'s `_hoistLegacyPitchOffsets` migrates old
  `duplicates[i].perStopSteps` snapshots into it on load.
- **Per-stop pitch + velocity editing** is generalized to every lane (base or duplicate), not just
  duplicates: clicking a stop-rail note dot opens `components/StopEditor.jsx` (a portal-rendered
  modal — a ±1 diatonic-degree stepper plus a 20–100% velocity slider, both live, no Apply button),
  replacing the older click-and-drag gesture on the dot itself. `handleStopPitch(routeId, stopId,
  degrees)` writes into `trackPitchOffsets` (`routeId → { stopId: degrees }`) applied via
  `engine.setPitchOffsets` / `transposeNoteInScale` (`lib/mappings.js`); `handleStopVelocity`
  writes into the per-route `_stopVelocities` map (see the arpeggiator/velocity section below).
- Fresh sessions now start with `DEFAULT_FX_TRACKS = ['reverb', 'delay', 'chorus', 'distortion']`
  pre-activated (was empty), so automation targets like `send.reverb` are available immediately.

Two playback modes, both driven by `TransitEngine`:
- **mock** — `engine.startMock()` schedules `Tone.Part`s that fire notes from each route's
  per-stop pitch map on a synthetic timeline (the city "plays itself" deterministically). Each
  track loops on its **own** cycle rather than a single shared 4-bar grid, so tracks of different
  lengths drift into **polyrhythm** (decoupled from the global transport — see `bf45ac5`). Per-track
  loop windows are stored in `engine._trackLoopRegions` and set via `setTrackLoopRegion(routeId,
  region)`; automation lanes can carry their own `loopRegion` sub-loop (null = inherit the source
  route's region). Loop regions and per-stop notes are quantized to a shared cell grid
  (`GRID_TOTAL_CELLS` = `GRID_BARS` × `GRID_STEPS_PER_BAR` in `mappings.js`), and each route has a
  **per-track note-grid resolution** (`engine._gridResolutions[routeId]`, set via
  `setGridResolution`, options in `GRID_RESOLUTION_STEPS_PER_BAR`, default `DEFAULT_GRID_RESOLUTION`)
  that snaps its notes to a coarser/finer subdivision.
- **live** — `engine.startLive()` + `LiveClient` WebSocket; real BKK arrivals call
  `handleVehicleCrossed` → `engine.triggerLiveNote()`.

**Cross-tab drum backing**: the Drum Machine tab can "Send to Map", pushing its pattern into an
app-level `DrumClipboardContext` (`lib/shared/DrumClipboardContext.jsx`, `DrumClipboardProvider`
in `App.jsx`, localStorage-persisted). MixerTab pulls it in via `useDrumClipboard()` and mirrors
it into the engine with `engine.setDrumPattern(...)` (with a session-only `drumsMuted` toggle), so
the Map/DAW tab plays a drum backing alongside the transit-driven lanes. In `DawView.jsx` the
pattern renders as a real lane (`DrumLane`, a 6-pad step grid with its own synced playhead) rather
than a header chip, with a collapsible FX rack (filter/EQ/sends) — but it's still **one shared
insert chain for all 6 pads**, not per-voice FX. The drums aren't individually solo-able (no solo
button on `DrumLane`), so `_applyRouteGain` silences them whenever *any* other lane is soloed
(`setSolo` refreshes the drum lane's gain on every toggle, since — unlike normal routes, which are
gated at note-trigger time — the drum `Tone.Sequence` runs independently of that path).

#### TransitEngine (`lib/engine.js`)

The audio graph and the single source of truth for sound. Roughly:

```
per-route synth / VehicleVoice / Sampler
   → per-route insert FX (filter, weq8 EQ, pan, volume)
   → per-line-type Volume+Panner bus (metro/tram/trolley/bus/hev)
   → AlertLayer (service-alert-driven reverb + scale/mode)
   → Tone.Destination
   ⇗ parallel FX sends (FxTrack buses: reverb/delay/etc.) via a send matrix
NetworkState (drone hum + hub-convergence chords) → AlertLayer input
```

- Most settings **persist across start/stop** (stored in plain `_xxx` maps on the instance) and
  are re-applied when a synth/part is (re)built.
- **The drum lane is a reserved pseudo-route**: `DRUMS_ROUTE_ID = '__drums__'` gets one insert
  chain (`routeGain → filter → weq8 eq → panner → master`, built by `_ensureDrumInsert()` and torn
  down by `_disposeDrumInsert()`) registered in `_mockSynths` like any real route, so it rides the
  same generic per-route mixer setters (`setRouteVolume/Filter/EqState/SendLevel`) and the same
  React state maps (`volumes`, `trackFilters`, `trackEqs`, `sendMatrix`) keyed by that one id — no
  separate persistence plumbing needed. `_startDrumSeq()` feeds the `DrumSequencer`
  (`lib/engines/drumEngine.js`) into that chain's `routeGain` instead of straight to master.
- **EQ is `weq8`** (an 8-band parametric EQ, replacing the old 3-band `Tone.EQ3` tilt EQ) on every
  route including the drum lane. `_eqRuntimes[routeId]` holds a live `WEQ8Runtime`
  (`getRouteEqRuntime(routeId)`), persisted across start/stop so the curve editor
  (`<weq8-ui>` web component in `EqPanel`, `DawView.jsx`) can mutate it directly while stopped;
  `setOnRouteEqChange(cb)` mirrors runtime edits back into React state for autosave.
  `lib/eqMigrate.js` (`normalizeEqState`/`eq3ToWeq8`) coerces old saved EQ3 snapshots into weq8
  specs on load (`songState.js`'s `migrateTrackEqs`).
- **Synth types** are listed in `SYNTH_TYPES`. Two are sample-backed `Tone.Sampler`s: `Sampler`
  (multi-sample melodic, `SAMPLER_PRESETS` + user uploads) and `Drums` (a single one-shot drum
  voice from `DRUM_VOICES`, fired at a fixed `DRUM_TRIGGER_NOTE` so it never transposes with the
  route melody). Both keep `attack`/`release` as top-level params — never push `urls` through
  `.set()` (see `updateEnvelope`). Drum samples are CC0 placeholders in
  `public/samples/drums/cc-kit/` (`DRUM_BASE_URL`; license in `DRUM_VOICE_LICENSE` +
  `ATTRIBUTION.md`).
- Supporting modules: `vehicleVoice.js` (per-vehicle FM voice pool, modulated by speed/occupancy/
  delay), `granularVoice.js` (`GranularVoice` — an optional per-track `Tone.GrainPlayer` layer fed
  by a rendered sample of the route's instrument; layered on top of each note), `fxTrack.js`
  (`FX_BUSES`, `FX_PARAM_SPECS`, `AUTOMATION_TARGETS`, `FxTrack`), `automationTrack.js`
  (`AutomationTrack`, `AUTOMATION_SOURCES`), `networkState.js` (`NetworkState`), `alertLayer.js`
  (`AlertLayer`).
- **Per-track granular layer**: opt-in per route (`DEFAULT_GRANULAR`, configs in
  `engine._granulars`, set via `setGranular(routeId, cfg)`). When enabled it exposes extra
  automation targets (`grain.*`, see `GRAIN_PARAM_TARGETS` / `availableAutomationTargets`). Note:
  `Granular` was *briefly* a synth type — it is **now a layer, not a synth**; `songState.js`
  coerces stale `'Granular'` synth-type snapshots back to a real synth.

#### Musical mapping (`lib/mappings.js`)

Pure, side-effect-free functions — the place to change *how data becomes music*. Per-stop pitch
is a single **geographic stop-rail** mapping: `generatePitchMap(stops, rootMidi, modeScale,
octaveSpan, opts)` builds a line's note sequence from each stop's geography (latitude → scale
degree, longitude → octave register) via `geoToMidi`/`latToMidi`. `opts = { contour, variety,
routeId }` (`PITCH_CONTOURS = ['geographic','randomWalk','arch']`, `DEFAULT_PITCH_VARIETY =
{ contour: 'geographic', variety: 0 }`) is an opt-in per-track variety layer on top of the
geographic mapping — `variety === 0` with `contour: 'geographic'` reproduces the plain mapping
byte-for-byte, so old saved songs are unaffected. Engine-side: `_pitchVariety[routeId]`
(`setPitchVariety`). Also here: `SCALES`/`MODES`, the `normalizeX` family (GTFS field → 0..1 for
automation), seeded RNG (`hashStringToInt`/`mulberry32`/`makeSalt`), and polyline/grid helpers.
`mockData.js` holds mock-mode data and a `latToNote` copy.

**Per-stop velocity** is a parallel, independently opt-in layer: `generateVelocityMap(stops,
variety)` derives a 0.6–1.0 velocity per stop from inter-stop gap size (tightly-packed stops
soften; a stop after a long gap stays full), flat `1.0` at `variety = 0`. At note-trigger time
(`_triggerSynth`/`_triggerLegatoNote`/`_triggerArp`, all now take a `velocity` param passed through
to `triggerAttackRelease`), the engine resolves velocity as `_stopVelocities[routeId]?.[stopId] ??
velocityMap[originalIdx] ?? 1` — an authored per-stop override (via `StopEditor`, see above; stored
in `setStopVelocities(routeId, map)`) wins over the derived map. MIDI export
(`midiExport.js`/`buildLoopMidiEvents`) resolves velocity the same way so exported files match
playback.

The **per-track arpeggiator** also lives here as pure logic: `buildArpSequence(rootNote, cfg,
scaleType)` expands a single triggered note into a tempo-synced sequence; `ARP_STYLES`,
`ARP_RATES`, and `DEFAULT_ARP` are defined here and re-exported by `engine.js` for the UI. The
engine stores per-route configs via `setArpeggiator(routeId, cfg)` and consults them at note
trigger time (mock and live).

**Drum-pad velocity** is a separate, discrete mechanism in `lib/engines/drumEngine.js`: each of
the 6 pads' 64-step pattern is `number[]` (not `boolean[]`) — `STEP_LEVELS = [0, 1, 0.7, 0.4]`
(off/full/normal/soft), cycled by click via `cycleStepValue()` (`normalizeStep()` migrates old
boolean-array patterns). `DrumSequencer._trigger(padId, time, stepVel)` multiplies each voice's
baked velocity by the step's level, so `1` reproduces pre-velocity playback exactly. Both the Drum
Machine grid and the DAW's `DrumLane` render the levels via `vel-accent`/`vel-norm`/`vel-soft` CSS
classes.

### Persistence & AI

- **Songs/presets**: `lib/persistence.js` (async CRUD → `/api/presets`, Postgres) +
  `lib/songState.js` (`buildSnapshot`/`applySnapshot` serialize the whole MixerTab state) +
  `lib/useSongPersistence.js` (session-gated autosave hook) + `components/SongMenu.jsx`. Adding
  new per-track state means threading it through `buildSnapshot`/`applySnapshot` too, not just
  MixerTab (e.g. `drumVoice` lives in `trackADSRs` and is replayed via `handleDrumVoice`;
  `trackPitchOffsets`/`trackPitchVariety`/`trackStopVelocities` are examples of state added this
  way).
- **A song owns its city and its exact lane list** (`SCHEMA_VERSION` 3): the snapshot carries
  `cityId` and `routeIds` because route ids are **city-scoped**. Before v3 neither was stored, so
  loading a song re-rolled a random lane selection (`pickStartupRoutes` is random for
  tram/trolley/bus) and a cross-city song orphaned every lane. `presets.city_id` mirrors
  `state.cityId`, derived server-side in `app/api/presets/*` (`cityIdOf`) so a stale client can't
  desync them; it's nullable because pre-v3 rows genuinely don't know their city, and `null` keeps
  meaning "assume the currently-loaded city".
- **`lib/songLanes.js` is the single lane resolver** — `snapshotBaseRouteIds` /
  `resolveSnapshotLanes` / `snapshotLaneDisabledMap` / `clampMode`. It answers "which routes does
  this snapshot play?" for `songState.applySnapshot`, `snapshotPlayer.mergeDuplicateRoutes`, and
  `billing/plans.normalizeSnapshotLaneAccess`, which each used to answer it differently (the Mixer
  and the Song Chainer could disagree about the same snapshot). Pure and dependency-free —
  `plans.js` is imported by server route handlers, so nothing here may pull in tone/engine.
  `snapshotLaneDisabledMap` is deliberately **dense over every lane** (absent ids default to
  disabled): a sparse map left lanes `undefined` in React (rendered active) while the engine kept
  them at gain 0, i.e. active-looking lanes that made no sound.
- **Loading a song goes through `MixerTab.applyPreset`** — the one entry point for every snapshot
  (open, autoload, shared link). It switches city if needed, awaits that city's route data,
  disposes+recreates the engine, installs the song's own lanes, then replays the snapshot. Two
  invariants to preserve when touching it: it must stay a **referentially stable** `useCallback`
  (the hook keys `open` and hydration off it — hence the `cityIdRef`/`limitsRef`/`startedRef`
  pattern), and `pendingPresetRef` must be set **synchronously before `setCityId`** so MixerTab's
  city effect stands down instead of resetting and re-picking over the loaded song.
  `presetTokenRef` supersedes stale applies when loads and manual switches overlap.
- **Migrations are an ordered pipeline**, not implicit shape-sniffing: `songState.migrateSnapshot`
  keyed off `schemaVersion` (→2 coerces stale `'Granular'` synth types, normalizes legacy EQ3 via
  `eqMigrate.normalizeEqState`, hoists `duplicates[].perStopSteps` into `trackPitchOffsets`; →3
  derives `routeIds`). A *newer* version warns but still applies — a save from a newer client must
  never become unopenable. Check here before assuming an old song loads against a changed shape.
- **New session**: `SongMenu` → New autosaves the current song (signed-in only; signed-out users
  are warned first) then calls `MixerTab.resetSessionState` (`onReset` on the hook). That disposes
  and rebuilds the `TransitEngine` for a clean audio graph and resets every per-track/FX/global
  setter to defaults, leaving the loaded route list in place (a preset load passes
  `{ routes: [] }` — it's about to install its own lanes).
- **A city switch preserves then detaches** the open song: the city effect calls the hook's
  `newSong` via `onCitySwitchAway`. A song can't follow its ids to another city, and leaving it
  attached let the debounced autosave write the wiped session over it. Autosave itself compares
  against a `baselineRef` snapshot rather than treating *any* change as a user edit, so applying a
  song or resetting the session no longer looks like something worth persisting; `persist` also
  refuses a write whose `cityId` disagrees with the attached song's.
- **Sharing**: an owner can publish a saved song via `SongMenu` → `POST /api/presets/:id/share`
  mints a `share_id`; the link `/?shared=<id>` is publicly readable (`/api/shared/:id`) and the
  hook imports it on load as a detached/unsaved song (Save As to keep a copy).
- **AI Composer**: `lib/ai/composer.js` builds the system prompt from the live route list and
  validates the model's JSON plan; `app/api/compose` proxies the call same-origin (**gated to
  signed-in users** — it spends the OpenRouter key); `applyAIPlan`
  in MixerTab applies a plan by **replaying the same handlers a human would click** (order
  matters — see the comment there).

### Billing & entitlements (Free/Pro)

A **Lemon Squeezy**-backed Free/Pro tier gates a few features by usage. The pure resolution logic
is `lib/billing/plans.js` (the one tested module) — `resolveAccess({role, override, subscription})`
picks a plan in priority order **superadmin → override → subscription → free**, returning the
`limits` object. `FREE_LIMITS` caps `activeLanes: 4`, `compositionItems: 3`, `exports: 3`, `ai: 3`
(lifetime); Pro lifts all but `ai: 50`/month; superadmin is unlimited. `null` in a limit means
unlimited.

- **Server**: `lib/billing/server.js` resolves + records usage against Postgres; webhooks are the
  source of truth. `lib/db/schema.js` holds `billingSubscriptions` (one row per LS subscription,
  kept as history not a `user.plan` flag), a webhook-event dedup table, `entitlementUsage`
  (per-user/metric/period counters), and `entitlementOverrides` (manual Pro grants, admin-issued —
  see `docs/admin-access.md`). Routes: `api/billing/checkout` (start a subscription),
  `api/billing/portal` (manage it), `api/billing/webhook` (LS → DB), `api/entitlements` (current
  access + usage), `api/entitlements/claim`.
- **Client**: `lib/shared/EntitlementsContext.jsx` (`EntitlementsProvider` in `App.jsx`,
  `useEntitlements()`) fetches `/api/entitlements`, exposes `plan`/`isPro`/`limits`/`usage`, and
  owns the `UpgradeModal` shown when a gate is hit. `components/UpgradeModal.jsx` is the paywall.
- **Lane gating**: `normalizeLaneAccess`/`normalizeSnapshotLaneAccess` disable audible lanes beyond
  the plan's `activeLanes` cap **without discarding them** — an oversized saved song loads verbatim
  with the overflow lanes muted, so upgrading restores them. `countActiveLanes` excludes the drum
  pseudo-route (`__drums__`).

### Legal & SEO

`app/{privacy,terms,legal,licenses}` are static legal pages; `lib/legal.js` (`LEGAL_DETAILS`)
centralizes operator/contact/jurisdiction facts they render from. `app/robots.js`,
`app/opengraph-image.jsx`, `app/twitter-image.jsx`, and `app/icon.jsx` are Next metadata routes.

### Mobile (phones, tablets, and audio reliability)

The app used to refuse to run on touch devices. It now ships a purpose-built phone layout plus an
audio-session layer; the native-app plan in `docs/mobile-app-plan.md` is still the long-term
direction, but the web build is genuinely usable on a phone.

**Breakpoints** — `lib/shared/breakpoints.js` is the single source (`PHONE_MAX` 767, `TABLET_MIN`
768). CSS can't read it, so every media query repeats the literal and comments back to that file.
`lib/shared/useViewport.js` exposes `useIsPhone()`/`useIsTablet()`/`useIsCoarse()` over
`useSyncExternalStore` — **not** `useState`+`useEffect`, which renders the desktop tree for one
frame and horizontally scrolls a phone.

**The rule for where a change goes**: sizing/stacking/hiding → a media query in
`components/mobile.css` (imported by `App.jsx` *after* `app.css`, which is what makes it win at
equal specificity — a rule placed in `components/mobile/*.css` loses, because those load earlier
via the module graph). A different component *tree* → a `useIsPhone()` branch in JSX. There are
only five such branches: the MixerTab layout swap, `<weq8-ui>` mounting, `MobileLaneList`
mounting, MapView's `preferCanvas`/`zoomControl`/`showStops`, and which tour step list runs.

**The phone Map/DAW** (`components/mobile/`) — `MobileDaw` replaces `.daw-header` + `DawView`
below 768px, but **MixerTab still owns every piece of state**: the branch lives inside MixerTab's
own return and passes `controls`/`lanes` prop bundles built from the same handlers the desktop
view uses. Branching in `App.jsx` instead would unmount MixerTab on rotation and destroy the song.
`MapView` keeps rendering in both branches (positioned over the stage by `.daw--phone
.map-wrapper`) so Leaflet never remounts. Pieces: `MobileTopBar` (city · song · ⋯),
`MobileLaneList`/`MobileLaneStrip` (⏻ · S · volume · ⋯ per lane), `LaneSheet` (Sound/Mix/Notes),
`MobileTransportBar` (play, BPM, Map⇄Lanes, and the *one* shared playhead — desktop runs one rAF
per lane, which a phone can't afford), `MoreSheet` (the other eight header controls).

**Per-stop editing on a phone** is a list, not the stop rail: dots are 8px and 10–20px apart, so
44px hit areas would overlap neighbours. `lib/laneNotes.js` (`buildLanePitchMaps` /
`buildLaneNoteRows`) is the shared note resolver — **DawView's stop rail and the phone lane sheet
both go through it**, so the piano roll and the list can't disagree about what a stop plays.

**`components/Sheet.jsx`** is the one bottom-sheet primitive (portal, Esc, scroll lock,
drag-to-dismiss; a centred modal ≥768px). Deliberately *not* routed through `Dialog.jsx`'s
`DialogHost`, which is a promise-based alert/confirm queue.

**Audio reliability** — `lib/audioSession.js` is the layer every engine's `start()` goes through
(`unlockAudio()` replaced the five bare `Tone.start()` calls). It escapes iOS's muted "ambient"
audio session (`navigator.audioSession` on Safari 16.4+, a near-inaudible keep-alive
`HTMLAudioElement` on older iOS — **non-zero** samples, since some WebKit builds ignore digital
silence), resumes the context on `visibilitychange`, and exposes `probeOutputPeak()`.
`unlockAudio()` **must be called synchronously from a user gesture, before any other await**.

`components/AudioTroubleshooter.jsx` is the "I pressed play and hear nothing" panel. **The iOS
ring/silent switch is not detectable from JS and the panel never claims otherwise** — it verifies
what is knowable (context state, master fader, audible lane count, measured output peak) and uses
the combination to point outward: healthy graph + real signal ⇒ the problem is the hardware
switch or device volume. Openable from anywhere via `lib/shared/soundCheck.js` (same
module-level-registration shape as `Dialog.jsx`'s imperative API).

`components/FirstRunNotice.jsx` shows once below 768px (`localStorage['leid-intro-seen']`) and
sets expectations; its **"Got it" also calls `unlockAudio()`** — the first guaranteed gesture of
the session, and the best moment to promote the audio session before the user finds Play.

**Phone route payloads** — `scripts/slim_lines.js` (`npm run slim:all`) writes
`lines.<city>.slim.json` with Douglas–Peucker-simplified **polylines only**; `stops` are copied
verbatim because their coordinates drive `geoToMidi`/`routeBounds`/MIDI export, so thinning one
would change the music. Berlin 65 MB → 4.7 MB. `cities.js` gains `linesUrlSlim` +
`linesUrlFor(entry, {slim})`; `useRoutes.js` picks by `useIsPhone()`.

**Touch conventions**: 44px floor in `mobile.css`, scoped with `:not()` exclusions (a blanket
`button { min-height }` breaks the rail elements and the 16-step drum grids, which are documented
exceptions). Range inputs need explicit `::-webkit-slider-thumb` sizing — `min-height` grows the
element but not the thumb. Every `onDoubleClick` reset also takes a long-press via
`lib/shared/useResetGesture.js` **and** has a visible control in a sheet. Modal scrims use
`onPointerDown`, always changed in pairs (overlay handler + panel `stopPropagation`).

### Other tabs

`DrumMachineTab`, `LoopCapturerTab`, `HeadphoneTab`, `MotifTab` are largely self-contained, each
backed by its own engine in `lib/engines/` (`drumEngine`, `loopEngine`, `motifEngine`,
`phonesEngine`). They reuse the same `useRoutes()` data but do not share `TransitEngine`.

#### Song Chainer (`components/tabs/SongChainerTab.jsx`)

Chains multiple saved presets (songs) into one multi-part composition — a **composition**
references presets by id rather than embedding their state, so editing a preset updates every
composition using it. Data model (`lib/compositions.js`, `compositions` table): `items` is
`[{presetId, presetName, bars, transition: 'cut'|'crossfade', crossfadeBars?}]`, plus `bpm` and
`cityId` (compositions are implicitly single-city).

Playback does **not** reuse MixerTab's engine — `SongChainerTab` instantiates its own standalone
`TransitEngine` + `SongChainPlayer` (`lib/songChainPlayer.js`). For each item, `SongChainPlayer`
loads the referenced preset's snapshot and starts it via `lib/snapshotPlayer.js`'s
`playSnapshotOnEngine(engine, snapshot, routes, {bpm})`, which mirrors MixerTab's own Start
sequence (`applySnapshot` in engine-only mode → rebuild duplicate-lane routes via
`mergeDuplicateRoutes` → `engine.startMock(...)`). Item boundaries are driven by wall-clock
`setTimeout`s rather than `Tone.Transport.schedule`, because switching items calls
`stopMock()` → `Tone.Transport.cancel()`, which would drop transport-scheduled callbacks.
Transitions are either a quick declick fade (`'cut'`) or a volume dip-and-return around the
swap (`'crossfade'`), not a true overlapping crossfade.

### `feed/` — always-on feed service

A standalone, separately-deployable Node service (own `package.json`, `Dockerfile`,
`README.md`). `feed/index.js` is an Express + `ws` server: it reads the `CITY` env, looks up the
descriptor (`feed/cities/index.js` → `getCity(id)`), and constructs `GtfsRtFeed` (in `bkkFeed.js`;
**renamed from `BkkFeed`, which is kept as a back-compat alias**) with that config. The feed polls
the descriptor's `feeds[]` (VehiclePositions/TripUpdates every `pollMs`, Alerts every `alertMs`),
applies the descriptor's `auth` (query/header/none), diffs against previous state, and emits
`arrival`/`vehicle_update`/`trip_update`/`alert_update`, which the server broadcasts to all WS
clients. It infers train positions from TripUpdates for any mode in `modesWithoutVehiclePositions`
(metro everywhere so far). `gtfsLoader.js` (`loadGtfs(cfg)`) downloads the descriptor's
`staticGtfsUrl` into a stop/route/metro-trip lookup, mapping `route_type` via the shared resolver.
`pitch.js`'s `latToNote(lat, bounds)` takes the city's bounds (kept in sync with
`lib/mockData.js`). HTTP endpoints: `/health`, `/api/snapshot`, `/api/metro-debug`.

### Multi-city

Registered cities: **budapest, helsinki, berlin, prague, newyork, zurich, warsaw** (in
`feed/cities/index.js` and `lib/shared/cities.js`). Prague/PID, New York/MTA, Zürich/ZVV and
Warsaw/ZTM descriptors are **mock-only with best-effort, unconfirmed RT `feeds[]`** (Prague needs a
Golemio `X-Access-Token` key; NYC subway RT is sharded by line group and TripUpdates-only; Zürich RT
is nationwide + key-gated so `feeds` is empty; Warsaw RT is public `vehicles.pb`/`alerts.pb`) —
confirm those endpoints before enabling Live. Zürich has no metro and its city feed's trolleybuses
fold into the `bus` voice; Warsaw has metro/tram/bus/rail but no trolley. NYC is the
first city with **negative longitudes**; pitch stays correct because it derives from each route's
own `routeBounds`, not `city.bounds` (see `docs/multi-city-gtfs.md`).

The city abstraction lives in **two parallel registries** — kept separate because the feed service
deploys standalone and can't import from `lib/` (same synced-copy convention as `feed/pitch.js`):

- **`feed/cities/<id>.js`** (server-only) — the full descriptor: `staticGtfsUrl`, `apiKeyEnv`,
  `auth`, `feeds[]` (`{url, entityTypes}` — models combined/split/sharded agencies),
  `pollMs`/`alertMs`, `modesWithoutVehiclePositions`, `routeTypeOverrides`, `mapLineTypes`,
  `bounds`, `attribution`. Consumed by the feed **and** by `scripts/preprocess_lines.js` (which
  *can* import it, being a build script). `feed/cities/index.js` exposes `getCity(id)`.
- **`lib/shared/cities.js`** (browser-safe) — only what the UI needs per city: `name`, `linesUrl`,
  `liveWsUrl` (null → mock-only). Resolves from `NEXT_PUBLIC_*` env. `lib/shared/CityContext.jsx`
  (`CityProvider` mounted in `App.jsx`, `useCitySelection()`) holds the active `cityId`, persists
  it to `localStorage`, and exposes `cityEntry`. `components/CitySelect.jsx` is the top-nav picker.

`lib/routeTypes.js` (`routeTypeToLineType`) maps any GTFS `route_type` — standard 0–12 **and**
extended HVT 100–1700 codes — to one of the five engine voices (`metro|tram|trolley|bus|hev`), so
adding a city needs **no synth wiring**. **It is mirrored in `feed/routeTypes.js` — change both.**

City switching at runtime: `useRoutes()`/`useCity()` (`lib/shared/useRoutes.js`) key off
`cityEntry.linesUrl` (per-URL cache). On city change `MixerTab` calls `resetSessionState()`, loads
the new `lines.<city>.json`, pushes its embedded `city.bounds` into the engine via
`setCityBounds()` (`lib/mappings.js`), and forces mock mode if the city has no `liveWsUrl`.
**Per-route pitch is independent of city bounds** — `geoToMidi`/`routeBounds` derive from each
route's own stops; `cityBounds` only retunes the centroid/dispersion *fallbacks* (important for
cities at very different latitudes or with negative longitudes — see `docs/multi-city-gtfs.md`).

**To add a city**: write `feed/cities/<id>.js` + add it to `lib/shared/cities.js`, run
`npm run preprocess -- --city <id> --gtfs data/<id>_gtfs`, set `CITY=<id>` for a feed process, and
point the per-city `NEXT_PUBLIC_*` vars at the generated file/feed. No engine code changes.

### Line → instrument convention

`metro` → pitched lead/bass · `tram`/`trolley` → rhythmic perc · `bus` → pads/textures ·
`hev` → low melodic/cello (also rail/suburban/ferry collapse here per `routeTypes.js`) · MÁV rail →
long sustained pads. Line-type colors live in `LINE_TYPE_COLORS` (`lib/engine.js`).

## Docs

`docs/nextjs-migration-plan.md` (Next/Vercel topology + migration history), `docs/bkk-api.md`
(GTFS-RT field reference), `docs/multi-city-gtfs.md` (per-city descriptor model, agency feed
quirks, candidate cities, generalization gotchas), `docs/vst-plugin-plan.md` (planned JUCE VST3/AU
port), `docs/mobile-app-plan.md` (native-app direction behind the mobile gate), `docs/gtfs-salt.md`,
`docs/admin-access.md` (superadmin role + manual Pro entitlement overrides).

## Planned (not yet wired in)

The root-level `*.js` Pencil scripts (`headphone-orbit.js`, `loop-waveform.js`, `track-viz.js` —
they use the `pencil.*` API with `@schema`/`@input` directives) and the `transport.pen` design
document are generative visualizations intended for future use in the UI. They are not imported
by the app yet — leave them in place.

## Stale / legacy

- `dist/` is a **stale Vite build** from before the Next migration (its `index.html` still says
  "Transit DAW"). The live app is served by Next, not from `dist/` — don't edit it or treat it as
  current.
- `scripts/generate_map.py` is a one-off Python helper, separate from the JS data pipeline
  (`preprocess_lines.js` / `upload-lines.js`).
