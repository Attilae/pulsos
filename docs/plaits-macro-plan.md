# Plaits-derived Macro instrument plan

Status: **Phases 1–5 done; Phase 6 partly done** (2026-10-08, branch `feature/plaits`). The flag
stays off until the open gates below pass.

Phase 6, done here:
- **Load** (`scripts/macro_bench.js`, the real worklet host with 44.1 kHz resampling, V8 on an
  Apple Silicon Mac). Shares of one core:

  | Setup | Share of one core |
  | --- | --- |
  | 8 mixed lanes, 2 voices, 4 notes/s | 3.6 % |
  | 8 mixed lanes, 4-voice chords | 7.0 % |
  | Worst case: 8 lanes of 2-op FM, every voice busy | 14.5 % |
  | Per engine, 4 busy voices | 0.25–1.7 % |

  No faults, drops or non-finite samples. A phone (3–6× slower) is comfortable at typical loads
  and marginal at the worst case, which is what the 20-voice plan advisory guards.
- **10-minute soak:** one lane cycling all 24 engines every 10 s and the voice count every
  minute. No faults, drops or non-finite samples, memory flat at 256 KB, no silent minute.
- **Loudness:** per-note RMS of every engine at its default patch against a default Synth lane
  (4n notes). The median engine needs +4.9 dB, and the middle half +2.9..+10.3 dB.
  `MAKEUP_DB` in `lib/macroVoice.js` went from the provisional +10 to **+5**. The spread is the
  instruments' own (sustained 6-op FM and chiptune loud, plucked strings and particle quiet),
  as on the module, so there is no per-engine table.
- **The 6-op FM patch banks:** about 96 voices from SysEx dumps, picked by upstream's
  `fm_patches.py`.
  - 31 come from Yamaha's DX7 factory cartridges (ROM1A–ROM4B).
  - The rest come from third-party and user banks: MISC, Guit_Clav1–5, SYN9, PPGVOCAL, KV04A/B.

  Evidence:
  - No explicit licence from Yamaha was found.
  - The factory voices circulate as a "public domain" collection (Dave Benson's DX7 page,
    homepages.abdn.ac.uk/d.j.benson).
  - Mutable shipped them in the Plaits 1.2 firmware.
  - VCV's official open-source port tracks the same firmware.

  This is a low practical risk, not a legal clearance: **the owner decides**. If not cleared, the
  fallback is to ship without engines 2–4 (sixOpA/B/C).

Phase 6, still open (needs a person or a device):
- **Listening:** every engine through a real lane, the +5 dB makeup, R18/R19, and the default
  patch and voice count.
- **Safari:** desktop, with "Allow remote automation" on, so it can be driven
  (`safaridriver --enable`).
- **Other browsers and devices:** Firefox (not installed here), iPhone and Android.
- **Multi-lane playback in a real browser on a phone.**
- **Song Chainer:** a crossfade between two saved songs that both use Macro (needs a signed-in
  account with presets).
- **A live model call** (in-app composer or MCP) producing a Macro plan.
- **The licence decision above.**


Phase 5 delivered:
- **Plan shape.** Plans set Macro through one nested `tone.macro`:
  `{engine, harmonics, timbre, morph, transpose, timbreAmount, fmAmount, morphAmount, lpgDecay,
  lpgColour, aux, voices}`. That is one schema key per track instead of twelve: OpenRouter's
  strict schema makes every tone key mandatory on every track, and nested keys can't collide with
  `decay` or Resonator `damping`. `transpose` is whole semitones, −7..+7.
- **Validation and mapping** (`lib/macroSpecs.js`): `validateMacroTone` clamps or reports by key,
  and `macroToneToParams` and `macroParamsToTone` convert to and from the lane params.
  `TONE_SUPPORT.Macro = ['macro']`.
- **Schema** (`planSchema.js`): carries `tone.macro` in both the strict and lenient schemas.
- **Contract** (`planContract.js`), only while `NEXT_PUBLIC_MACRO_ENABLED` is on:
  - offers Macro in plan `SYNTH_TYPES`
  - adds prompt text with every engine and what its controls do, generated from `MACRO_ENGINES`
  - adds the vocabulary line and validates `tone.macro`
- **Apply paths:** `planApply.trackSynthParams` drops a plan envelope on Macro. `planSnapshot`
  describes the full patch for edits and no envelope. `MixerTab.applyAIPlan` loads the DSP
  first.
- **Advisories** (`planAdvisories.js`):
  - envelope, legato and glide are inert
  - noteLength and drone are inert except on the 6-op FM engines
  - granular is inert under the GrainPlayer engine
  - chiptune with no `timbreAmount` drones
  - `fmAmount` beyond ±0.3 on a tonal lane
  - a 20-voice plan budget
- **Recipes** (`soundPolicy.js`), flag-gated: R18 (modal bells) and R19 (analog pluck bass).
- **Credits and docs:** the licences page credits Plaits (years 2012–2021). CLAUDE.md gets a
  **Macro instrument** section, test list, commands and env entry, and `AGENTS.md` is synced.
- **A correction from measurement:** only the 6-op FM engines sustain while a note is held. The
  string machine, like every low-pass-gated engine, pings and fades. The engine hint, voice
  comments, note-length hints and README were corrected.
- **Tests:** `test/macro-plan.test.js` (9) covers:
  - mapping, and validation and clamping
  - both apply paths for new plans and edits
  - the load/save round trip, and the edit description feeding back unchanged
  - advisories, recipes, and flag-off behaviour in a child process
- **Suite:** 353/354 with the flags on and off. The one failure is the Texture worklet's
  stale-trigger test, which predates this work.
- **Not verified:** a live model call (in-app composer or MCP) producing a Macro plan.


Phase 4 delivered:
- **Panel:** `components/MacroControls.jsx` and `.css` replace the interim
  editor in the desktop rack (`EnvPanel`) and appear in the phone lane sheet
  (variant `sheet`). The layout follows the faceplate:
  - MODEL: a bank selector (switching bank keeps the row, as the module's
    buttons do) and eight engine lamps
  - FREQUENCY and HARMONICS as large knobs, TIMBRE and MORPH as medium ones,
    each showing what it does on the selected engine
  - the three envelope-amount attenuverters
  - Decay, Colour and Out/Aux
  - voice count
  - Colour dims on self-enveloped engines, and a hint explains why.
- **Shared knob:** `components/PanelKnob.jsx` and `.css` is the knob extracted
  from `TextureControls.jsx`, which now uses it. It adds `steps` (FREQUENCY
  snaps to 14 semitone steps, including from the keyboard), `sublabel`, `dim`
  and an instrument `group` in the accessible name.
- **Hints:** note-length and MIDI-export hints for Macro, on desktop and phone.
- **Persistence:** no code change needed. Snapshots carry the lane's flat
  params and `synth.macro*` automation targets are validated through
  `availableAutomationTargets`. Pinned by a new round-trip case in
  `test/song-snapshot.test.js`.
- **Verified:**
  - `npm run build` passes.
  - Desktop Chrome at 1440 px, dark and light themes:
    - knob drag and keys, bank and lamp selection
    - an automation lane offers the nine `synth.macro*` targets, with no ADSR or
      glide
    - arming one locks its knob in amber
    - during playback the knob follows the swept value across ±100 %
  - Phone width (390 px): the sheet panel fits with no horizontal overflow, and
    every control is at least 40 px tall.


Phase 3 delivered:
- **Engine wiring** (`lib/engine.js`):
  - Macro is in `NO_STANDARD_ENV`, `NO_GLIDE` and `NO_HARMONY`, and in a new
    `WORKLET_SYNTHS` set shared with the Resonator. That set covers flat-key
    `set()`, legato skipping and restoring automation to the manual value.
  - It also has `SYNTH_PARAM_TARGETS.Macro`, the `_makeSynth` case and the
    `supportsGranular` rule.
  - `prepareSounds`, `soundsReady` and `_assertSoundsReady` load and check both
    worklet instruments.
- **`lib/soundSpecs.js`:** `SYNTH_DEFAULTS.Macro`, `SYNTH_TYPES`, and
  `PICKER_SYNTH_TYPES` behind `NEXT_PUBLIC_MACRO_ENABLED` (in `.env.example`).
- **Readiness:** the Song Chainer's `prepareSnapshotSounds` loads it, and
  MixerTab's `applyPreset` warms the asset.
- **AI plans:** `lib/ai/planContract.js` keeps Macro out of plan `SYNTH_TYPES`
  until Phase 5 gives it vocabulary.
- **Interim editor:** `DawView.jsx` has an interim Macro editor (model select
  plus Harmonics, Timbre, Morph and Decay sliders) and hides Glide. Phase 4
  replaces it.
- **Verified:**
  - `npm run build` passes.
  - Desktop Chrome, dev server with the flag on, 48 kHz:
    - a Budapest lane switched to Macro plays
    - live switches between VA, modal, bass drum, 6-op FM, chords and speech
      apply mid-playback
    - lane output peaks 0.44–1.13, with no non-finite samples and no console
      errors
    - Stop silences it


Phase 2 delivered:
- **Worklet host:** `public/worklets/macro-processor.js` (`MacroHost`).
  - It applies notes and releases `mc_trigger_latency()` samples early, so a note
    sounds on its timestamp, within ±0.125 ms block rounding.
  - Its output is mono, copied to both channels.
- **Loader and voice:** `lib/macroLoader.js` and `lib/macroVoice.js`.
  - The trigger is held for the note's duration.
  - The output gain has provisional +10 dB makeup, the same as the Resonator.
- **Vocabulary:** `lib/macroSpecs.js`. It holds:
  - the 24 engines, with per-engine labels for HARMONICS, TIMBRE, MORPH and AUX
    from the module's manuals
  - the flat `macro*` keys, normalisation and FREQUENCY as −7..+7 semitone steps
  - automation targets and `MACRO_SELF_ENVELOPED`
  - Engine ids are strings in songs (`'va'`, `'modal'`), so the order is never
    persisted.
- **Tests:** `test/macro-dsp.test.js` (15), `test/macro-worklet.test.js` (12) and
  `test/macro-specs.test.js` (6). They cover:
  - tuning within 1 cent in the DSP and 2 cents through the resampler at 44.1, 48
    and 96 kHz
  - onsets on the timestamp at all three rates
  - gates, retriggers and voice allocation
  - engine switch deferral, panic, cancel and stale events, and late releases
  - engine order and the self-enveloped set, checked against the vendored
    `voice.cc`



Phase 1 delivered:
- **Vendored sources:** 126 files under `vendor/plaits`, unmodified, with a manifest.
- **Bridge and reference:** `dsp/macro/bridge.cc` and `reference.cc`.
- **Build and comparison:** `scripts/build_macro.js` (`npm run build:macro`) and
  `npm run compare:macro`.
- **Committed module:** 208,625 bytes. Native and wasm renders are
  bit-identical in all 8 scenarios.
- **Measurements, in `dsp/macro/README.md`:**
  - tuning within 0.1 cents
  - per-engine CPU of 0.07–0.44 % per voice
  - the 1 ms trigger latency

Deviations from the design below:
- **Engine has its own call.** The engine is set with `mc_set_engine(engine,
  immediate)`, not as part of `mc_set_patch`, because a switch fades out first.
- **Mono output.** The output is mono (`mc_out()`). The worklet copies it to both
  channels, and the lane's panner places it.
- **Latency.** The trigger delay is 4 blocks (48 samples), not 5. Upstream's
  delay line reads one write behind its index.
- **Extra build flags.** The build needs libc++'s no-exceptions headers and
  `-include stdio.h`. See `vendor/plaits/PROVENANCE.md`.

## Outcome and scope

This adds **Macro** as a lane instrument. It is powered by Emilie Gillet's open-source Plaits
macro-oscillator DSP (MIT, `pichenettes/eurorack/plaits`), compiled to WebAssembly and hosted in an
AudioWorklet. Each station arrival triggers the module as if its TRIG and V/OCT inputs were patched.
The output enters the existing lane mixer, inserts, Texture and FX like any other instrument.

It is built exactly like the Rings-derived **Resonator** (`docs/rings-resonator-plan.md`):
- vendored, unmodified upstream sources with a SHA-256 manifest
- a committed standalone wasm built with the pinned wasi-sdk (`scripts/lib/wasiSdk.js`)
- a native reference build that has to match the wasm bit for bit
- a worklet host with timestamped events
- a Tone-shaped voice
- a feature flag (`NEXT_PUBLIC_MACRO_ENABLED`, off by default) until the release gates pass. Songs
  that use Macro play regardless.

The lane editor follows the module's front panel, the way Texture follows Clouds. It keeps the
module's control layout but uses Leið's design system (DESIGN.md). It is not a copy of the faceplate
artwork. Upstream asks derivatives not to use the "Mutable Instruments" name or the module's name,
so the UI, plan vocabulary and docs say **Macro**. Only the licences page and the provenance files
name the source.

Out of scope for the first release:
- the module's MODEL CV, LEVEL input and external FM/TIMBRE/MORPH CVs
- user wavetable or 6-op patch uploads (`UserData`)
- using Macro as the granular layer's offline source. Texture, being a live insert, works anyway.

## Upstream facts this plan relies on

Checked against eurorack `08460a69a7e1f7a81c5a2abcc7189c9a6b7208d4`, the same pin the Clouds port
vendors.

- **Engines:** `plaits::Voice` (`plaits/dsp/voice.{h,cc}`) is firmware 1.2. It has **24 engines in 3
  banks of 8**, in registration order:

  | Bank | Engines |
  | --- | --- |
  | 1 | VA + VCF, phase distortion, 6-op FM ×3 (three DX7-format patch banks), wave terrain, string machine, chiptune |
  | 2 | VA, waveshaping, 2-op FM, grain/formant, additive, wavetable, chords, speech |
  | 3 | swarm, filtered noise, particle, inharmonic string, modal resonator, analog bass drum, analog snare, analog hi-hat |

- **Control:** `Voice::Render(Patch, Modulations, Frame*, size)`.
  - `Patch` holds `note`, `harmonics`, `timbre`, `morph`, the three modulation amounts (the
    attenuverters), `engine`, `decay` and `lpg_colour`.
  - `Modulations` holds the CVs, `trigger`, `level` and the `*_patched` flags.
- **Rate:** 48 kHz in `kBlockSize` = 12 sample blocks.
  - Tuning uses `kCorrectedSampleRate` = 47872.34 Hz, the hardware's real rate. Rendered at a true
    48 kHz it plays about 4.6 cents sharp.
  - The bridge corrects this with a note offset of 12·log2(47872.34 / 48000) semitones.
- **RAM:** every engine shares one **16 KB** `BufferAllocator` block (`plaits.cc`). Engines are
  re-initialised into it on each switch.
- **TRIG behaviour:**
  - With TRIG patched and LEVEL unpatched, a rising edge pings the internal low-pass gate (LPG) and
    the decay envelope.
  - The three attenuverters then set how far that envelope modulates FREQUENCY, TIMBRE and MORPH.
  - The trigger goes through a delay line: the edge is seen 4 blocks (48 samples, 1 ms) late.
  - While TRIG stays high it is a gate. Of the 24 engines only the 6-op FM ones sustain on it
    (measured in Phase 5); the low-pass gate itself pings and decays whatever the gate length.
- **Already enveloped engines:** the 6-op engines, inharmonic string, modal and the three drums
  bypass the LPG. TRIG excites them directly.
- **Output:** `Frame{short out, aux}`. AUX is an engine-specific variant: a sub-oscillator, the raw
  oscillator, the second formant, and so on.
- **Post-processing:** `ChannelPostProcessor` applies upstream's per-engine gain or limiter and
  the LPG.
- **Data:** `plaits/resources.cc` (378 KB of source) holds the LUTs, wavetables, speech data and
  `fm_patches_table`. The wasm will be much larger than the Resonator's 65 KB, an estimated
  200–400 KB that Phase 1 must measure. It loads only for songs that use Macro.

## Design

### DSP bridge: `dsp/macro/bridge.cc` over `vendor/plaits`

- **Lane model:**
  - One wasm instance is one lane.
  - It holds a static pool of **1–4 `plaits::Voice`** objects, each with its own 16 KB RAM block. A
    Voice is monophonic, so this pool gives chords and overlapping notes, as in the Resonator.
  - A note takes an idle voice, otherwise the oldest one. This is deterministic.
- **Notes:**
  - `mc_trigger_held(note, velocity, holdSamples)` raises the voice's TRIG for its note length and
    then lowers it. `mc_release(note)` lowers it early; a negative note means every voice.
  - `trigger_patched = true` and `level_patched = false`, so the LPG and decay envelope ping exactly
    as on the module.
  - Velocity is a per-voice output gain ramped across one block. It never rescales another voice's
    tail.
- **Patch:**
  - `mc_set_patch(harmonics, timbre, morph, fmAmt, timbreAmt, morphAmt, decay, colour,
    transpose, immediate)` is smoothed per block.
  - `mc_set_engine(engine, immediate)`: an engine change fades out, resets the voices and fades
    back in. It never reinterprets live state.
- **Output and buffers:**
  - Output is int16 converted to float at /−32768. The output stage inverts.
  - `mc_trigger_latency()` (48 samples) lets the host schedule notes ahead of upstream's TRIG
    delay.
  - `mc_set_aux(mix)` blends OUT (0) and AUX (1). This is a Leið addition; the module has two jacks.
  - Exports a mono `mc_out` buffer, `mc_init(seed)`, `mc_set_voices`, `mc_panic`,
    `mc_render` and `mc_fault_count`.
- **Build constraints:** no imports, no allocation and no memory growth.
- **Tooling:**
  - `dsp/macro/reference.cc` is the native renderer. `scripts/lib/macroScenarios.js` drives both
    builds through every engine.
  - `scripts/build_macro.js` is cloned from `scripts/build_resonator.js` and reuses
    `scripts/lib/wasiSdk.js`. It supports `--check` and `--reference`.
  - `scripts/macro_compare.js` writes WAVs.
- **Committed artifacts:**
  - `public/wasm/macro-<sha8>.wasm` and `macro.manifest.json`
  - the generated `lib/macroAsset.js`
  - an immutable cache header in `next.config.js`

### Worklet, loader and voice

These are copies of the Resonator pieces with `rs_` renamed to `mc_`:
- **`public/worklets/macro-processor.js` (`MacroHost`):**
  - It has no `import`/`export`, because standardized-audio-context re-evaluates worklet source.
  - It keeps a timestamp queue with generation-id cancel and drops stale events.
  - It resamples from 48 kHz to the context rate with Hermite interpolation.
  - It never drops a late release.
- **`lib/macroLoader.js`:** fetches and compiles the wasm once, calls `addModule` once per context,
  and keeps a status store (`idle` / `loading` / `ready` / `error`).
- **`lib/macroVoice.js`:** a Tone-shaped voice over one `AudioWorkletNode`. Its `set` posts only
  the keys that changed.

### Vocabulary: `lib/macroSpecs.js`

It is pure and server-safe, and `soundSpecs.js` re-exports it.
- **`MACRO_ENABLED`:** `process.env.NEXT_PUBLIC_MACRO_ENABLED === 'true'`, written literally so
  Next inlines it.
- **`MACRO_ENGINES`:** 24 entries of `{ id, index, bank, label, hint, harmonics, timbre, morph, aux }`.
  The last four name what each control does on that engine (for example HARMONICS is "Detune" on VA,
  "Ratio" on FM and "Chord" on chords). The panel readouts and the AI prompt use these names.
- **Flat lane keys in `trackADSRs`:**

  | Key | Range | Notes |
  | --- | --- | --- |
  | `macroEngine` | 0–23 | |
  | `macroFrequency` | 0..1 | Transpose ±7 semitones around the lane's note. Centre is a detent. |
  | `macroHarmonics`, `macroTimbre`, `macroMorph` | 0..1 | |
  | `macroFmAmt`, `macroTimbreAmt`, `macroMorphAmt` | −1..1 | The attenuverters, which set the decay envelope depth |
  | `macroDecay`, `macroColour` | 0..1 | The module's hidden LPG settings |
  | `macroAux` | 0..1 | OUT ⇄ AUX |
  | `macroVoices` | 1–4 | Default 2 |

- **Functions:**
  - `normalizeMacroParams`, `macroPatch` and `usesMacro`.
  - `macroCapabilities`: no legato, glide or granular source, and note length is a gate.
  - `MACRO_AUTOMATION_TARGETS`: `synth.macro*` for every continuous control. Engine and voices are
    discrete and not automatable.
  - `MACRO_TONE_KEYS`, `macroToneToParams` and `macroParamsToTone` for AI/MCP plans.

### Engine wiring: `lib/engine.js`

Macro follows every place the Resonator is special-cased:
- `SYNTH_PARAM_TARGETS.Macro`
- `NO_STANDARD_ENV`, `NO_GLIDE` and `NO_HARMONY`
- the `supportsGranular` rule (Texture still works because it's an insert)
- the `_buildSynth` case
- `prepareSounds` / readiness / the `startMock` and `startLive` throw
- the legato skip
- `_restoreParamToManual`

`soundSpecs.js` adds the `Macro` defaults and puts it in `PICKER_SYNTH_TYPES` behind the flag.
`songState.js` needs no schema bump, because the params are sparse flat keys. The Song Chainer's
`prepareSnapshotSounds` awaits the loader like it does for the Resonator.

### Panel: `components/MacroControls.jsx` and `.css`

The layout follows the faceplate, top to bottom:

```
MODEL   [ 1 | 2 | 3 ]   ( ) ( ) (o) ( ) ( ) ( ) ( ) ( )   engine name + hint
( FREQUENCY )                         ( HARMONICS )         large
      ( TIMBRE )                 ( MORPH )                  medium
 (timbre amt)        (FM amt)        (morph amt)            small, bipolar
 LPG  (Decay) (Colour)      OUT (OUT⇄AUX)      Voices 1 2 3 4
```

- **Shared knob:** move the SVG `Knob` out of `components/TextureControls.jsx` into a shared
  `components/PanelKnob.jsx`. It handles drag with Shift for fine control, arrow, Page, Home and End
  keys, double-click or long-press reset, and a locked amber state under automation. Texture and
  Macro both import it.
- **Model selection:** the module uses two buttons with LEDs. Here it is a bank radiogroup plus 8 lamp
  buttons. The selected lamp is lime (`--accent`), and every button is keyboard-operable.
- **Labels:** HARMONICS, TIMBRE and MORPH keep their panel names and show the engine-specific
  meaning as a sub-label from `MACRO_ENGINES`.
- **What the module hides:** the LPG Decay and Colour settings are behind a button hold on the
  module and are plain small knobs here. Their hint explains that the 6-op, string, modal and drum
  engines ignore the LPG.
- **Wiring:** a loader status line, as on the Resonator. The panel is wired into the synth editor in
  `DawView.jsx` and `components/mobile/LaneSheet.jsx` (a compact variant).
- **Style:** DESIGN.md rules apply: tokens only, mono readouts, no glyph icons, no em-dashes, both
  themes and phone width.

### AI/MCP and docs

- **AI/MCP:**
  - `lib/ai/planContract.js` gets a Macro prompt block and tone vocabulary behind the flag.
  - `lib/ai/planAdvisories.js` warns about the total voice CPU, an envelope set on Macro (the LPG
    decay is the envelope), and legato or glide.
  - `lib/ai/planSnapshot.js` follows `applyAIPlan`, and a sound recipe gets an audition gate.
- **Docs and credits:**
  - `app/licenses/page.jsx` gets the Plaits credit.
  - `vendor/plaits/PROVENANCE.md`, the LICENSE files and `dsp/macro/README.md` (measurements).
  - A CLAUDE.md section, then `npm run sync:agents`.
  - `.env.example`.

## Phases

1. **Vendor and build.** Copy `plaits/dsp/**`, `plaits/resources.{h,cc}` and the stmlib
   dependencies unmodified, with a manifest. Write the bridge and reference.
   - Native and wasm must be bit-identical in every scenario: all 24 engines, engine switches,
     gates, 0/1 extremes and reset.
   - Measure the artifact size, and the CPU per engine at 1, 2 and 4 voices.
2. **Worklet, loader, voice and tests.**
   - `test/macro-dsp.test.js`:
     - the manifest hash and no imports
     - every engine finite, bounded and fault-free
     - determinism
     - tuning within ±5 cents at the knob centre
     - FREQUENCY ±7 semitones
     - the gate holds sustaining engines
   - `test/macro-worklet.test.js`:
     - tuning at 44.1, 48 and 96 kHz
     - onsets within ±0.25 ms of timestamp plus latency
     - cancel and stale events
     - a late release still lands
3. **Engine wiring** and the readiness paths: MixerTab play, AI start, `applyAIPlan` and the Song
   Chainer.
4. **Panel** on desktop and phone, persistence round trip and automation targets.
5. **AI/MCP vocabulary**: `test/macro-plan.test.js`, advisories and the composer skill/guide tests.
6. **Release gates**, with the flag kept off until they pass:
   - Chrome, Firefox and Safari desktop, iPhone and Android.
   - Multi-lane load and a 10-minute run.
   - Song Chainer crossfades.
   - Choosing the default voice count and defaults by listening.
   - The licence check below.

## Licence gate

The code is MIT, and the licences page plus `vendor/plaits/LICENSE` cover it. Before release,
confirm the provenance of `fm_patches_table`, the three DX7-format 6-op patch banks in
`resources.cc`. If they can't be confirmed as freely redistributable, build without engines 2–4.
That leaves 21 engines, and the bank-1 lamps for those engines are disabled.

## Verification

```bash
npm run build:macro
node scripts/build_macro.js --check
npm run compare:macro
npm test
npm run build            # stop any dev server first; they share .next/
NEXT_PUBLIC_MACRO_ENABLED=true npx next dev --port 3060
```

In the browser:
- pick Macro on a lane and step through all 24 engines
- check the knobs, attenuverters, LPG settings and automation lock
- check both themes and phone width
- confirm there are no console errors
- listen; a green build alone doesn't verify the sound
