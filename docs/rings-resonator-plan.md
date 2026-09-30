# Rings-derived Resonator implementation plan

Status: **implemented behind `NEXT_PUBLIC_RESONATOR_ENABLED` (off by default); the
Phase 6 release gates are still open.** Updated 2026-09-30.

Done: Phases 1–5. The DSP is vendored and builds reproducibly (wasi-sdk rather
than Emscripten, see `dsp/resonator/README.md`), and native and wasm renders are
bit-identical. Also built: the worklet host and voice adapter, the engine and
Song Chainer readiness paths, the desktop and phone editors, persistence, AI/MCP
vocabulary, advisories and licence credits. Covered by
`test/resonator-{dsp,worklet,plan}.test.js`, and verified playing in desktop
Chrome.

Open: Firefox/Safari/iPhone/Android testing, multi-lane and 10-minute load runs,
Song Chainer crossfades with two Resonator sections, choosing the final voice
count and defaults by listening, and auditioning sound recipe R16. Until those
pass, keep the flag off. With the flag off, the picker and AI plans don't offer
the Resonator, but songs that already use it still play. Measurements are in
`dsp/resonator/README.md`.

Deviations from this plan:
- The toolchain is wasi-sdk instead of Emscripten.
- Notes snap to the nearest 24-sample block (±0.25 ms, inside the 1 ms target)
  rather than being split sample-accurately, which keeps upstream's block cadence.
- A lane voice-count control (1–4) is exposed, so the voice-count decision can be
  made by ear.
- WAV capture was audited but not changed. It records steady-state playback, so a
  loop-length capture already contains the previous pass's ring-out and loops
  seamlessly.

## Outcome and scope

Add **Resonator** as a selectable lane instrument, powered by the original Rings
C++ DSP compiled to WebAssembly and hosted in an AudioWorklet. A station arrival
excites a pitched resonator; its output enters the existing lane mixer and effects.

Initial release includes:

- Modal, sympathetic-string and string models, using the internal exciter.
- Structure, Brightness, Damping and Position controls on desktop and phone.
- Scheduled notes, per-stop velocity, arpeggiators and overlapping note tails.
- Lane duplication/remapping, saved/shared songs, Song Chainer, MIDI and WAV export.
- AI Composer and MCP plan vocabulary, using the same validated parameter definitions.

Deferred: external audio excitation/routing, bonus and string-synth modes, new
resonator-specific automation targets, sustained/legato playing, and granular
layering. Existing lane mix/FX automation remains available. Live mode stays
disabled app-wide; exercise its note-dispatch adapter without enabling feeds.

Use the public name **Resonator** and internal synth type `Resonator`. Attribute
the Rings DSP to Emilie Gillet in source notices and the app's licenses page.
The source carries MIT notices; retain these for all vendored code and distributed
artifacts. Follow upstream's derivative naming guidance.

## Architecture and integration map

```text
Tone.Part callback's audio-context timestamp
    → ResonatorVoice adapter → timestamped processor event queue
    → WASM Rings DSP at 48 kHz → buffer / sample-rate adapter
    → existing routeGain → filter / EQ / duck / pan / sends → master / WAV capture
```

Load and compile the WASM module once per asset version. Register the worklet once
per audio context; give each lane independent DSP state. Share compiled code,
never mutable instrument state, across lanes or Song Chainer engines.

| Area | Existing integration point | Planned change |
| --- | --- | --- |
| Voice creation and events | `lib/engine.js`: `_makeSynth`, `_triggerSynth`, `_triggerLegatoNote`, `setSynthType`, `updateEnvelope` | Add adapter, type-specific parameters, preparation and cleanup |
| Routing | `lib/engine.js`: `_createSingleRouteEntry` | Connect adapter output to existing `routeGain` |
| Sound definitions | `lib/soundSpecs.js` | Type, picker entry, defaults, ranges and capabilities; keep imports server-safe |
| Desktop and phone | `components/DawView.jsx`, `components/mobile/LaneSheet.jsx` | Shared resonator parameter editor and capability-aware controls |
| State and lane lifecycle | `components/tabs/MixerTab.jsx`, `lib/songState.js` | Save/replay normalized parameters, duplication, reset and remapping |
| Section preparation | `lib/snapshotPlayer.js`, `lib/songChainPlayer.js` | Warm DSP assets and await instrument readiness before scheduling sections |
| Existing worklet bridge | `lib/masterBus.js`: `_installTruePeak` | Reuse registration/context conventions, not the limiter's fallback sound |
| Grain source rendering | `lib/engine.js`: `_renderGranularSource` | Explicit capability guard in v1; separate offline DSP renderer later |
| Plans and prompts | `lib/ai/planSchema.js`, `planContract.js`, `planApply.js`, `planSnapshot.js`, `planAdvisories.js`, `soundPolicy.js` | Admit and describe supported sound parameters in both apply paths |
| Attribution | `app/licenses/page.jsx` | Include DSP and dependency credits/notices |

Proposed new files/directories (names may be refined during implementation):

- `vendor/rings/`: pinned upstream DSP/resources and required `stmlib` subset,
  notices, provenance manifest, and separately recorded local patches.
- `dsp/resonator/`: C++ bridge, build configuration and reference-render harness.
- `scripts/build-resonator.*`: reproducible build using a pinned Emscripten version.
- `public/worklets/resonator-processor.js`: self-contained worklet without imports/exports.
- `public/wasm/`: versioned WASM artifact and build manifest.
- `lib/resonatorLoader.js`: module cache, context registration, readiness and errors.
- `lib/resonatorVoice.js`: Tone-compatible instrument adapter.
- `lib/resonatorSpecs.js`: pure parameter normalization and capability definitions,
  consumed or re-exported by `soundSpecs.js`.
- `components/ResonatorControls.jsx`: controls shared by desktop and phone.

## Musical behaviour to implement

| Feature | Initial behaviour |
| --- | --- |
| Pitch | Convert the engine's note to MIDI pitch; validate the supported range in the DSP spike |
| Trigger | One note event produces one internal strike/pluck |
| Velocity | Per-voice strike level; changing one note must not rescale older overlapping tails |
| Duration / ADSR | Natural resonant decay controlled by Damping; no conventional ADSR or note-off truncation |
| Note length | Hide/disable the audible gate control for this source; retain duration as MIDI articulation metadata |
| Arpeggiator | Each step strikes the resonator; gate length does not shorten its decay |
| Legato / glide | Mark unsupported in UI and plan advisories; saved values must not suppress subsequent strikes |
| Release | Ordinary note-off leaves the natural tail; stop/dispose/panic cancels queued notes and fades/reset voices |
| Disable / solo / chance / rest | Preserve existing lane gating and gain behaviour; skipped notes never enter the processor queue |
| Model switch | Smoothly retire/reset old resonances rather than abruptly reinterpreting active DSP state |

Keep the upstream four timbre values normalized to their supported ranges. Establish
and audition defaults in the spike; do not label a speculative patch a finished preset.
Clamp/reject invalid values consistently, including non-finite values from imported songs.

**Polyphony decision:** a native Rings `Part` cycles through recent strikes and takes
one pitch/strum state per render block. It is not an arbitrary simultaneous-note API.
The initial candidate is a bounded pool of monophonic Parts inside one worklet per
lane, with independent velocity gains and deterministic oldest-voice stealing.
This makes simultaneous chord events and per-note velocity explicit. Prototype two
and four voices; choose the shipped default after measuring CPU and listening.
Multiple mono Parts differ from native Rings' distribution of resonator resources,
so compare their sound as well as cost. If the pool exceeds the budget, resolve the
allocation design before app rollout; do not silently drop chord members.

## Phase 1: reproducible DSP and browser proof

- [ ] Pin the eurorack commit and its matching `stmlib` revision. Vendor only required
  DSP/resources/dependencies; record source URLs, revisions, licenses and modifications.
- [ ] Compile with portable math paths instead of ARM assembly. Start from upstream's
  desktop-test source list and `TEST` portability switches; exclude drivers/bootloader.
- [ ] Expose a small C ABI for create/init, parameters, trigger, render, reset and
  destroy. Explicitly initialize all state, buffers and PRNG state.
- [ ] Keep DSP at 48 kHz and its original 24-sample processing cadence. Use bounded
  buffering to produce the worklet's actual output-array length. Resample at the
  boundary for other context sample rates; do not assume requesting 48 kHz guarantees it.
- [ ] Compile WASM ahead of rendering and instantiate prepared state before readiness.
  Avoid network calls, memory growth and unbounded allocations in the render callback.
- [ ] Run each of the three models in a small local browser harness using the candidate
  voice pool, including simultaneous notes and different velocities.
- [ ] Produce native and WASM reference renders with identical inputs, patches and
  random seeds. Compare output within documented floating-point tolerances and listen.

**Exit gate:** audible output from all models, correct tuning at 44.1/48 kHz host
rates, finite/bounded output at parameter extremes, measured onset delay and CPU for
two/four voices. Record results, device/browser versions, toolchain, patch values and
artifact size. Test 96 kHz where supported. No unqualified fidelity claim from a build.

## Phase 2: runtime adapter and scheduling

- [ ] Implement the interface exercised by the engine: `connect`, `disconnect`,
  `dispose`, `set`, `triggerAttackRelease`, `triggerAttack`, `triggerRelease`,
  `releaseAll`, and explicit readiness. Verify any `.toDestination()` call sites.
- [ ] Register through `rawContext.audioWorklet.addModule`, then use the compatible
  Tone-context node bridge. Do not use Tone's first-URL-caching module helper.
- [ ] Send audio-context timestamps, not Transport positions or message-arrival times.
  Queue events ahead of playback in a bounded queue. Define ordering for simultaneous
  notes, overflow behaviour, and late-event handling; prevent an accumulated burst
  of stale notes after suspension.
- [ ] Account for internal blocks, pitch filtering and resampling delay. Measure the
  remaining onset error against a scheduled reference click. Target at most 1 ms of
  added onset error after compensation for on-time events; adjust the implementation
  or explicitly document any measured limit before advancing.
- [ ] Make stop/restart, seek/rebuild, synth changes and disposal invalidate pending
  events through generation IDs or equivalent cancellation. An old note-off must
  never release a newly stolen voice.
- [ ] Smooth parameter changes at the appropriate DSP cadence and declick stealing,
  model changes, stopping and graph replacement. Verify the two Rings outputs' blend,
  stereo behaviour and mono compatibility rather than treating AUX as generic right audio.
- [ ] Cache successful loads, clear retryable failed promises, handle `processorerror`,
  and provide loading/error/retry states. Never silently substitute another instrument.

**Exit gate:** scheduled notes remain aligned through tempo changes and repeated
start/stop; no stuck audio or growing memory after repeated creation/disposal.
The existing master-limiter worklet and Resonator load successfully in either order.

## Phase 3: lane engine, readiness and Song Chainer

- [ ] Add an explicit prepare step for required sound assets and voice readiness before
  transport start. Keep `unlockAudio()` synchronous in the user gesture before other
  awaits; fetch/compile may begin earlier without starting audio.
- [ ] Preserve synchronous factory use after preparation where practical. Handle any
  per-node ready handshake before the first note, rather than dropping early notes.
- [ ] Wire the factory, parameter updates, voice dispatch and existing route graph.
  Make capability checks explicit so Resonator bypasses conventional envelope/legato paths.
- [ ] For hot swaps, prepare the new voice before retiring the old graph; use a request
  token so rapid selection changes cannot install an obsolete voice. On failure keep
  the previous valid state and report the failed change.
- [ ] Warm assets when opening songs and preparing chains. Extend snapshot/section
  preparation to cover the first section and both crossfading engines. Keep graph
  creation and compilation away from section boundaries.
- [ ] Define failure behaviour before scheduling: initial play stays stopped with an
  actionable error; a section that cannot become ready must not start as a silent song.
  Cancel its pending work and stop the chain cleanly with an error.
- [ ] Guard granular-layer creation for this instrument. Preserve saved grain settings
  while marking them unavailable, and prevent plan/UI paths from implying they play.

**Exit gate:** a real transit lane plays through the existing mixer, FX, sidechain and
master; all three models survive tab changes, city resets and sound changes. Two
Resonator sections cut/crossfade without missing first notes or interfering with each
other's Transport callbacks or DSP state.

## Phase 4: controls and saved songs

- [ ] Add `Resonator` to `SYNTH_TYPES` and `PICKER_SYNTH_TYPES` only once playback is ready.
- [ ] Build a shared editor with model selector and four labelled timbre controls.
  Follow `DESIGN.md`, existing reset gestures, accessibility and phone touch targets.
- [ ] Store model/timbre fields in the existing flat per-lane `trackADSRs` parameter
  map, keyed by `trackSynthTypes: Resonator`; bypass Tone envelope conversion for them.
  Keep pure defaults/normalization separate from audio code. No DB migration is expected.
- [ ] Confirm both snapshot build/apply paths preserve the fields. Cover absent defaults,
  malformed imports, switching away/back, duplicate lanes, remapping/removal, Save As,
  shared-song import and session reset. Older songs must retain their existing sound.
- [ ] Add source capability hints for natural decay, unsupported legato and grains;
  avoid exposing inert ADSR controls. Readiness/errors should describe the user action,
  without surfacing WASM/compiler details.
- [ ] Verify MIDI note/velocity output and explain that MIDI does not embed the DSP or
  reproduce its decay. Check WAV stem/full-mix capture includes the source; audit capture
  duration so long resonances are not unexpectedly chopped at the export boundary.

**Exit gate:** saved Resonator songs sound the same when reopened in Map/DAW and Song
Chainer; desktop and phone expose equivalent controls and truthful loading states.

## Phase 5: AI composition and documentation

- [ ] Extend plan schema, normalization, `TONE_SUPPORT`, parameter flattening and synth
  defaults with the model/timbre vocabulary. Choose one wire shape shared by both clients.
- [ ] Update both `MixerTab.applyAIPlan` and `applyPlanToSnapshot`, including edit plans
  that omit synth type and must use the lane's current instrument capabilities.
- [ ] Add advisories for unsupported gates/legato/grains and voice-budget constraints.
  Include an auditioned sound recipe and teach the guide what Damping controls.
- [ ] Keep schema, recipes, prompt and MCP imports pure: no Tone, worklet or WASM loader
  imports from shared sound definitions or server code.
- [ ] Add license credits, developer rebuild instructions and release limitations.
  Update `CLAUDE.md` and regenerate `AGENTS.md` with `npm run sync:agents` once the feature
  exists; do not document the planned instrument as already shipping.

**Exit gate:** an AI plan can create and edit a Resonator lane through either apply
path, round-trip it through a snapshot, and produce no unintended parameter loss.

## Phase 6: validation and release

Validation is proportional to the actual implementation, not just UI snapshots:

- **Pure logic:** parameter normalization/capabilities, event ordering/cancellation,
  voice allocation, snapshot round trips and AI/MCP apply parity. Extend relevant
  existing tests, including server-purity and composer-guide checks.
- **DSP:** native/WASM comparisons, finite output, pitch/rate correctness, deterministic
  test seeds, extreme patches, overlapping notes and bounded voice/buffer allocation.
- **Browser/audio:** Chrome, Firefox and Safari desktop plus physical iPhone Safari and
  Android Chrome. Check cold/warm loads, suspend/resume, sample-rate changes where
  available, failed asset fetch/retry, hot swaps, export and Song Chainer transitions.
- **Load:** benchmark 1, 4 and 6 active Resonator lanes, then the same with drums, FX and
  both Song Chainer engines overlapping. Record two/four-voice configurations separately.
  Use at least a 10-minute playback run and repeated start/stop/section changes; inspect
  glitches, render deadline headroom, memory growth and thermal degradation.
- **Release target:** six default-voice lanes plus drums/normal FX and a two-section
  crossfade on the chosen baseline desktop and phone devices without audible dropouts.
  If that fails, optimize or set an explicit tested runtime budget before release.
  Never silently reduce voices in an existing song based on device detection.
- **Build:** run relevant tests, then `npm test` and `npm run build`. Stop the dev server
  before the build because both share `.next`. Play the result; a green build alone
  does not verify audio.

Ship prebuilt, versioned worklet/WASM assets so regular Next/Vercel builds do not need
Emscripten or live upstream downloads. Pin the compiler in the dedicated DSP build,
record hashes, and check that generated assets match the source manifest. Validate
asset URLs, MIME types and caching on a deployment preview. The runtime should not
require SharedArrayBuffer, extra workers or cross-origin-isolation headers for v1.

Keep the sound out of the public picker until the gates pass. If later withdrawn,
retain loading support and assets for already-saved songs rather than replacing their
instrument. Document benchmark limits and any remaining browser-specific issues.

## Follow-up: granular support

The existing `_renderGranularSource` builds synths inside a synchronous `Tone.Offline`
callback. Plan a direct offline WASM rendering function returning an AudioBuffer,
using the same normalized patch, deterministic seed, voice policy and rate adapter.
Cache by all sound-affecting inputs and invalidate stale asynchronous renders when
the lane changes. Once its output matches the live source, enable grain controls and
remove the corresponding advisory. This is a separate milestone after v1.

## Suggested implementation sequence

1. DSP sources, attribution, reproducible build and reference/browser harness (Phase 1).
2. Worklet, timestamp queue and voice adapter (Phase 2).
3. Engine and Song Chainer preparation/integration (Phase 3).
4. Shared controls, capabilities, persistence and exports (Phase 4).
5. AI/MCP vocabulary, recipes and documentation (Phase 5).
6. Browser/device measurements, fixes and public picker rollout (Phase 6).

The critical path is Phase 1 → 2 → 3. Final voice count, defaults and supported
device budget are evidence-based decisions at those gates. A delivery estimate should
follow the first browser benchmark, which resolves the largest performance uncertainty.

## Upstream evidence

- [Rings source](https://github.com/pichenettes/eurorack/tree/master/rings)
- [Part API, models and license](https://github.com/pichenettes/eurorack/blob/master/rings/dsp/part.h)
- [Internal excitation and voice processing](https://github.com/pichenettes/eurorack/blob/master/rings/dsp/part.cc)
- [48 kHz / 24-sample constants](https://github.com/pichenettes/eurorack/blob/master/rings/dsp/dsp.h)
- [Desktop build source list](https://github.com/pichenettes/eurorack/blob/master/rings/test/makefile)
- [License and naming guidance](https://github.com/pichenettes/eurorack#license)
- [VCV Rack's host-rate adaptation](https://github.com/VCVRack/AudibleInstruments/blob/v2/src/Rings.cpp)
- [AudioWorklet and WASM integration patterns](https://developer.chrome.com/blog/audio-worklet-design-pattern)

Links above describe the assessment source; Phase 1 must replace moving branch
references with exact revision identifiers in the vendor provenance manifest.
