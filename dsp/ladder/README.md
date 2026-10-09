# Analog lane filter DSP (DaisySP LadderFilter)

`bridge.cc` is a small C ABI (version 1) over DaisySP's `LadderFilter`
(`vendor/daisysp`, MIT): one lane's stereo Analog filter per module instance,
two independent channel states, per-sample cutoff/resonance/drive input, and
an exact response crossfade. It runs at the context rate (the ladder
oversamples 4× internally; no extra oversampling here), has no imports and
does not allocate. `reference.cc` is a native renderer for the same code.

It is the `daisy-ladder` model of the lane insert filter
(`trackFilters[id].model`, see `lib/laneFilterSpec.js`). `lib/laneFilter.js`
owns the Classic/Analog/bypass switching and the audibility gate;
`public/worklets/ladder-processor.js` (`LadderHost`) is the audio-thread half.
Plan and open gates: `docs/daisy-ladder-filter-plan.md`.

## Rebuilding

The built module is committed (`public/wasm/ladder-<sha8>.wasm` plus
`ladder.manifest.json`, and the generated `lib/ladderAsset.js`), so normal app
builds never compile C++. Rebuild only after changing `bridge.cc` or the
vendored sources:

```bash
npm run build:ladder                    # pinned wasi-sdk (scripts/lib/wasiSdk.js)
node scripts/build_ladder.js --check    # fails if committed assets don't match sources
npm run compare:ladder                  # native vs wasm, WAVs in .build/renders/
npm test                                # ladder-dsp, ladder-worklet, lane-filter-* tests
```

## ABI

| Export | |
| --- | --- |
| `ld_abi_version()` | 1. The worklet refuses any other version. |
| `ld_init(rate)` | Value-initialises and `Init`s both channels; LP24, cutoff at the ceiling, resonance 0.2, drive 1. |
| `ld_reset()` | Clears filter state (silences self-oscillation), keeps params and mode. |
| `ld_set_params(f, r, d)` | Immediate values (before the first block). |
| `ld_set_mode(mode, fade)` | 0 LP24, 1 LP12, 2 BP24, 3 BP12, 4 HP24, 5 HP12; `fade` samples of linear crossfade. |
| `ld_process(frames, flags)` | ≤ 128 frames. Flags: 1 stereo input (else left is duplicated), 2/4/8 cutoff/resonance/drive arrays are per sample (else index 0). |
| `ld_in_l/r`, `ld_out_l/r`, `ld_freq/res/drive` | Fixed 128-float buffers in linear memory. |
| `ld_max_cutoff()`, `ld_fault_count()`, `ld_mode()`, `ld_max_frames()` | |

Coefficients are recomputed only when a parameter value changes. Cutoff is
clamped to `[20, min(20000, 0.425 × rate)]`, resonance to `[0, 1.8]`, drive to
`[0, 4]`; a nonfinite parameter value is ignored. A nonfinite output resets
both channels, outputs silence for that sample and counts a fault.

A response change copies the live filter object (state included) into a second
bank and runs both for the fade. Upstream's six responses are weightings of the
same four ladder stages, so the two branches differ only in output weighting:
after the fade the output is bit-identical to a filter that had always been in
the new response (`test/ladder-dsp.test.js`).

Passband compensation stays at upstream's initial 0.5. Gain staging is
unchanged from the Classic insert: the lane volume sits before the filter, so it
feeds the drive.

## Measurements (2026-10-09)

On an Apple Silicon Mac with Node 24 (V8):

- Native vs wasm on arm64 macOS: bit-identical in all 24 scenarios in
  `scripts/lib/ladderScenarios.js` (all six responses at 44.1/48/96 kHz with
  cutoff/resonance/drive sweeps, self-oscillation + reset, mono input, response
  crossfades including one restarted mid-fade, out-of-range and nonfinite
  parameters). The comparison's tolerance is 1e-6; the observed difference is 0.
- Artifact: 5,237 bytes.
- `LadderHost` per stereo lane: about 0.3 % of one core with a constant cutoff,
  0.4 % with cutoff and resonance both ramping every sample.
- Peak levels with drive 4 and resonance swept to 1.6 on a 0.4-peak saw:
  LP ≈ 0.8–0.9, BP ≈ 1.4, HP ≈ 1.8–2.1. Highpass/bandpass at high drive are
  hotter than the input; the master limiter catches it, but auditioning may
  justify an output trim (plan: "evaluate output levels").

Not measured yet (browser/audio acceptance, see the plan's Phase 5): AudioWorklet
cost on iPhone Safari, 8/16/32-lane mixes, aliasing at high cutoff/drive by ear.
