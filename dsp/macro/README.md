# Macro DSP

`bridge.cc` is a small C ABI over the vendored Plaits DSP (`vendor/plaits`).
- It holds a pool of up to four `plaits::Voice`s, each with its own 16 KB engine
  RAM and each monophonic like the module.
- It renders 12-sample blocks at 48 kHz.
- It has no imports and no allocation.

`reference.cc` is a native renderer for the same code.

## Rebuilding

The built module is committed, so normal app builds never compile C++. The
committed files are `public/wasm/macro-<sha8>.wasm`, `macro.manifest.json` and
the generated `lib/macroAsset.js`. Rebuild only after changing `bridge.cc` or
the vendored sources:

```bash
npm run build:macro                    # wasi-sdk is downloaded once into dsp/.toolchain/
node scripts/build_macro.js --check    # fails if committed assets don't match sources
npm run compare:macro                  # native vs wasm, writes WAVs to .build/renders/
```

The toolchain is the pinned wasi-sdk shared with the Resonator and Clouds builds
(`scripts/lib/wasiSdk.js`). Plaits needs two flags the other DSP builds don't:
- libc++'s no-exceptions headers (`-isystem <sysroot>/include/wasm32-wasip1/noeh/c++/v1`),
  header-only, because it includes `<cmath>` and `<algorithm>`;
- `-include stdio.h` (see `vendor/plaits/PROVENANCE.md`).

## How a lane drives it

Each note is the module with TRIG and V/OCT patched and LEVEL unpatched:
- `mc_trigger_held(note, velocity, holdSamples)` takes a voice and raises its
  trigger for the note's length. `mc_trigger` holds it until `mc_release(note)`.
- The rising edge pings the low-pass gate (LPG) and decay envelope exactly as on
  the hardware. The attenuverters (`fmAmt`, `timbreAmt`, `morphAmt`, −1..1) set
  how far that envelope moves FREQUENCY, TIMBRE and MORPH.
- Only the 6-op FM banks sustain for as long as the trigger is held (their own
  DX7-style envelopes). The LPG is a ping, not a gate: on every other engine a
  note rings for the LPG Decay or the engine's own decay, whatever its length.
  Engines that envelope themselves (6-op, chiptune, string, modal, drums)
  bypass the LPG, like the module.
- Retriggering a voice whose trigger is still high forces one low block, so the
  module sees a new rising edge.

The rest of the voice handling:
- **Allocation:** idle voice first, else the oldest note.
- **Velocity:** a per-voice output gain, ramped across one block.
- **Idle voices:** a voice whose output stays under 1e-4 for 0.25 s with its
  trigger low stops rendering.
- **Patch:** `mc_set_patch(harmonics, timbre, morph, fmAmt, timbreAmt, morphAmt,
  decay, colour, transposeSemitones, immediate)` is shared by all voices and
  smoothed per block.
- **Engine and panic:** `mc_set_engine(e, immediate)` fades out over 5 ms,
  resets the voices and fades back in. Notes that arrive during the fade are
  deferred, and `mc_panic` drops them.
- **Output:** `mc_set_aux(mix)` blends the module's OUT (0) and AUX (1) into the
  one mono output, `mc_out()`.

Differences from the module, all in `bridge.cc`:
- **Tuning.** Upstream tunes against the hardware's real 47872.34 Hz frame clock,
  so every note is offset by 12·log2(47872.34 / 48000) semitones.
- **Trigger latency.** Upstream reads TRIG through a delay line, and a note's
  rising edge is seen 4 blocks (48 samples, 1 ms) after it's set.
  `mc_trigger_latency()` returns 48 so the host can schedule notes that much
  early. A stolen voice's pitch changes one block before its edge, not
  immediately.
- **Output polarity and range.** The int16 output stage inverts, so the bridge
  divides by −32768 to restore it.

## Engine order

`engine` is upstream's registration index, three banks of 8:

| Bank | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 (0–7) | VA + VCF | phase distortion | 6-op FM A | 6-op FM B | 6-op FM C | wave terrain | string machine | chiptune |
| 2 (8–15) | VA | waveshaping | 2-op FM | grain/formant | additive | wavetable | chords | speech |
| 3 (16–23) | swarm | filtered noise | particle | inharmonic string | modal | bass drum | snare | hi-hat |

**Chiptune (7)** behaves differently with TRIG patched, faithfully to the module.
It becomes a clocked arpeggiator: each note steps it, HARMONICS picks the chord
and TIMBRE the pattern. It bypasses the LPG, and its own decay is set by the
TIMBRE amount knob, so at 0 every note drones until the voice is stolen. The
lane editor has to make that clear. One voice gives the module's arpeggio;
with more, each voice runs its own arpeggiator.

## Measurements (2026-10-08)

Measured on an Apple Silicon Mac with Node 24 (V8, the same wasm engine as
Chrome).

- **Native vs wasm:** bit-identical (max difference 0) on arm64 macOS in all 8
  scenarios in `scripts/lib/macroScenarios.js`. They cover a tour of every engine
  in all three banks, a 4-voice chord on AUX, 6-op gates and voice stealing,
  modulated drums, 0/1 extremes with ±24 semitones transpose, voice-count
  changes, engine switches with deferred notes, and panic. No faults.
- **Artifact:** 208,625 bytes, against 65 KB for the Resonator. Most of it is
  `resources.cc` (wavetables, speech data, LUTs, FM patches).
- **Tuning:** within 0.1 cents of A440 at 220, 440 and 880 Hz on VA (HARMONICS
  centred), waveshaping, 2-op FM and wavetable.
- **Onset:** the first sample above −60 dBFS is exactly 48 samples after the
  note, the value `mc_trigger_latency()` reports.
- **Gate:** a 6-op note held 1.5 s has 15× the RMS 1.0–1.4 s in that one released
  after 0.05 s.
- **Idle:** with the default patch, every engine goes idle after a 0.3 s note,
  except four:
  - 6-op FM A, inharmonic string and modal: long natural tails. String and modal
    go idle after 5–7 s.
  - Chiptune: drones (see above).

**CPU**, as the share of one core, 8 notes per second held 0.1 s:

| Engine | 1 voice | 2 voices | 4 voices |
| --- | --- | --- | --- |
| 2-op FM (heaviest) | 0.44 % | 0.88 % | 1.63 % |
| Additive, 6-op FM | 0.22–0.23 % | 0.43 % | 0.79–0.82 % |
| Most others | 0.12–0.20 % | 0.22–0.41 % | 0.40–0.79 % |
| Speech, chiptune (lightest) | 0.07–0.08 % | 0.12–0.14 % | 0.21–0.28 % |

Per voice, every engine is cheaper than a Resonator voice except 2-op FM.

Not yet measured:
- Firefox, Safari, iPhone and Android
- multi-lane load and 10-minute runs
- the worklet's resampling cost

## Load, soak and loudness (2026-10-08)

`node scripts/macro_bench.js [--soak]` drives the real worklet host (44.1 kHz,
with resampling) in Node:

| Setup | Share of one core |
| --- | --- |
| 8 mixed lanes, 2 voices | 3.6 % |
| 8 mixed lanes, 4-voice chords | 7.0 % |
| 8 lanes of 2-op FM, all voices busy | 14.5 % |

The 10-minute soak, cycling all 24 engines and the voice count, ran with no
faults, drops or non-finite samples, and memory stayed flat (256 KB).

Loudness against a default Synth lane, per-note RMS at default patches: the
median engine needs +4.9 dB, so `MAKEUP_DB` in `lib/macroVoice.js` is +5.
Engines span about 25 dB, mostly between the sustained ones (6-op FM, chiptune)
and the plucked ones (string, particle, string machine).
