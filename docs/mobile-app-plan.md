# Mobile app plan — porting Leið to iOS/Android

Status: **plan only** (nothing implemented). The web app currently gates all touch devices
behind a "mobile app coming soon" screen (`components/MobileGate.jsx` +
`lib/shared/isMobileDevice.js`, with a session-scoped "try it anyway" bypass).

## Why not just the mobile web app?

Web Audio/Tone.js does run in mobile Safari/Chrome, but Leið's use of it doesn't:

- The audio graph is heavy — a synth + insert FX chain per route, parallel FX buses,
  optional granular layers, the NetworkState drone — and mobile-browser audio threads
  underrun (crackle) well before the desktop does.
- `lines.<city>.json` is ~22 MB per city.
- iOS specifics: the ring/silent switch mutes Web Audio (routed as "ambient"),
  backgrounding suspends the `AudioContext`, and Safari throttles timers, which degrades
  `Tone.Transport` scheduling.
- The UI is a dense desktop DAW: hover interactions, side-by-side Leaflet map + track
  lanes, small drag targets.

A native app fixes the audio runtime and lets the Map/DAW be redesigned for touch instead
of shrunk.

## Recommended stack: Expo / React Native + react-native-audio-api + MapLibre

**react-native-audio-api** (Software Mansion) implements the Web Audio API spec natively
(C++ core over CoreAudio on iOS / Oboe on Android). That is the pivotal choice: the entire
engine layer targets the Web Audio API, and Tone.js itself runs against a Web Audio–shaped
`AudioContext`, so the port is "re-host the engine" rather than "rewrite the audio from
scratch". Native audio also escapes every Safari limitation above (proper background-audio
session, no silent-switch surprise, no timer throttling).

Alternatives considered, kept for the record:

| Option | Trade-off |
| --- | --- |
| **Capacitor/WebView wrapper** | Fastest to the stores, near-total code reuse — but audio perf *is* mobile Safari (WKWebView), so it inherits every problem the gate exists for. Acceptable only as a stopgap. |
| **Shared JUCE C++ core** (see `docs/vst-plugin-plan.md`) | Best possible audio, one engine for VST3/AU *and* mobile — but the biggest lift by far (full engine rewrite in C++, JSI bridge, duplicated musical logic). A natural *later* convergence once the VST port exists; wrong first step for mobile. |
| RN + `react-native-audio-api` (**chosen**) | Native audio performance, maximal reuse of the existing JS engine/musical logic, Expo tooling, one codebase for both platforms. |

Map: **MapLibre React Native** (`@maplibre/maplibre-react-native`) — native vector map,
free tiles (e.g. OpenFreeMap/Protomaps), GeoJSON polyline layers for routes, symbol/circle
layers for stops and animated vehicle dots. (Leaflet is DOM-only and does not port.)

## What ports as-is (pure JS, no DOM)

- `lib/mappings.js` — the whole musical mapping layer: `generatePitchMap`/`geoToMidi`
  stop-rail pitch, `SCALES`/`MODES`, `transposeNoteInScale`, the `normalizeX` family,
  seeded RNG, polyline helpers, and the arpeggiator (`buildArpSequence`, `ARP_*`).
- `lib/routeTypes.js` — GTFS `route_type` → engine voice.
- `lib/shared/cities.js` descriptor model and the per-city data convention.
- `lib/songState.js` snapshot format — mobile reads/writes the **same** song snapshots,
  so songs sync between web and mobile for free.
- `lib/mockData.js` and the mock scheduling model (per-track independent loops).
- The **feed service** — unchanged; it is already a standalone WS server the mobile app
  connects to exactly like the browser does (`lib/liveClient.js` logic ports too: `ws` is
  available in RN via the built-in `WebSocket`).
- All `/api/*` contracts — presets/compositions CRUD, share links, AI Composer — consumed
  over HTTPS against the deployed Vercel app. No new backend.

## What must be rebuilt

### Audio: re-host `TransitEngine`

Phase order inside the engine port:

1. **Spike**: Tone.js on top of `react-native-audio-api`'s `AudioContext`
   (`Tone.setContext(...)`), playing one route's pitch map through a `PolySynth`. This
   single spike de-risks the whole plan.
2. Bring up the graph in dependency order: per-route synth → insert FX (filter/EQ/pan/vol)
   → line-type buses → destination; then FX send buses (`fxTrack.js`); then
   `networkState.js` / `alertLayer.js`.
3. Known likely gaps (verify in the spike, hand-roll if unsupported):
   - `Tone.GrainPlayer` (`granularVoice.js`) — fallback: scheduled
     `AudioBufferSourceNode` grains, which is all a grain player is.
   - `Tone.Sampler` buffer loading — samples must load from bundled assets
     (`expo-asset`) instead of `public/samples/...` URLs; keep the CC0 drum kit and
     `SAMPLER_PRESETS` in the app bundle.
   - Anything convolution/analyser-based in the FX buses — check node coverage in the
     react-native-audio-api docs per bus in `FX_BUSES`.
4. Voice budgeting from day one: a global voice cap + per-route polyphony cap (mirror the
   NYC metro-cap approach) with a low/med/high quality setting for low-end Android.

### Map/DAW tab (the flagship screen)

- **Map**: MapLibre RN. Route polylines from the preprocessed data as GeoJSON sources;
  stops as circle layers; mock/live vehicles as an animated symbol layer (reanimated
  shared values driving feature coordinates). Note pulses = short-lived circle
  animations at the stop, as on the web map.
- **Track lanes**: RN views — `FlashList` of lane rows; playhead + loop-region handles +
  automation curves drawn with `react-native-skia` (or Reanimated-driven views for v1).
- **Layout**: phones get a map-first screen with a **bottom sheet** mixer
  (`@gorhom/bottom-sheet`): collapsed = transport bar (play/stop, BPM, city), half =
  track list with volume/mute/solo, full = per-track detail (synth type, ADSR, arp,
  sends). Tablets can approach the desktop split view (map left, lanes right).
- **State**: MixerTab's state model (per-track settings mirrored into the engine via
  `engine.setX(...)`) carries over conceptually; extract the setter-wiring into a shared
  hook/store (e.g. Zustand) so web and mobile share the "UI state → engine calls" layer
  instead of duplicating MixerTab's ~everything.

### Auth + persistence

Better Auth ships an Expo client (`@better-auth/expo`): point it at the existing
`/api/auth/*` endpoints, store the session with `expo-secure-store`. `lib/persistence.js`
and `lib/compositions.js` are already plain `fetch` CRUD — they port with a base-URL
parameter and auth headers.

## Data pipeline change (prerequisite, benefits web too)

22 MB per city is a non-starter on mobile. Add a mobile-friendly output mode to
`scripts/preprocess_lines.js`:

- `lines.<city>.index.json` (~100s of KB): city metadata + per-route id/name/type/color/
  bounds/stop count — enough to render the route picker and start a session.
- `lines.<city>/<routeId>.json`: full stops + polyline per route, fetched on demand when
  a route is added to the mix, cached on device (`expo-file-system`).
- Additionally: polyline simplification (Douglas-Peucker to ~5 m tolerance) and gzip on
  Blob. Same Vercel Blob hosting, new `NEXT_PUBLIC_LINES_INDEX_URL_<CITY>` convention.

## Phasing

| Phase | Deliverable |
| --- | --- |
| **0 — Spike (1–2 wks)** | Expo app: Tone.js on react-native-audio-api plays one Budapest route's pitch map in mock mode. Go/no-go on the whole stack. |
| **1 — Engine port** | Full `TransitEngine` mock playback of a saved web song snapshot (synths, FX buses, arp, duplicates); voice caps; report of unsupported nodes + fallbacks. |
| **2 — Map/DAW UI** | MapLibre map + bottom-sheet mixer + track lanes; pick routes, disable/solo, per-track essentials; split-data pipeline in place. |
| **3 — Accounts & songs** | Better Auth sign-in, preset CRUD against production API, shared-song import — songs round-trip with the web app. |
| **4 — Live + secondary tabs** | Live mode over the feed WS (when city feeds are re-enabled); port Drum Machine / Motif etc. selectively — each already owns an isolated engine, so they're independent work items. |
| **5 — Store polish** | iOS background-audio entitlement + `AVAudioSession` playback category, Android foreground service for playback, app icons/splash, TestFlight/Play beta (`expo-dev-client` for dev builds, EAS for distribution). |

## Risks

- **react-native-audio-api coverage vs Tone.js expectations** — the top risk; entirely
  retired by Phase 0. Mitigation: the engine touches Tone through a known node list, so
  gaps are enumerable and each has an AudioBufferSourceNode/BiquadFilter-level fallback.
- **Low-end Android CPU** — voice caps + quality tiers; measure with a mid-tier device
  from day one, not just flagships.
- **MapLibre feature-animation throughput** with many vehicles — batch coordinate updates
  per frame; cap rendered vehicles like the web NYC fix.
- **Bundle size** — samples in-app plus per-route data on demand keeps the binary sane;
  audit with `npx expo-atlas`.
