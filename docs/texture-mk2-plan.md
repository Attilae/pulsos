# Texture Mk II: a Beads-derived second model for the Texture insert

Status (2026-10-14): Phases 1 to 4 done on branch `feature/beads`, and Phase 5's code-side work
(load bench, licence credit, docs). Done so far: the vendored DSP, the bridge and wasm, the worklet
host and loader, the engine and voice wiring, the Texture panel's Classic | Mk II switch and the
Mk II panel, and their tests. Measurements are in `dsp/beads/README.md`. Still open: the release
gates that need listening and real devices (Phase 5). The flag stays off until they pass.

## Outcome

Today the Texture insert (`NEXT_PUBLIC_GRANULAR_ENGINE=clouds`) runs one DSP, derived from
Clouds. This plan adds a second DSP derived from Emilie Gillet's Beads, which was published on
2026-10-11 (eurorack `d8f47391`, MIT like the other STM32 projects). Each lane's Texture panel
gets a model switch, **Classic | Mk II**, much like the lane filter's Classic | Analog switch.

- **Naming.** Upstream asks derivatives not to reuse module names, so the UI, the AI vocabulary
  and the docs aimed at users say "Classic" and "Mk II". The vendored directory and C symbols
  follow the existing precedent (`vendor/clouds`, `dsp/clouds`), so internal paths may name the
  source.
- **What the switch is.** It is per-lane song state (`txModel`), not a build flag. A lane that
  switches keeps the other model's settings.
- **What stays the same.** It is the same insert, in the same place in the graph. Lane notes still
  drive the trigger input (Beads calls it SEED).
- **Flag.** The Mk II choice is offered only when `NEXT_PUBLIC_TEXTURE_MK2_ENABLED=true`, and only
  in builds where Texture itself exists. A song saved with Mk II plays Mk II in any build that has
  Texture.

### Scope

**In scope:**
- Beads' granular mode, including all four quality settings (Hi-fi, Clean tape, Vintage digital,
  Dirty tape) and the per-quality sample rate, bit depth and wow/flutter.
- Delay mode, which the module enters with SIZE at full; with lane notes on SEED, its TIME is
  tempo-locked to the lane.
- The four randomization attenuverters, FREEZE, FEEDBACK, DRY/WET and REVERB.

**Out of scope:**
- **The wavetable synth mode.** It only runs with no audio patched, and an insert always has
  input. It is not compiled.
- **Hardware-only parts.** Beads' AGC and auto-gain, CV normalization detection, the assignable
  CV input, the gate output, buffer backup to flash, calibration and the UI are hardware concerns.
  Gain is a plain In gain knob, as on Classic.
- **AI and MCP vocabulary.** Classic Texture isn't in plans either (only `planAdvisories` reads
  `TEXTURE_ENABLED`). Plan support for both models comes later, together.

## Upstream facts the design relies on (eurorack `d8f47391`)

- **Interface.** `beads::Processor` is the whole FX chain. `Process(seed_button_state,
  seed_input, freeze, density, Parameters, MixParameters, in, out, size)` takes stereo float
  frames. `Parameters` holds TIME, SIZE, SHAPE and PITCH, each a `RandomizedParameter
  {base, attenuverter, cv, has_cv}`. `MixParameters` holds feedback, dry/wet, reverb and the
  output gate.
- **Attenuverters with nothing patched.** With `has_cv = false`, the attenuverter sets internal
  randomization: positive values give a smooth random walk, negative values a fresh random value
  per grain. This is what the knob does on our panel; Leið has no CV.
- **SEED has three behaviours** (confirmed in Phase 1; `trigger_generator.cc`):
  - **Note gates:** button off, notes patched. Grains run only while a note is held, at DENSITY's
    rate. At DENSITY's centre, each note gives one grain.
  - **Note clock:** button locked, notes patched. DENSITY becomes a clock divider left of centre
    (/1 to /16) and a probability right of centre.
  - **Free:** button locked, nothing patched. DENSITY is the free-running rate.

  So the panel needs a seed-mode control, which the layout below now has. The default is note
  gates, the closest to Classic's "grains on lane notes"; Phase 4 confirms that by listening.
- **Sample rate depends on quality.** With `ENABLE_HARDWARE_24K` (upstream's default):

  | Quality | Codec rate | Internal ratio |
  | --- | --- | --- |
  | Dirty tape | 24 kHz | 1 |
  | Clean tape | 48 kHz | 2 |
  | Vintage digital | 32 kHz | 1 |
  | Hi-fi | 48 kHz | 1 |

  The codec runs at 4,000 blocks/s, so a block is 12 samples at 48 kHz and 6 at 24 kHz.
- **Memory.** The delay buffer is 768 KB, shared by all quality modes, and the reverb buffer is
  64 KB. That is about 0.9 MB of linear memory per lane, the same order as Classic (about 1 MB).
- **stmlib.** Same pin as Clouds and Plaits (`e3bd7c9c`), so `vendor/beads` vendors only `beads/`
  sources and reuses the stmlib files we already pin, copied into its own tree for a
  self-contained manifest.
- `resources.cc` is 450 KB of source, mostly synth-mode wavetables. The build should keep only the
  tables the granular and delay paths reference; whatever remains is measured.
- **Upstream support.** The README says the Beads code is "provided as is" and was verified to
  build on a desktop, not on the module. Phase 1 has to prove it renders correctly, not assume it.

## Design

### DSP: `dsp/beads/bridge.cc` over `vendor/beads` (unmodified, SHA-256 manifest, PROVENANCE)

- **Structure.** One module instance per lane, holding one `beads::Processor` with static
  buffers. No imports and no allocation, like `dsp/clouds`.
- **ABI** (prefix `bd_`):
  - Setup and limits: `bd_init(seed)`, `bd_block_size()`, `bd_sample_rate()` (the current
    quality's codec rate), `bd_set_quality(q)` (Configure, with the fade the hardware applies).
  - Buffers and status: `bd_in_l/r()`, `bd_out_l/r()`, `bd_fault_count()`.
  - Controls: `bd_set_params(time, timeAmt, size, sizeAmt, shape, shapeAmt, pitch, pitchAmt,
    density, feedback, dryWet, reverb, freeze)`.
  - Triggers, reset and rendering: `bd_seed()` (a rising edge on the next block),
    `bd_reset()`, `bd_render()`.
- **Dry path.** Beads mixes dry and wet itself, and in the lo-fi qualities it degrades the dry
  path too: mu-law in Dirty tape, 12-bit in Vintage. Unlike Classic, the host therefore plays the
  DSP's full output, not "context-rate dry plus resampled wet". This is the faithful option.
  - The cost is that at 0% wet the lane is resampled and delayed by about a block.
  - Phase 2 measures it. If it's audible, the host can bypass the DSP at exactly 0% wet in Hi-fi.
- **Reference.** `reference.cc` is a native renderer, and `scripts/beads_compare.js` with
  `scripts/lib/beadsScenarios.js` compares native and wasm in every quality, plus delay mode,
  freeze and seed timing.

### Build

- `scripts/build_beads.js` (`--check`, `--reference`) is cloned from `build_clouds.js` and shares
  `scripts/lib/wasiSdk.js`.
- Outputs: `public/wasm/beads-<sha8>.wasm`, `beads.manifest.json` and the generated
  `lib/beadsAsset.js`.
- npm scripts: `build:beads` and `compare:beads`.
- `next.config.js` gets an immutable cache header.

### Worklet: `public/worklets/beads-processor.js` (`BeadsHost`)

This follows `TextureHost`. It has no `import`/`export`, and the host is a class tested from Node.

- **Rates.**
  - Resampling goes from the context rate to `bd_sample_rate()` and back, with the same biquad
    anti-aliasing and Hermite interpolation as Classic.
  - The anti-aliasing cutoff follows the quality's rate (a 24 kHz codec gets about 10.8 kHz).
- **Quality change.** The host fades out, calls `bd_set_quality`, re-derives its rates, clears
  its rings and fades back in. It never reallocates in `process()`.
- **Triggers.** Lane notes become timestamped `seed` events, using the same generation-id
  cancellation, stale-drop rule and late handling as Classic.

### Main thread

- **`lib/textureVoice.js`.** `TextureVoice` takes `cfg.txModel` and builds the matching worklet
  node. The rest of its lifecycle is unchanged: pass-through until ready, a dry lane if the load
  fails, and `set`, `trigger*`, `cancelScheduled` and `dispose`.
  - **Switching model** cross-fades inside the voice (old node out, new node in) over about 20 ms.
    The engine's insert splice is untouched, so `_ensureGranularVoice` doesn't change.
  - **Loading.** Each model has its own loader and status store. `lib/beadsLoader.js` is shaped
    like `cloudsGranularLoader.js`, and both register in the same context only when used.
- **`lib/granularEngine.js`.** This file gets the new vocabulary.
  - Selection: `TEXTURE_MODELS = ['classic', 'mk2']`, `DEFAULT_TEXTURE_MODEL = 'classic'`, and
    `TEXTURE_MK2_ENABLED`.
  - Mk II keys, prefixed `tx2` so they never collide with Classic's:

    | Group | Keys |
    | --- | --- |
    | Large knobs | `tx2Time`, `tx2Size`, `tx2Shape`, `tx2Pitch` |
    | Randomization | `tx2TimeRand`, `tx2SizeRand`, `tx2ShapeRand`, `tx2PitchRand` |
    | Density | `tx2Density` |
    | Mix | `tx2Feedback`, `tx2DryWet`, `tx2Reverb` |
    | Gain and quality | `tx2InGain`, `tx2Quality` (an id: `hifi` / `cleanTape` / `vintage` / `dirtyTape`, never an index) |
    | Latch | `tx2Freeze` |

  - Helpers and automation: `TEXTURE_MK2_KNOBS`, `TEXTURE_MK2_DEFAULTS`,
    `beadsDspParams(cfg)`, `TEXTURE_MK2_PARAM_TARGETS` (`grain.tx2*`; quality and freeze aren't
    automatable).
  - `availableAutomationTargets` offers the active model's targets. A lane automating the other
    model's key stays and shows as inactive, using the lane filter's `filterModel` rule.
- **Persistence.** Everything lives in the lane's granular config, which is already saved. It's
  sparse, with absent meaning Classic, so there's no schema bump. Old songs are byte-identical.
  `songState`'s valid-target set adds `TEXTURE_MK2_PARAM_TARGETS`.

### Panel: `components/TextureControls.jsx` and `.css`

- **Model switch.** A Classic | Mk II segmented control sits at the top and is a radiogroup.
  Without the flag it shows only on lanes already set to Mk II, so they can switch back.
- **Layout.** Classic's layout is unchanged. Mk II follows the Beads faceplate, drawn in Leið's
  rack language with the shared `PanelKnob`:

  ```
  [ Classic | Mk II ]
  [FREEZE]  SEED: [Gates | Clock | Free]
  ( TIME )   ( SIZE )   ( SHAPE )   ( PITCH )        large knobs
   (rand)     (rand)     (rand)      (rand)          small bipolar, left = per grain, right = drift
  ( DENSITY )                                         large, centre detent ("each note")
  ( FEEDBACK )  ( DRY/WET )  ( REVERB )   ( IN GAIN )
  QUALITY: [Hi-fi] [Clean tape] [Vintage] [Dirty tape]   lamps, like the module's 4 LEDs
  ```

  - **SIZE** reads "delay" at full, and the hint below the panel explains delay mode for the
    current seed mode.
  - **DENSITY's readout** follows the mode: granular rate, divider or probability; in delay mode
    the delay length (free) or the repeat as a fraction of a note (with notes).
  - **Dropped:** a manual SEED button. The panel has no handle on the lane's voice, and a grain
    fired while stopped reads an idle buffer; the seed-mode switch covers what the button does
    on the module.
- **Wiring.** Mounted in DawView's rack only, where Texture already lives. The plan's earlier
  claim that Texture also sits in the phone `LaneSheet` was wrong: the sheet says granular
  controls are desktop-only, and Classic isn't there either. Bringing Texture to phones is a
  follow-up for both models. The status line reads the active model's loader.

## Phases

1. **Vendor and DSP proof.** *Done 2026-10-14.*
   - Results: 46 files vendored unmodified; a 91 KB wasm with no imports; about 1 MB of memory per
     lane; native and wasm bit-identical in 7 scenarios; 8 lanes use 3.4% to 9.1% of one core
     (before resampling).
   - Checked behaviours: the dry level, SEED timing (about 3 ms), all four qualities, and delay
     mode (DENSITY sets the length, TIME offsets it).
   - Work: `vendor/beads` (unmodified, manifest, provenance), `bridge.cc`, `reference.cc`, the
     build script and `--check`, and the native vs wasm comparison.
   - Measure: size, memory, and CPU per quality with 8 lanes.
   - **Gate:** bit-identical (or a documented, explained difference), finite and bounded in every
     quality, delay mode and freeze.
2. **Worklet, loader and tests.** *Done 2026-10-14.*
   - Results: `BeadsHost` with 11 tests and the DSP with 10 tests. Latency is under 1 ms at
     every quality. Notes land within ±0.25 ms of the expected time at 44.1, 48 and 96 kHz.
     Quality switches are click-free.
   - Changed from the plan: the dry path stays in the DSP. There's no 0%-wet bypass, because
     the latency is inaudible.
   - Carried into Phase 3: Mk II at an even blend is about 3 dB quieter than Classic, so a
     make-up gain is needed. Pitch is checked at 0, ±12 and +7 semitones (±15 cents) in the
     DSP test.
   - Work: `BeadsHost`, `lib/beadsLoader.js`, `test/beads-dsp.test.js` and
     `test/beads-worklet.test.js`.
   - The tests cover seed onsets within ±0.5 ms at 44.1, 48 and 96 kHz, quality switching without
     discontinuities or NaN, cancellation and stale triggers, pitch within ±15 cents, delay-mode
     repeat time against the seed clock, dry latency, and level against Classic at defaults.
3. **Engine and voice.** *Done 2026-10-14.*
   - Built:
     - `TextureVoice` hosts either model and cross-fades over 20 ms on a switch.
     - A failed switch stays on the old model. `retry()` tries again.
     - Mk II notes are gates held for the note length, or 0.25 s when a note has no length
       (legato, drone).
   - Vocabulary and automation:
     - `lib/granularEngine.js` gained `tx2*` keys, the laws behind the readouts,
       `beadsDspParams`, `textureParamTargets` and `textureTargetActive`.
     - A lane on the other model's control is kept and shown as inactive in its automation
       lane.
   - Loading: `prepareSounds` and `prepareSnapshotSounds` warm Mk II without blocking.
   - Tests: `test/texture-mk2.test.js` (10) and a `song-snapshot` round trip.
   - Checked in Chrome (via `window.__leidEngine`, without the panel):
     - Switching Classic → Mk II → Classic while playing works.
     - Every seed mode and quality makes sound, and rapid toggles land on the right model.
     - Turning the layer off hands the lane back dry.
     - No console errors.
   - Changed after measuring: the defaults are now TIME 0.05 and DENSITY 0.65, a grain train
     while each note is held. The first draft (0.15, one grain per note) was almost silent when
     fully wet.
   - Make-up gain stays at +3 dB. In a real lane, averaged over 5 rounds, Mk II sat 1.3 dB under
     Classic (rounds varied by about ±1.5 dB); in Node it's within 1 dB. Listening sets the
     final trim.
   - Work: the `TextureVoice` model switch with cross-fade, vocabulary and the automation target
     rules, persistence, and the `prepareSounds` warm-up for songs that use Mk II.
   - Tests: `test/granular-engine.test.js` additions and a `song-snapshot` round trip.
4. **Panel.** *Done 2026-10-14.*
   - Built: the Classic | Mk II switch (shown with the flag, or on a lane already on Mk II) and
     the Mk II body in `components/TextureControls.jsx` and `.css`. Classic's panel is
     unchanged.
   - Added delay-mode DENSITY readouts (`textureMk2DensityText`), tested in
     `test/texture-mk2.test.js`.
   - Checked in Chrome, dark and light themes:
     - Switching model, seed mode and quality while playing works, and a lane on Mk II sounds.
     - SIZE at full shows "delay" with the delay hint.
     - A `grain.tx2Density` automation lane locks the knob in amber ("auto").
     - Switching to Classic shows "Inactive: this target needs Texture Mk II".
     - No console errors.
   - Not done: phones (see Wiring above).
5. **Release gates.** *Code side done 2026-10-14; device and listening gates open.*
   - Done:
     - `scripts/beads_bench.js` (8 lanes through `BeadsHost` at 44.1 kHz, Classic for
       comparison, `--soak` for 10 minutes). 8 Mk II lanes take 4.3% to 9.9% of one core
       (delay mode in Hi-fi is the worst case); Classic takes 2.5%. The soak cycled quality, seed
       mode and delay mode with no faults, drops, late events or memory growth.
     - Phone CPU decision (see Risks): no cap for now, because Texture is desktop-only. Revisit
       when Texture comes to phones.
     - The licences page credits Beads alongside Rings, Plaits and Clouds.
     - CLAUDE.md's Granular engines section is rewritten for the Texture insert and both models,
       with the env flag, commands and tests; `AGENTS.md` regenerated.
     - `dsp/beads/README.md` describes the shipped wiring and the load results.
   - Open, for the owner or real devices:
     - Listening: all four qualities, delay mode (free and clocked), freeze with feedback, and
       Classic against Mk II at the defaults to settle `TEXTURE_MK2_MAKEUP_DB`.
     - Safari and Firefox on desktop: switch models while playing, step through the qualities,
       check the console.
     - Phones only matter once Texture reaches the phone lane sheet (a follow-up for both
       models).
   - The flag stays off until these pass.

## Risks

- **Desktop-only upstream build.** The code was never run on hardware, so Phase 1 may surface
  bugs. If one changes the sound, it's fixed in the bridge, never in `vendor/`, and documented.
- **Lane loudness.** Beads runs an output limiter and its own dry/wet gain curve (dry ×0.75,
  wet ×1.5). The lane level may differ from Classic, so Phase 2 measures it before any make-up
  gain is chosen.
- **CPU on phones.** Hi-fi at 48 kHz with reverb is the heaviest case. If 8 lanes exceed the
  budget, the bench decides whether to cap Mk II lanes or warn, as Macro does.
- **Reverb stacking.** Mk II's reverb adds to the lane FX sends, as Classic's does. Its default
  stays 0.

## Verification

- `npm run build:beads`, `node scripts/build_beads.js --check`, `npm run compare:beads`
- `npm test`, `npm run build` (with no dev server running)
- `NEXT_PUBLIC_GRANULAR_ENGINE=clouds NEXT_PUBLIC_TEXTURE_MK2_ENABLED=true npx next dev --port
  3060`: switch a lane between Classic and Mk II while it plays, step through the qualities,
  enter delay mode, and check both themes, phone width and the console. Then listen.
