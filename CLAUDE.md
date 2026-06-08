# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Concept

A web DAW that sonifies live public transport, branded **"Leið"** (Icelandic for "the way/route";
the title lives in `app/layout.jsx`). Each transit line is a track; each station
arrival triggers a note. Budapest (BKK) was the first city; the app is now **multi-city**
(Budapest + Helsinki/HSL, with a runtime city picker) via a per-city descriptor abstraction —
GTFS-RT is a global standard, so adding a city needs config, not engine changes. See
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
# generic form: node scripts/preprocess_lines.js --city <id> [--gtfs data/<id>_gtfs]
npm run upload:lines # upload public/data/lines.json to Vercel Blob (needs BLOB_READ_WRITE_TOKEN)
npm run db:generate # drizzle-kit: emit SQL migration from lib/db/schema.js
npm run db:migrate  # drizzle-kit: apply migrations to DATABASE_URL
npm run db:push     # drizzle-kit: push schema directly (dev)
```

There is **no test runner and no linter configured** — don't assume `npm test` exists.

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
  `ssr: false`, so the browser-only audio/map code never executes on the server.
- `layout.jsx` — root layout; imports `leaflet/dist/leaflet.css`.
- `api/auth/[...all]/route.js` — all Better Auth endpoints.
- `api/compose/route.js` — proxies prose → JSON plan through OpenRouter (key stays server-side).
- `api/snapshot/route.js` — proxies `GET` to the feed service; degrades to `{vehicles:[]}` if
  the feed is unreachable.
- `api/presets/route.js` + `api/presets/[id]/route.js` — user-scoped song CRUD (`PUT` = upsert).
- `api/presets/[id]/share/route.js` — owner toggles a public share link;
  `api/shared/[shareId]/route.js` — public read-only view of a shared song (the client imports a
  copy via Save As).

### `lib/` — auth, DB, persistence, and the audio engine (non-UI logic)

- `auth.js` / `auth-client.js` — Better Auth (email+password + magic link) via the Drizzle
  adapter; server config + React client.
- `email.js` — Resend sender with a dev console fallback.
- `db/schema.js` — Drizzle schema: `user`/`session`/`account`/`verification` (Better Auth) +
  `presets` (`state jsonb`, plus a nullable `share_id` for public share links). `db/index.js`
  — pooled `pg` client.
- `persistence.js` — song CRUD against `/api/presets` (async; same export names as the old
  localStorage module) + share helpers (`shareSong`/`unshareSong`/`loadShared`).
  `songState.js` — `buildSnapshot`/`applySnapshot`. `useSongPersistence.js` — autosave hook,
  **session-gated** (no save when signed out); also imports a `?shared=<id>` link on load.
- **Audio engine + mapping** (all client-only, imported by the UI): `engine.js`
  (`TransitEngine`), `mappings.js`, `mockData.js`, `vehicleVoice.js`, `fxTrack.js`,
  `automationTrack.js`, `networkState.js`, `alertLayer.js`, `liveClient.js`, `engines/` (the four
  secondary-tab engines), `ai/composer.js`, `shared/useRoutes.js`.

### `components/` — React UI (client-only)

`App.jsx` is a 5-tab shell with an `AuthControl` (sign-in/up + magic link) in the header. Each
tab loads shared route data via `useRoutes()` (`/data/lines.json`) but owns its own audio engine.
Cross-area imports use the `@/` alias (e.g. `@/lib/engine.js`); same-area imports stay relative.

#### The main DAW (Map/DAW tab)

`components/tabs/MixerTab.jsx` is the heart of the app and by far the largest piece of state. It:
- owns **all per-track settings** (volumes, pans, mutes, solos, sound modes, scales, synth types,
  ADSR, filters, EQs, octave/glide/legato/drone/speed/loop-region, FX send matrix, automation
  lane configs, FX bus state, BPM, master volume),
- instantiates **one `TransitEngine`** (`lib/engine.js`) and mirrors every UI change into it via
  `engine.setX(...)` handlers,
- renders three children sharing that state: `DawView.jsx` (track-lane DAW UI), `MapView.jsx`
  (Leaflet live map), and `AIComposerPanel.jsx`,
- wires song persistence via `useSongPersistence` (`lib/`) + `SongMenu.jsx`,
- offers **MIDI export** (per-track and full-mix) via `lib/midiExport.js` — it reconstructs note
  events either from a route's loop pitch map (`buildLoopMidiEvents`) or from a live
  `MidiSessionRecorder` that `engine.js` feeds as notes fire, then writes a `.mid` blob with
  `@tonejs/midi`.

Two playback modes, both driven by `TransitEngine`:
- **mock** — `engine.startMock()` schedules `Tone.Part`s that fire notes from each route's
  per-stop pitch map on a synthetic timeline (the city "plays itself" deterministically).
- **live** — `engine.startLive()` + `LiveClient` WebSocket; real BKK arrivals call
  `handleVehicleCrossed` → `engine.triggerLiveNote()`.

#### TransitEngine (`lib/engine.js`)

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
- **Synth types** are listed in `SYNTH_TYPES`. Two are sample-backed `Tone.Sampler`s: `Sampler`
  (multi-sample melodic, `SAMPLER_PRESETS` + user uploads) and `Drums` (a single one-shot drum
  voice from `DRUM_VOICES`, fired at a fixed `DRUM_TRIGGER_NOTE` so it never transposes with the
  route melody). Both keep `attack`/`release` as top-level params — never push `urls` through
  `.set()` (see `updateEnvelope`). Drum samples are CC0 placeholders in
  `public/samples/drums/cc-kit/` (`DRUM_BASE_URL`; license in `DRUM_VOICE_LICENSE` +
  `ATTRIBUTION.md`).
- Supporting modules: `vehicleVoice.js` (per-vehicle FM voice pool, modulated by speed/occupancy/
  delay), `fxTrack.js` (`FX_BUSES`, `FX_PARAM_SPECS`, `AUTOMATION_TARGETS`, `FxTrack`),
  `automationTrack.js` (`AutomationTrack`, `AUTOMATION_SOURCES`), `networkState.js`
  (`NetworkState`), `alertLayer.js` (`AlertLayer`).

#### Musical mapping (`lib/mappings.js`)

Pure, side-effect-free functions — the place to change *how data becomes music*. Per-stop pitch
is a single **geographic stop-rail** mapping: `generatePitchMap(stops, rootMidi, modeScale,
octaveSpan)` builds a line's note sequence from each stop's geography (latitude → scale degree,
longitude → octave register) via `geoToMidi`/`latToMidi`. (The earlier multi-strategy /
manual-pitch system was removed.) Also here: `SCALES`/`MODES`, the `normalizeX` family (GTFS
field → 0..1 for automation), seeded RNG (`hashStringToInt`/`mulberry32`/`makeSalt`), and
polyline/grid helpers. `mockData.js` holds mock-mode data and a `latToNote` copy.

### Persistence & AI

- **Songs/presets**: `lib/persistence.js` (async CRUD → `/api/presets`, Postgres) +
  `lib/songState.js` (`buildSnapshot`/`applySnapshot` serialize the whole MixerTab state) +
  `lib/useSongPersistence.js` (session-gated autosave hook) + `components/SongMenu.jsx`. Adding
  new per-track state means threading it through `buildSnapshot`/`applySnapshot` too, not just
  MixerTab (e.g. `drumVoice` lives in `trackADSRs` and is replayed via `handleDrumVoice`).
- **New session**: `SongMenu` → New autosaves the current song (signed-in only; signed-out users
  are warned first) then calls `MixerTab.resetSessionState` (`onReset` on the hook). That disposes
  and rebuilds the `TransitEngine` for a clean audio graph and resets every per-track/FX/global
  setter to defaults, leaving the loaded route list in place.
- **Sharing**: an owner can publish a saved song via `SongMenu` → `POST /api/presets/:id/share`
  mints a `share_id`; the link `/?shared=<id>` is publicly readable (`/api/shared/:id`) and the
  hook imports it on load as a detached/unsaved song (Save As to keep a copy).
- **AI Composer**: `lib/ai/composer.js` builds the system prompt from the live route list and
  validates the model's JSON plan; `app/api/compose` proxies the call same-origin (**gated to
  signed-in users** — it spends the OpenRouter key); `applyAIPlan`
  in MixerTab applies a plan by **replaying the same handlers a human would click** (order
  matters — see the comment there).

### Other tabs

`DrumMachineTab`, `LoopCapturerTab`, `HeadphoneTab`, `MotifTab` are largely self-contained, each
backed by its own engine in `lib/engines/` (`drumEngine`, `loopEngine`, `motifEngine`,
`phonesEngine`). They reuse the same `useRoutes()` data but do not share `TransitEngine`.

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
port), `docs/gtfs-salt.md`.

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
