# Transit DAW → JUCE VST3/AU Instrument Plugin

## Context

The Transit DAW currently lives as a web app: a Node.js server polls BKK GTFS-RT data and a React + Tone.js frontend sonifies the live transit network. The project CLAUDE.md calls out a VST plugin as a future deliverable. This document is the plan to get there using **JUCE**.

The goal is a **VSTi (instrument plugin)** that can be loaded inside any host DAW (Logic, Ableton, REAPER, Bitwig, Cubase) and produce the same five-layer sonification of Budapest transit. It exposes the line-type architecture as separate output buses so users can mix/process each line type on its own DAW track, while keeping network-wide elements (drone, hub chords, alert-driven mode) coherent inside the plugin.

### Locked design decisions
- **Plugin role**: Full VSTi — port the FM voice pool, network drone, hub chord PolySynths, alert layer, and FX matrix to JUCE DSP.
- **Data source**: Reuse the existing Node server (`server/bkkFeed.js` + `server/gtfsLoader.js`). The plugin connects to it over localhost WebSocket from a background thread.
- **Instance model**: Single plugin, multi-bus output — 4 stereo buses (metro, tram, bus, hev). Network drone + hub chords route to an extra "network" bus.
- **Delivery**: MVP first, phased to feature parity.

---

## Target architecture

```
Companion process (Node — existing)
  server/bkkFeed.js  -- 5s/60s poll BKK GTFS-RT
  server/index.js    -- ws://localhost:PORT, emits vehicle_update / trip_update / arrival / alert_update

JUCE VST3/AU plugin (new)
  ┌── DataLink (background thread) ── ws client ─┐
  │     parses JSON events, pushes into          │
  │     lock-free SPSC queue → audio thread       │
  └───────────────────────────────────────────────┘
                          │
                  TransitEngine (audio thread)
                  ├─ VoicePool<150>   (per-vehicle FM voices)
                  ├─ NetworkState     (centroid drone + hub PolySynths)
                  ├─ AlertLayer       (mode switch + master reverb/comp/limit)
                  ├─ FxBusMatrix      (13 sends)
                  └─ Mappings         (pure functions — direct port of mappings.js)

  Output bus layout (AudioProcessor)
    Bus 0  "metro"   stereo
    Bus 1  "tram"    stereo
    Bus 2  "bus"     stereo
    Bus 3  "hev"     stereo
    Bus 4  "network" stereo  (drone + hub chords, post-AlertLayer)
```

Mock playback (current `engine.js` scheduled mode) is **out of scope** for the plugin — the host DAW provides transport, and offline/replay testing is done by pointing the companion server at a recorded GTFS snapshot.

---

## Phased delivery

### Phase 1 — MVP: scaffold + per-vehicle voice + live data
Goal: 4-bus stereo plugin loads in a host, connects to the Node server, and produces per-vehicle FM notes driven by real BKK data. No network drone, no FX matrix, no alerts yet.

Deliverables:
1. **JUCE project scaffold** under `juce/` at repo root (CMake + JUCE 8.x as git submodule).
   - Targets: VST3 + AU, macOS universal + Windows x64.
   - PluginProcessor with the 5-bus output layout above (network bus muted in Phase 1 but reserved).
2. **`Mappings.h/.cpp`** — line-for-line port of `src/mappings.js`:
   - `latToNote`, `lngToPan`, `speedToVibrato`, `occupancyToModIndex`, `delayToDetune`, `bearingToPanNudge`
   - Mode tables (dorian, phrygian, aeolian, lydian, mixolydian, lydian_dominant, phrygian_dominant, chromatic)
   - All `normalize*` functions for automation (kept for Phase 3)
   - Pure functions, header-only where possible — easiest piece, port first.
3. **`VehicleVoice.h/.cpp`** — JUCE port of `src/vehicleVoice.js`:
   - `juce::dsp::Oscillator` + manual FM (carrier + modulator with `harmonicity` + `modulationIndex`) — avoids pulling external libs in MVP.
   - `juce::ADSR` for amplitude envelope (percussive + harmonic presets matching JS file).
   - `juce::dsp::Panner` for stereo position.
   - 400 ms portamento via `juce::SmoothedValue<float, ValueSmoothingTypes::Linear>` on frequency.
   - State machine matching GTFS `currentStatus` (0/1 attack, 2 release, 3 canceled-glide, 7 deleted-immediate-release).
4. **`VoicePool.h/.cpp`** — replicates `engine._voices` map (vehicleId → VehicleVoice):
   - `std::unordered_map<std::string, std::unique_ptr<VehicleVoice>>`
   - Hard cap **150**, oldest-by-lastUpdated eviction (matches `engine.js:351,914-926`).
   - Sums each voice into the bus matching `lineType` (metro/tram/bus/hev).
5. **`DataLink`** — background-thread WebSocket client:
   - Library choice: **ixwebsocket** (small, no deps, MIT) added via CPM/FetchContent.
   - Parses incoming JSON with `juce::JSON`.
   - Pushes parsed `VehicleUpdate` structs into a `juce::AbstractFifo`-backed lock-free SPSC queue.
   - Reconnect-with-backoff on disconnect; surfaces connection state to UI.
6. **Audio-thread drain**: in `processBlock`, drain the queue and apply updates to the voice pool **before** rendering audio. No allocation, no locks on the audio thread.
7. **Minimal UI** — `juce::AudioProcessorEditor` showing:
   - Companion server URL field (default `ws://localhost:8787`) + connect/disconnect button
   - Connection status indicator + live vehicle count
   - 4 line-type faders (gain, mute) — host params, automatable
   - Master gain
8. **Companion server tweak** — confirm `server/index.js` exposes a stable WS endpoint and event schema the plugin can rely on. Document the contract in `docs/vst-protocol.md`.

Critical existing files to study for the port (do NOT modify in Phase 1):
- `src/mappings.js` — direct translation target for `Mappings.cpp`
- `src/vehicleVoice.js` — direct translation target for `VehicleVoice.cpp`
- `src/engine.js` (lines 45-47, 308-320, 351, 914-926) — voice pool semantics + update shape
- `server/index.js` — WS event schema reference

Verification:
- Load plugin in REAPER or AudioPluginHost (ships with JUCE) → 5 output buses appear.
- `npm run dev` to start the companion server with mock or live data.
- Plugin connects, vehicle count climbs, notes audible on metro/tram/bus/hev buses with correct pan and pitch matching `latToNote`.
- Drop the WS connection → voices fade out gracefully (release envelopes), reconnect → notes resume.
- pluginval (run as a CI step) passes strictness level 5.

---

### Phase 2 — Network state + alert layer
Goal: Add the network-wide audio layer and harmonic mode logic.

Deliverables:
1. **`NetworkState.h/.cpp`** — port of `src/networkState.js`:
   - Density drone FM synth with 16 s pitch glide on root change.
   - Hub PolySynths (constant `HUBS` array ported as a `static constexpr` table).
   - Aggregation tick driven from `processBlock` (every ~5 s of host time, not wall-clock) — avoids fighting host bypass/freeze.
   - Routes to the **"network" output bus** (Bus 4).
2. **`AlertLayer.h/.cpp`** — port of `src/alertLayer.js`:
   - Mode-switch state machine with 8 s transition (matches existing behaviour).
   - Master reverb (`juce::dsp::Reverb`), compressor (`juce::dsp::Compressor`), limiter (`juce::dsp::Limiter`) chain.
   - Severity-driven reverb decay/wet ramps (6 s wet ramp, 6.5 s decay regen).
   - **Important**: the limiter sits per-bus, not across the host's output — each of the 5 buses is independently limited so the host's track sums stay clean.
3. **Alert ingestion** — `DataLink` already parses `alert_update`; pipe through to AlertLayer's lock-free input.
4. **UI additions**:
   - Read-only mode indicator ("Currently: Dorian — neutral")
   - Network drone level fader
   - Hub chord level fader
   - Active alerts list (last 5)

Verification:
- Inject a fake `alert_update` from the companion server (`server/index.js` debug endpoint) with each cause/effect combo → mode label updates after 8 s and notes audibly recontextualise.
- Severity 3 alert → reverb tail extends to ~8 s, wet ramps over 6 s.
- Hub chord PolySynths trigger when vehicle clusters form at hub coords; release when they disperse.

---

### Phase 3 — FX matrix, synth library, automation, host integration
Goal: Reach parity with the web app and deliver a polished plugin.

Deliverables:
1. **`FxBusMatrix.h/.cpp`** — 13 FX buses (reverb, jcreverb, delay, pingpong, chorus, phaser, tremolo, vibrato, autofilter, autopanner, wah, distortion, bitcrusher, widener):
   - Built on `juce::dsp` modules where possible; reach for **chowdsp_utils** (BSD-3, well-maintained) for the bitcrusher, ping-pong delay, JC reverb, and wah — saves writing them from scratch.
   - Send levels as `juce::SmoothedValue` (100 ms ramp matching `engine.js:210-242`).
2. **Synth library** — extend `VehicleVoice` to support all 9 synth types from `engine.js:168-192` (Synth, FMSynth, AMSynth, MonoSynth, MembraneSynth, MetalSynth, NoiseSynth, PluckSynth, DuoSynth). Per-route synth-type selection exposed as a discrete host parameter.
3. **AutomationTrack port** — `src/automationTrack.js` translated to `AutomationLane.h/.cpp`. Sources read from the queue's `trip_update` payload; targets map to existing synth/FX params via a small dispatch table.
4. **Host parameter surface** — expose key controls via `juce::AudioProcessorValueTreeState`:
   - 4 × line-type {gain, pan, mute}, master gain, network drone level, hub chord level
   - Scale root + mode override (so users can override alert-driven mode)
   - Per-FX-bus wet
   - Send matrix as one parameter per `(lineType, fxBus)` cell (60 params — within VST3 limits)
5. **State persistence** — `getStateInformation`/`setStateInformation` serialising scale, mode override, server URL, send matrix, automation lanes (mirrors the React state in `App.jsx:20-62`).
6. **Preset bank** — ship a handful of `.vstpreset` files mirroring useful configurations (e.g., "Rush hour ambient", "Sparse night network").
7. **CI + signing**:
   - GitHub Actions matrix building VST3+AU on macOS, VST3 on Windows.
   - macOS notarisation + Windows code signing (deferred until certificates available).
   - pluginval strictness 10 in CI.

Verification:
- Load in Logic, Ableton, REAPER, Bitwig → instantiates, buses route correctly, host parameters automate.
- Send matrix changes in the plugin UI match the same audible result as the web app for identical input.
- Save project → reopen → plugin restores send matrix, mode override, server URL, scale selection.
- pluginval strictness 10 passes; no audio-thread allocations under `--validate-in-process`.
- A/B audio comparison with the web app on a recorded 60-second BKK snapshot — spectra and key sonic events match within reasonable tolerance.

---

## Files to create (new)

```
juce/
  CMakeLists.txt
  JUCE/                          (submodule)
  Source/
    PluginProcessor.h/.cpp       (5-bus AudioProcessor)
    PluginEditor.h/.cpp          (UI)
    engine/
      TransitEngine.h/.cpp       (top-level audio object owned by processor)
      Mappings.h/.cpp            (port of src/mappings.js)
      VehicleVoice.h/.cpp        (port of src/vehicleVoice.js)
      VoicePool.h/.cpp           (port of engine.js voice mgmt)
      NetworkState.h/.cpp        (port of src/networkState.js)        [P2]
      AlertLayer.h/.cpp          (port of src/alertLayer.js)          [P2]
      FxBusMatrix.h/.cpp         (port of src/fxTrack.js)             [P3]
      AutomationLane.h/.cpp      (port of src/automationTrack.js)     [P3]
    data/
      DataLink.h/.cpp            (WS client + SPSC queue)
      Events.h                   (POD update/alert/trip structs)
  ThirdParty/
    ixwebsocket/                 (FetchContent in CMake)
    chowdsp_utils/               (FetchContent, P3)
docs/
  vst-protocol.md                (companion server ↔ plugin contract)
```

## Files to read / reference (existing, do not modify in Phase 1)

| Existing JS | Used to port |
|-------------|--------------|
| `src/mappings.js` | `Mappings.cpp` |
| `src/vehicleVoice.js` | `VehicleVoice.cpp` |
| `src/engine.js:45-47,75-83,168-202,210-242,308-320,351,914-926` | `VoicePool.cpp`, `TransitEngine.cpp` |
| `src/networkState.js` | `NetworkState.cpp` (P2) |
| `src/alertLayer.js` | `AlertLayer.cpp` (P2) |
| `src/fxTrack.js` | `FxBusMatrix.cpp` (P3) |
| `src/automationTrack.js` | `AutomationLane.cpp` (P3) |
| `server/bkkFeed.js`, `server/index.js` | WS protocol reference |
| `src/App.jsx:20-62,106-249` | State surface to mirror in `APVTS` |

## Things to NOT do
- Don't port `engine.js`'s `Tone.Transport`-based mock scheduling — host owns transport.
- Don't replicate `MapView.jsx` / `DawView.jsx` in the plugin — the plugin UI is a small control surface, not a visualizer (visualizer can stay in the web app).
- Don't fight the host's master section — limiter stays per-bus, no global limiter that collides with the user's mastering chain.
- Don't do network I/O on the audio thread. All BKK traffic stays on `DataLink`'s background thread, communicating via lock-free queues.

## Risks & open questions
- **WebSocket library**: `ixwebsocket` is the recommended choice but `juce::URL` + `juce::WebInputStream` can't do WS upgrades. Alternative: roll a thin client on `juce::StreamingSocket`. Decide before Phase 1 starts.
- **Symbol size of 150 voices × FM synth × oscillator quality**: should be fine on modern hardware (Tone.js handles it in a single browser tab), but profile early — the Tone.js per-voice cost is higher than a tight JUCE implementation, so 150 should be comfortable headroom.
- **Companion server discoverability**: users need to know to run it. Phase 1 keeps the URL field manual; Phase 3 could ship a small menubar/tray helper that launches the Node server.
- **VST3 parameter count** for send matrix in P3 is borderline (60 cells). If automation surface grows, consider exposing only "currently selected" send via the host and keeping the full matrix as plugin-internal state.
