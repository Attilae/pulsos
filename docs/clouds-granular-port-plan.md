# Clouds granular DSP port for Leið

Status (2026-09-30): phases 1–3 implemented behind `NEXT_PUBLIC_GRANULAR_ENGINE=clouds`
(default `grainplayer`, the unchanged original layer). The parameter adapter covers the existing
contract (phase 4, first half). Not yet done: listening A/B, browser/phone measurements (phase 5),
per-song engine identifier, new Clouds controls. Not yet auditioned. Build, mapping and
measurements: `dsp/clouds/README.md`.

The switch is deployment-wide rather than the per-song identifier phase 4 describes: a song plays
through whichever engine the build selects, with its saved settings unchanged. The per-song
identifier is still the plan for rollout (phase 6).

## Decision and scope

Port Mutable Instruments Clouds' **granular playback mode** to WebAssembly and run it in a Web Audio `AudioWorklet`. Use it as the optional granular **layer** on a transit lane, in parallel with that lane's dry instrument. Preserve the lane's existing gain, pan, inserts, sends, gating, and WAV recording path.

Do not treat the original firmware as a drop-in replacement for `Tone.GrainPlayer`. Clouds was designed to record live audio into a short circular buffer; Leið currently grains a two-second offline render of the lane's dry instrument. The first release should preserve Leið's source and note behavior, then expose Clouds features after the sound and performance are proven. Stretch, looping-delay, and spectral modes are outside the first port. In particular, spectral mode brings additional phase-vocoder and FFT dependencies.

## Current behavior to preserve

- [`lib/granularVoice.js`](../lib/granularVoice.js) owns one `Tone.GrainPlayer`, an amplitude envelope, and output gain per enabled route. It plays a continuous grain stream; stop events gate the envelope and set pitch. It is not a separate polyphonic grain voice for every note.
- [`lib/engine.js`](../lib/engine.js) renders two seconds of the route's dry instrument at C4 with `Tone.Offline`, gives that buffer to the granular voice, and connects the voice to the route's gain alongside the dry synth. Instrument edits can regenerate the source. Chords use their first note for granular pitch.
- [`lib/soundSpecs.js`](../lib/soundSpecs.js) defines `DEFAULT_GRANULAR`: enable, mix, grain size, overlap, playback rate, loop window, reverse, jitter, attack, and release.
- [`components/DawView.jsx`](../components/DawView.jsx) exposes the controls and granular automation targets. [`components/tabs/MixerTab.jsx`](../components/tabs/MixerTab.jsx) owns route configuration; [`lib/songState.js`](../lib/songState.js) saves and restores it. [`lib/ai/planContract.js`](../lib/ai/planContract.js) and [`lib/ai/planSnapshot.js`](../lib/ai/planSnapshot.js) also understand this configuration.
- The granular mix adds output to the dry instrument rather than crossfading the dry instrument away. Existing songs may depend on that balance.

The existing sampler-source C4 rendering can be mistuned when a preset's source zone has a different root key. Treat this as a separate, audible regression test; the port must not silently claim to fix it.

## Target architecture

```text
route dry instrument ────────────────────────────────────┐
                                                        ▼
dry instrument → two-second offline render → source load → Clouds Wasm
                                         controls/notes → AudioWorkletNode
                                                        │
                                         envelope + layer gain
                                                        │
                                                        ▼
                                                   routeGain → lane FX/sends/master
```

The worklet owns one Clouds DSP instance per enabled lane. A JavaScript wrapper retains the current `GranularVoice` lifecycle (`setBuffer`, `set`, `setMix`, note attack/release, and `dispose`) so `TransitEngine` can adopt the new implementation without changing route output topology. Load the Wasm module once per `AudioContext`, then create separate DSP state for each lane. Only enabled lanes should incur DSP cost.

The source render must be transferred to the worklet **before** it is used for audio. Do not allocate, fetch, compile Wasm, decode audio, or rebuild buffers in the rendering callback. Timestamp note triggers with the audio clock and queue them inside the worklet; a main-thread message that means "trigger immediately" can miss Leið's scheduled stop time. Continuous controls should use scheduled `AudioParam` values where practical; infrequent structural changes can use messages with a defined block-boundary application point.

### DSP adaptation choices to prove in the prototype

1. **Source memory:** Stock Clouds has a short 32 kHz circular recording buffer. The current Leið source is two seconds. Prefer extending the buffer to hold the full source at the chosen channel count and quality; if that changes the sound or exceeds practical mobile memory, compare a documented mono/downsampled option. Do not silently crop the source.
2. **Sample rate:** Clouds assumes 32 kHz in several DSP paths. Resample the browser input/output at the node boundary or change *all* rate-dependent DSP constants. Boundary resampling is the first approach because it keeps upstream behavior easier to compare.
3. **Static source:** Add a controlled load-and-freeze path for Leið's rendered sample. Clouds' ordinary input-recording and `freeze` behavior should not overwrite the source unexpectedly during note playback.
4. **Processing cadence:** Firmware calls `Prepare()` outside its 32-sample audio callback. The browser invokes the worklet in rendering blocks, currently 128 frames but not guaranteed to stay that size. Adapt initialization and preparation so no unbounded work lands in `process()`, and process whatever block length the browser supplies.
5. **Dependencies:** Port only the Clouds DSP, resource tables, and needed MIT-licensed `stmlib` DSP utilities. Exclude STM32 drivers, bootloader, and unrelated third-party code. The upstream `granular_processor.cc` includes hardware-specific debug headers, so a host wrapper or small source patch is required.

## Parameter contract

Do not reuse a saved parameter name merely because its numeric range resembles a Clouds parameter. Define the conversion in one adapter and test its musical result.

| Existing Leið control | First-port treatment |
| --- | --- |
| `enabled` | Create/dispose the lane's Clouds node; keep disabled lanes silent and inexpensive. |
| `mix` | Layer output gain, preserving additive dry-plus-grain behavior. Use Clouds' wet path internally. |
| `grainSize` | Map seconds to Clouds `size` using a measured lookup; the upstream knob is normalized and nonlinear. |
| `overlap` | Map the existing seconds-based overlap to Clouds `density`; there is no exact one-to-one conversion. Establish a perceptual calibration. |
| `loopStart`, `loopEnd` | Restrict the loaded source region or extend Clouds' position logic. Its stock `position` is a point in a circular buffer, not Leið's bounded loop window. |
| `jitter` | Add controlled source-position variation if it is retained; stock Clouds has random grain timing but no equivalent independent Leið jitter control. |
| `playbackRate` | Requires an extension or source resampling to remain independent of pitch. Clouds' `pitch` alone does not preserve this control. |
| `reverse` | Requires a DSP/source-read extension or a reversed source. Do not map it to negative pitch: the stock grain playback path uses a positive rate. |
| `attack`, `release` | Keep the lane's outer amplitude envelope and scheduled note gates. |

New Clouds controls such as texture, freeze, stereo spread, feedback, and reverb should be added after the existing contract is stable. Clouds' reverb and feedback would add to Leið's lane FX, so defaults should be conservative and auditioned. Every new value needs UI, automation, AI-plan validation, snapshot persistence, and a documented default.

## Phased implementation

### Phase 1 — Native/Wasm DSP proof

**Deliverables**

- Pin an upstream Clouds commit and vendor only the required source, resource tables, and `stmlib` files with their notices. Give the derivative a Leið-specific name rather than using Mutable Instruments' product name as its own product identity.
- Build a small host-independent C interface for create, destroy, source load, parameter updates, trigger, and block processing. Compile it natively and to Wasm.
- Render deterministic test input through both builds. Compare output length, channels, onset, silence/NaN behavior, and basic spectral shape. Document expected differences from platform math or resampling.

**Gate:** Wasm produces audible, stable granular output from a known source, and the native build provides a reproducible reference. If a full `GranularProcessor` build pulls in unnecessary spectral/hardware code, reduce the port to the granular player plus the specific buffer and post-processing stages needed for the target sound.

### Phase 2 — Worklet and source bridge

**Deliverables**

- Implement and load an `AudioWorkletNode` in the existing Tone.js `AudioContext`. Initialize Wasm once per context and allocate per-lane state before playback.
- Transfer decoded source samples to the worklet, resample at the boundary, and load/freeze them without interrupting the audio callback. Define behavior while a new instrument render is pending.
- Implement timestamped note events and smoothed parameter changes. Dispose nodes, ports, and buffers when a lane is disabled or the engine stops.

**Gate:** One standalone node plays, changes pitch and grain controls, replaces its source, and stops without clicks or browser worklet errors. Test a browser sample rate other than 32 kHz.

### Phase 3 — One-lane integration

**Deliverables**

- Replace the internals of `GranularVoice` behind a selectable implementation while retaining its public lifecycle. Route its output through the existing `routeGain` path.
- Feed it the current two-second dry instrument render. Match note scheduling, first-note chord behavior, layer mix, envelope, stop/start, source regeneration, disable/solo, and disposal.
- Verify that full-mix and stem WAV recording include the granular layer.

**Gate:** A single route remains playable through all existing lane controls and export paths. A/B audition it against the current `GrainPlayer` layer at several pitches and source types; differences are expected, but they must be intentional and recorded.

### Phase 4 — Controls, automation, and song compatibility

**Deliverables**

- Finish the parameter adapter above, including explicit behavior for reverse, window, jitter, and independent rate. Update desktop controls and labels where the behavior genuinely changes.
- Keep saved songs with no engine identifier on the legacy implementation. Add a granular-engine identifier to new song state and AI plans, with normalization for unknown or missing values. Avoid globally changing the meaning of existing `grain.*` automation targets.
- Cover duplication, city changes, shared-song import, AI composition plans, and snapshot round-trips. Add new Clouds controls only with matching persistence and automation rules.

**Gate:** Old songs load with their previous sound; new songs round-trip without losing parameters; automation moves the intended DSP control during playback.

### Phase 5 — Performance and audio validation

**Deliverables**

- Benchmark 1, 4, and 8 enabled lanes on desktop and a representative phone. Record worklet processing time, missed blocks/glitches, memory, and Wasm download/initialization cost; compare the same songs with `GrainPlayer`.
- Audition synthetic and sampled instruments, low and high notes, dense transit patterns, rapid enable/disable, synth edits, tempo changes, tab changes, city changes, and WAV export. Check cold and warm loading.
- Run `npm run build` for each audio/UI integration change. Add focused pure tests for parameter conversion and snapshot migration. A green build alone does not verify the sound.

**Gate:** Define the supported simultaneous-lane limit from measurements. At that limit, playback has no repeatable glitches on supported devices, and the musical result is approved by listening.

### Phase 6 — Rollout and retirement

**Deliverables**

- Ship Clouds as an opt-in engine for new songs while retaining `GrainPlayer` for existing songs. Track initialization failures and provide a recoverable fallback to the legacy layer.
- After real-session comparison, make Clouds the default for newly created songs. Keep the old implementation for saved songs unless an explicit migration and sound change are accepted.
- Update composer guidance and the project architecture notes once the shipped behavior is known. Remove experimental build artifacts and keep upstream attribution with the distributed Wasm.

**Gate:** New songs use Clouds by default, existing songs retain expected playback, and worklet failure does not break the dry lane.

## Sources and license

- [Mutable Instruments Clouds source](https://github.com/pichenettes/eurorack/tree/master/clouds), especially [`granular_processor.h`](https://github.com/pichenettes/eurorack/blob/master/clouds/dsp/granular_processor.h), [`granular_processor.cc`](https://github.com/pichenettes/eurorack/blob/master/clouds/dsp/granular_processor.cc), and [`parameters.h`](https://github.com/pichenettes/eurorack/blob/master/clouds/dsp/parameters.h).
- [Clouds manual](https://pichenettes.github.io/mutable-instruments-documentation/modules/clouds/manual/) describes its continuous recording, freeze, grain controls, and alternate modes.
- [Eurorack repository licensing and derivative guidance](https://github.com/pichenettes/eurorack) and [`stmlib` license](https://github.com/pichenettes/stmlib/blob/master/LICENSE). The DSP code is MIT licensed; `stmlib` also contains unrelated third-party code with other terms, which should not be vendored into this port.
- [Web Audio worklet processing contract](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletProcessor/process) and [Emscripten Wasm Audio Worklets guidance](https://emscripten.org/docs/api_reference/wasm_audio_worklets.html).
