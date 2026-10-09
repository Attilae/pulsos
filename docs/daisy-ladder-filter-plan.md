# DaisySP LadderFilter implementation plan

Status: Phases 1–4 implemented (2026-10-09); Phase 5 browser/audio acceptance open.

Implemented: vendored DaisySP `2c72eaf` (`vendor/daisysp`), the stereo bridge and native
reference (`dsp/ladder`, bit-identical native/wasm in every scenario), the worklet host
(`public/worklets/ladder-processor.js`), loader (`lib/ladderLoader.js`), adapter
(`lib/laneFilter.js`), pure spec (`lib/laneFilterSpec.js`), engine/persistence wiring, desktop
and phone controls, automation targets with model eligibility, and the AI/MCP contract. Tests:
`ladder-dsp`, `ladder-worklet`, `lane-filter-spec`, `lane-filter-plan`. Measurements are in
`dsp/ladder/README.md`.

Still open before rollout (none of these can be checked by `npm test` or `npm run build`):
listening/level matching, desktop Chrome and iPhone Safari lifecycle checks, the 8/16/32-lane
performance runs, aliasing/DC/resonance-peak checks, WAV stem and Song Chainer listening, and
the decision on an output trim (HP/BP at high drive peak around +6 dB above the input).

Date: 2026-10-09. Background: [instrument filter research](./instrument-lane-filter-research.md).

## Outcome and first-release scope

Add an **Analog** instrument-lane filter powered by DaisySP `LadderFilter`, with **Classic** retaining the existing Tone.Filter. Both run through the same EQ, sidechain, pan, FX sends and WAV capture paths.

The first release includes cutoff, resonance, drive, LP/HP/BP response, 12/24 slope selection, and bypass on desktop and phone. It does not add an LFO, envelope follower, filter morphing, a new instrument, or replace MonoSynth's internal filter envelope.

Analog is opt-in initially. Existing songs, missing filter fields and fresh lanes retain Classic until the user selects Analog. Changing the default for new lanes is a separate decision after listening and phone performance validation.

## Decisions to carry into implementation

| Area | Decision |
| --- | --- |
| Source | Vendor a pinned DaisySP revision containing `Source/Filters/ladder.h` and `ladder.cpp`, with the minimal required utility dependencies and original notices. Do not import DaisySP-LGPL or the older `moogladder` module. |
| Execution | One stereo AudioWorklet insert per Analog lane, with independent left/right filter state, compiled WASM assets, and the existing shared AudioContext. |
| Existing behavior | Missing `model` means Classic. Preserve legacy type, cutoff, Q, ramp behavior and graph order. |
| Gain staging | Retain the current upstream lane volume in this release. Volume changes intentionally affect Analog saturation. Keep explicit Drive as a separate control. |
| Audibility | Add an Analog output gate after the filter and before the dry/FX-send split. Input silence alone cannot silence self-oscillation. |
| Bypass | Crossfade to dry input, then suspend/reset unused Analog DSP. The lane audibility gate still applies. |
| Unsupported response | Classic retains notch. Analog has no notch; selecting Analog from notch explicitly changes response to lowpass and announces the change. |
| Loading failure | Keep Classic sounding until Analog is ready. On failure show “Analog filter unavailable; using Classic,” preserve the requested settings, and offer retry. |
| Distribution | Commit source, reproducible build script and WASM, as with the project's existing DSP modules. No runtime compiler or new DSP service. |

The upstream API supplies six response modes, native resonance 0–1.8, input drive 0–4 and passband compensation. [API and source license](https://github.com/daisyaudio/DaisySP/blob/master/Source/Filters/ladder.h). Its implementation uses four internal oversampling steps and clamps cutoff to `0.425 × sampleRate`; do not add another oversampling layer in v1. [Implementation](https://github.com/daisyaudio/DaisySP/blob/master/Source/Filters/ladder.cpp).

## State and automation contract

Extend each `trackFilters[routeId]` object without changing the meaning of legacy fields:

```js
{
  model: 'daisy-ladder', // absent or 'classic' uses Tone.Filter
  type: 'lowpass',      // lowpass | highpass | bandpass for Analog
  frequency: 20000,     // requested cutoff in Hz
  Q: 4,                // retained for returning to Classic
  resonance: 0.2,      // native Daisy units, 0..1.8
  drive: 1,            // native Daisy units, 0..4; unity input drive
  slope: 24,           // selects upstream 12/24 response variants
  bypass: false
}
```

These are proposed first-release defaults. Audition them before freezing fixtures; never silently replace values in saved songs during that tuning.

- Preserve requested frequency in song state. Clamp only the Analog runtime value to `min(20000, 0.425 * sampleRate)`, with a 20 Hz UI floor. Surface the effective limit where it matters, rather than displaying an unattainable cutoff.
- Show Analog resonance as 0–100%, mapped linearly to native 0–1.8. The initial native value 0.2 is about 11%. Do not describe this as equivalent to Classic Q.
- Preserve `filter.frequency` across both models. Add `filter.resonance` and `filter.drive` for Analog. Keep `filter.Q` for Classic.
- Retain incompatible automation lanes in the song, mark them inactive for the selected model, and resume them when the matching model returns. Guard manual-value restoration by model too. A stale Q lane must not overwrite Analog resonance.
- Validate model-specific combinations. Reject Analog notch and invalid/nonfinite values in plans; normalize untrusted stored state to documented defaults. No silent Q-to-resonance conversion.
- Keep passband compensation internal at 0.5 initially, matching upstream initialization; evaluate output levels before deciding whether an output trim is necessary. Avoid an additional exposed gain control unless auditioning demonstrates a need.

## Phase 1: source, build and DSP reference

Proposed additions:

- `vendor/daisysp/`: selected sources, license, `PROVENANCE.md` and a hash manifest, following the existing Clouds arrangement.
- `dsp/ladder/`: a small stereo C++ bridge and native reference renderer.
- `scripts/build_ladder.js`: reuse `scripts/lib/wasiSdk.js`, its pinned wasi-sdk 34.0 downloads and `WASI_SDK_PATH` override.
- `scripts/ladder_compare.js`: compare native and WASM renders.
- `public/wasm/ladder-<sha8>.wasm`, a manifest and `lib/ladderAsset.js`: committed, content-addressed assets following existing DSP builds.
- Package scripts `build:ladder` and `compare:ladder`.

Bridge requirements:

1. Export initialization, reset and block processing with a versioned C ABI. Use the existing `wasm32-wasip1`, no-entry-point toolchain and reject WASM imports. Keep state/buffers in fixed memory, with one WASM instance per lane and no allocation or memory growth in processing.
2. Value-initialize both filter objects before `Init`. The reviewed upstream initialization reads drive through passband setup before its final drive assignment; avoid indeterminate initialization and document any necessary local portability patch.
3. Supply bounded cutoff, resonance and drive streams and response selection. Recompute coefficients only when values change, while honoring scheduled sample changes.
4. Keep two independent channel states. For mono input, explicitly duplicate into both channels; absent input supplies zeros and still advances active filter state.
5. Preserve upstream DSP unless a verified defect requires a small documented patch. Record compiler options and asset hashes; verify GCC-specific attributes against the project's WASM compiler.

Exit: native/WASM comparison passes for all six modes at 44.1/48/96 kHz, including drive, high resonance and reset. Define tolerances from numerical error in the reference comparison, not from a broad allowance that hides a DSP mismatch.

## Phase 2: worklet, loader and filter adapter

Proposed additions: `public/worklets/ladder-processor.js`, `lib/ladderLoader.js`, `lib/laneFilter.js`, and a pure `lib/laneFilterSpec.js` for normalization and mode-aware parameter rules.

Use `lib/resonatorLoader.js` for asset registration/readiness and `lib/textureVoice.js` for the closer insert-node reference: Tone input/output gains, one native worklet input, explicit stereo output, Tone/native connections and disposal guards. Register modules per AudioContext, share fetch/compile work and transfer WASM bytes using the established compatibility path. Use separate mutable DSP state for every node, including two simultaneous Song Chainer engines.

The adapter owns stable input/output nodes, Classic DSP and the optional Analog node. It exposes scheduled parameter updates, model/bypass switching, audibility control and idempotent disposal. Preserve existing frequency/Q ramp behavior through the adapter rather than scattering model checks through the engine.

- Use AudioParams for cutoff/resonance/drive, with absolute audio-clock scheduling and the existing manual/automation ramp durations. Pass parameter arrays into WASM in bulk; make one processing call per render block rather than crossing JS/WASM once per sample.
- Share state changes between UI edits, automation and restoration. Cancel obsolete parameter schedules when ownership changes; do not accumulate overlapping ramps.
- Crossfade model, bypass and response/slope changes over approximately 20 ms. Use complementary linear gains so correlated paths do not receive an equal-power level boost. Preallocate any second state bank required for response transitions.
- Keep the Classic branch available for startup/failure fallback. Instantiate Analog lazily. Do not leave unnecessary Analog processing active on Classic-only lanes.
- Handle worklet errors, AudioContext recreation, retries and disposal during pending initialization. An obsolete readiness callback must not attach a node to a deleted or switched lane.
- Never allocate, fetch or log in the processing callback. Reset nonfinite state deterministically and signal an error once through the existing readiness/error mechanism.

Exit: deterministic host tests cover real processing, stereo isolation, scheduled ramps, transitions, failure, retry and teardown. Test the worklet host directly, following existing DSP tests; browser behavior remains a separate check.

## Phase 3: engine and persistence

Update `lib/engine.js` and the lane state/persistence paths:

1. Replace direct insert creation with the adapter in `_createSingleRouteEntry` and `_ensureDrumInsert`. Both accept the same persisted model; exposing Analog in the instrument lane UI is the first-release priority.
2. Route `setRouteFilter`, automation and restoration through the adapter. Model changes must apply the newest stored values after asynchronous readiness.
3. Derive Analog audibility from disabled state, solo eligibility, stopped/hidden playback and zero lane volume. Fade its output gate to zero, then suspend/reset DSP; re-enable with current manual/automated parameters. Gate both dry output and FX sends. Do not alter Classic tail/gating semantics as a side effect.
4. Dispose worklet resources in `_disposeRouteEntry`, with stop, lane removal, song/city reset and engine disposal. Synth changes currently reuse the route entry/filter; preserve that lifecycle instead of rebuilding the insert on every voice change. Ensure no oscillator survives stop or tab deactivation.
5. Extend `trackFilters` handling in `MixerTab`, snapshot normalization/application in `songState`, duplication, line replacement and load/import. Preserve Classic Q when Analog fields change.
6. Extend async `TransitEngine.prepareSounds` and `snapshotPlayer.prepareSnapshotSounds` to prepare Analog assets before synchronous `startMock`. Cover interactive play, AI apply, Song Chainer preload, initial playback and section transitions. A failed preparation resolves into the visible Classic fallback rather than hanging playback.
7. Verify Song Chainer and WAV stems/full-mix consume the same engine output. No separate export DSP implementation is required.

Exit: legacy snapshots reproduce the prior Classic path; Analog snapshots survive save/load, duplicate, line replacement and Song Chainer playback. Disabled, solo-excluded and zero-volume Analog lanes remain silent at self-oscillating resonance.

## Phase 4: desktop, phone and composer support

- Extend `FilterPanel` in `components/DawView.jsx`. Add a filter editor to `components/mobile/LaneSheet.jsx`, with filter state/handlers threaded through `MobileDaw.jsx` and its associated CSS. There is currently no phone filter editor to reuse. Use the project's design tokens and keep response separate from Classic/Analog model selection.
- Show Q for Classic and resonance/drive/slope for Analog. Add bypass, pending/error status, effective cutoff limits and the inactive-automation explanation.
- Use shared ranges/defaults from `laneFilterSpec`; avoid desktop, phone and AI discrepancies. Brief control help should explain that lane level affects drive.
- Register targets and model eligibility in `lib/fxTrack.js` and automation source/target UI. Changing models retains settings and incompatible lanes instead of deleting them.
- Extend `lib/ai/planContract.js`, `planSchema.js`, shared helpers in `planApply.js`, and both application paths: `MixerTab.applyAIPlan` and `planSnapshot.applyPlanToSnapshot`. Extend snapshot summaries in `planSnapshot.js`. Reset model/drive state explicitly in the fresh-composition baseline so a new composition cannot inherit the previous song's Analog settings. Teach the composer the model names, native units, bypass meaning and unsupported notch combination.
- Update composer guidance/examples and the relevant skill package only where filter vocabulary is documented. Do not generate client/audio imports in server modules.
- Add DaisySP attribution to `app/licenses/page.jsx`. Document build/state/lifecycle decisions in `CLAUDE.md` and regenerate `AGENTS.md` with `npm run sync:agents`; never edit that generated file directly.

Exit: the same Analog plan produces the same normalized filter state through UI and headless application; desktop and phone can edit every first-release control and explain failures without relying on console logs.

## Phase 5: acceptance and rollout

Meaningful automated coverage:

- Pure spec tests: invalid/nonfinite values, defaults, effective cutoff bounds, six mode mappings, legacy snapshots and model-specific automation eligibility.
- DSP/worklet tests: native parity, stereo separation, mono input, reset, sustained resonance, silent gated output, bypass/model transition bounds and timed automation.
- State/plan tests: snapshot round-trip, older songs, duplication, AI/MCP validation and both application paths. Keep existing server-purity coverage green.
- Run focused tests during implementation, then `npm test` and `npm run build`. Stop any running Next dev server before building because both share `.next`.

Browser/audio acceptance:

- Audition level-matched saw bass, sustained chords, percussive samples and Texture through slow/fast cutoff sweeps and drive changes. A green build is not sound verification.
- Exercise stop/start, tab changes, disable/solo, zero volume, bypass, model switches, loading failure and AudioContext interruption on desktop Chrome and iPhone Safari.
- Measure 1/8/16/32 stereo Analog lanes with representative instrument/FX load. Use eight lanes as the initial phone acceptance mix, 16/32 as stress cases; record device, sample rate, graph and processing/dropout results. Require no audible glitches or reported processing overruns during a five-minute acceptance run.
- Check aliasing at high cutoff/drive, response balance, DC and resonance peaks. Listen to actual WAV stems and a Song Chainer transition.

Roll out with Analog available as an optional model only after acceptance. If the phone mix fails, optimize the processor/update path or delay release; never silently replace Analog with a cheaper topology. Record the actual supported load and limitations.

## Suggested implementation sequence

1. Vendor/build bridge and native comparison.
2. Worklet/adapter with scheduling, transitions and failure handling.
3. Engine integration, post-filter gate and backward-compatible persistence.
4. Desktop/phone controls, automation and AI/MCP contracts.
5. Full checks, listening, browser performance and release documentation.

The first reviewable milestone is a reproducible stereo processor with native parity and an isolated browser audition. Complete that before wiring every lane control, so DSP problems are distinguishable from UI and persistence problems.
