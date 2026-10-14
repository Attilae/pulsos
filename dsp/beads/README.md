# Texture Mk II DSP (Beads)

`bridge.cc` is a small C ABI over the vendored Beads processor
(`vendor/beads`): one lane's Texture insert in its Mk II model per module
instance. It runs the whole `beads::Processor` unmodified (recording buffer,
grain and delay engines, the four qualities, dry/wet, wow and flutter, reverb,
limiters) and adds the panel side of the firmware: knob laws, smoothing, the
SEED gate with its 2.5 ms delay, and the output clamp. It has no imports and
does not allocate. `reference.cc` is a native renderer for the same code.

It is Texture's **Mk II** model. A lane picks it with `txModel: 'mk2'`, and the
choice is offered when `NEXT_PUBLIC_TEXTURE_MK2_ENABLED=true` in a build with
`NEXT_PUBLIC_GRANULAR_ENGINE=clouds`. The pieces around this directory are the
worklet host (`public/worklets/beads-processor.js`, `BeadsHost`), its loader
(`lib/beadsLoader.js`), the model switch in `lib/textureVoice.js`, the
vocabulary in `lib/granularEngine.js` (`tx2*` keys, `beadsDspParams`) and the
panel in `components/TextureControls.jsx`. Plan, scope and open release gates:
`docs/texture-mk2-plan.md`.

## Rebuilding

The built module is committed (`public/wasm/beads-<sha8>.wasm` plus
`beads.manifest.json`, and the generated `lib/beadsAsset.js`), so normal app
builds never compile C++. Rebuild only after changing `bridge.cc` or the
vendored sources:

```bash
npm run build:beads                   # downloads the pinned wasi-sdk once into dsp/.toolchain/
node scripts/build_beads.js --check   # fails if committed assets don't match sources
npm run compare:beads                 # native vs wasm, writes WAVs to .build/renders/
node scripts/beads_bench.js --soak    # load through the host, Classic vs Mk II, plus a 10-minute soak
```

The toolchain (wasi-sdk) is shared with the other DSP builds through
`scripts/lib/wasiSdk.js`.

## ABI

| Export | What it does |
| --- | --- |
| `bd_init(seed)` | Reset everything, seed the RNG, start in Hi-fi. |
| `bd_set_quality(q)` | 0 Dirty tape, 1 Clean tape, 2 Vintage digital, 3 Hi-fi (upstream's `Media` order). Resets the active engine, as the firmware does. |
| `bd_sample_rate()`, `bd_block_size()` | Follow the quality: 24, 48, 32 or 48 kHz, in blocks of rate / 4000 (6 to 12 samples). `bd_max_block_size()` is 12. |
| `bd_set_params(...)` | Knob positions 0..1: TIME, SIZE, SHAPE, PITCH, their four attenuverters (centre = none), DENSITY, FEEDBACK, DRY/WET, REVERB; then a linear in-gain (0..4) and FREEZE. |
| `bd_set_seed(button, patched)` | Seed button 0 off / 1 held / 2 locked, and whether lane notes reach the SEED input. |
| `bd_gate(offset, high)` | The SEED gate changes level `offset` samples into the next block. |
| `bd_in_l/r()`, `bd_render()`, `bd_out_l/r()` | One block: stereo in, the processor's full stereo output (dry and wet) out. |
| `bd_reset()`, `bd_fault_count()` | Forget all audio; count of non-finite blocks (each resets the DSP). |

How SEED behaves, from `trigger_generator.cc` and `delay_controller.cc`:

| Button | Patched | Granular mode | Delay mode (SIZE at full) |
| --- | --- | --- | --- |
| off | yes | Grains only while a note's gate is high, at DENSITY's rate; at DENSITY's centre, one grain per note. | Notes are the tap-tempo clock. |
| locked | yes | Notes clock DENSITY: dividers (/1 to /16) left of centre, probability right of centre. | Notes are the clock; DENSITY picks the ratio. |
| locked | no | Free running at DENSITY's rate. | DENSITY sets the delay length (centre = the full buffer). |

Things that look like bugs and aren't (upstream behaviour, checked):

- **TIME is how far back grains read**, so a high TIME is silent until the
  buffer has filled that far. The buffer holds about 4 s in Hi-fi and 16 s in
  Dirty tape.
- **Delay mode engages 1.5 s after SIZE reaches full**, with a 0.75 s
  cross-fade, and releases the same way.
- **In free delay mode, DENSITY sets the delay length and TIME offsets the
  read point.** For example, DENSITY 0.7 with TIME 0 gives taps at about 0.26
  and 0.33 s.

## Measurements (2026-10-14)

On an Apple Silicon Mac with Node 24 (V8, the wasm engine Chrome uses). DSP
only: resampling to the context rate (Phase 2) isn't included.

- **Native vs wasm:** bit-identical in all seven scenarios in
  `scripts/lib/beadsScenarios.js`, which cover every quality, note gates, a
  note clock, randomization, delay mode, freeze with feedback and reverb, and
  quality switches with reset. There were no faults and no non-finite samples.
- **Artifact:** 90,961 bytes. Linear memory is 983,040 bytes per lane (768 KB
  delay memory plus 64 KB reverb).
- **CPU, 8 lanes, share of one core:**

  | Load | Dirty tape | Clean tape | Vintage | Hi-fi |
  | --- | --- | --- | --- | --- |
  | Granular, free running | 3.4% | 4.6% | 4.0% | 5.6% |
  | Dense grains, randomization, feedback and reverb | 4.4% | 5.9% | 5.6% | 7.3% |
  | Delay mode with reverb | 5.2% | 8.9% | 8.8% | 9.1% |

- **Levels:** fully dry, the output is exactly 0.75 × the input. That's
  upstream's dry/wet law (dry × 0.75, wet × 1.5).
- **SEED timing:** in note-gate mode a grain starts about 3 ms after the gate
  rises (the firmware's 2.5 ms seed delay plus the grain's attack).

### Through the worklet host (Phase 2)

`test/beads-worklet.test.js` runs `BeadsHost` with the real module at 44.1, 48
and 96 kHz.

- **Latency** is 2 blocks + 8 samples at the quality's rate: 0.67 ms in Hi-fi
  and Clean tape, 0.75 ms in Vintage, 0.83 ms in Dirty tape. The whole lane,
  dry included, is delayed by that much (Beads processes the dry path itself).
  It's under 1 ms, so there's no case for bypassing the DSP when fully dry.
- **Dry level** through resampling is within 1.5% of the bridge's 0.75× at
  every host rate and quality (within 5% in Dirty tape, whose dry path is
  mu-law).
- **Note timing:** a grain starts at the note's time + 2.5 ms (the firmware's
  SEED delay) + the latency, within ±0.25 ms, at every host rate.
  - Clean tape adds 0.35 ms (its internal 2× resampler) and Dirty tape 2.5 ms
    (its wow-and-flutter delay line).
  - Both are upstream's and identical at every host rate.
- **Quality switches** fade out over 5 ms, switch, restart the timeline at the
  new rate and fade back in. There are no clicks or underruns, and notes queued
  across a switch still land on time. The recording is lost on a switch, as on
  the module.
- **Lane loudness against Classic** uses an 8 s lane-like input with a note
  every 0.5 s, held 0.25 s. Levels are relative to the dry lane:

  | Setting | Hi-fi | Clean tape | Vintage | Dirty tape |
  | --- | --- | --- | --- | --- |
  | Classic at its defaults | -1.6 dB | | | |
  | Mk II fully dry | -2.5 | -2.5 | -2.5 | -2.5 |
  | Mk II, dry/wet 0.5, note gates, one grain per note | -5.0 | -5.0 | -4.9 | -4.8 |
  | Mk II, dry/wet 0.5, free, density 0.75 | -4.7 | -4.7 | -4.8 | -4.6 |
  | Mk II fully wet, free, density 0.75 | -13.3 | -12.9 | -16.4 | -11.9 |

  At an even blend, Mk II is about 3 dB quieter than Classic. This follows
  from upstream's dry/wet law (dry × 0.75 even fully dry).
  - Phase 3 added a +3 dB make-up (`TEXTURE_MK2_MAKEUP_DB`, applied in
    `lib/textureVoice.js`). `test/texture-mk2.test.js` pins Mk II's defaults to
    within 1 dB of Classic's.
  - In Chrome, averaged over five rounds on a real lane, Mk II sat 1.3 dB under
    Classic (each round varied by about ±1.5 dB).

### Load through the host (Phase 5)

`scripts/beads_bench.js` runs 8 lanes through `BeadsHost` at a 44.1 kHz host
rate (so resampling is included), each fed a plucked lane-like input with 4
notes a second, for 20 s per row. Same Mac, Node 24. Share of one core for all
8 lanes:

| Setup | Hi-fi | Clean tape | Vintage | Dirty tape |
| --- | --- | --- | --- | --- |
| Defaults (note gates) | 6.0% | 5.2% | 4.7% | 4.3% |
| Free running, dense, all randomization, feedback, reverb | 6.3% | 5.4% | 5.1% | 4.6% |
| Delay mode, clocked, feedback, reverb | 9.9% | 9.5% | 9.7% | 6.4% |

- Classic at its defaults, same 8 lanes: 2.5%. Mk II costs 2 to 4 times as
  much, mostly because the dry path and the reverb run in the DSP too.
- On a phone, typically 3 to 6 times slower, 8 Mk II lanes in delay mode would
  be 30 to 60% of a core. Texture is desktop-only for now, so there's no cap.
  Revisit this if Texture comes to phones.
- No faults, drops, underruns or non-finite samples in any row.
- **Soak:** 10 minutes on one lane, cycling quality every 30 s, seed mode
  every 20 s and delay mode every 45 s (19 quality switches). Memory stayed at
  983,040 bytes, nothing was late, dropped or non-finite, and no second after
  the first two was silent.
- Peaks can reach about 1.02 after resampling (the DSP itself clamps at 1).
  It's a float path into the lane's inserts and the master limiter, so nothing
  clips there.
- **Not yet measured:** any browser other than Chrome, phones, and listening.
