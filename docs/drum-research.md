# Drums: a more exciting sound, and patterns driven by GTFS data

Research note, 2026-11-23. Status: P1 (pattern generator), P2 (groove) and most of P3 (Classic and Layered kits, per-pad tune/decay/tone) are implemented; P4's first sample kit (808) is in; the Macro kit, more sample kits and P5 are not. The roadmap at the end proposes the order.

## 1. Where the drums are today

- **Six fixed synth voices.** `DrumSequencer.init()` (`lib/engines/drumEngine.js:63-92`) builds:
  - kick: MembraneSynth
  - snare: white NoiseSynth
  - hat and ride: MetalSynth
  - rim: short MembraneSynth
  - clap: pink NoiseSynth

  All six go through one `Compressor(-12, 4)` (`:61`). Each pad has only volume and mute. There is no tune, decay, tone or pan control, and no kit choice.
- **Pattern model.** Each pad has a 64-slot buffer and plays a 16-step window of it. Step levels are `STEP_LEVELS = [0, 1, 0.7, 0.4]` (`lib/drumSpecs.js:19`). The sequencer is a single `Transport.scheduleRepeat('16n')` (`drumEngine.js:189`).
- **Missing groove features:** swing, humanize, probability, ratchets, flams, fills, choke groups and per-pad length.
- **One link to the data.** `patternFromRoute` (`drumEngine.js:20`) puts a hit wherever a stop falls along the line's distance, always at velocity 1. It ignores the `signals` block entirely.
- **"Drums" lane type.** It plays one CC0 TR-808 one-shot per lane, from Michael Fischer's set via Dirt-Samples. The 8 files are in `public/samples/drums/cc-kit/` and listed in `public/samples/drums/ATTRIBUTION.md`.
- **No rhythm generation.** The repo has no euclidean or other rhythm-generation code.

So the kit sounds like a demo, and the patterns are as dense or sparse as the stop spacing happens to be. Both problems have cheap fixes.

## 2. Sound

There are three sources. They can be combined as selectable **kits**.

### 2.1 Better synthesis in Tone.js (no assets, cheapest win)

Real drum machines layer two or three simple parts per voice. One Tone synth per pad is why the current kit sounds thin.

| Pad | Layers | Knobs to expose |
|---|---|---|
| Kick | MembraneSynth body (pitch sweep), plus a 3–5 ms high-passed noise or click transient, plus an optional sine sub | tune, decay, punch (`pitchDecay`/`octaves`), click, drive |
| Snare | Two tuned triangle or sine oscillators (~180 / ~330 Hz) with a short pitch drop, plus band-passed noise | tune, tone (body vs noise), snappy (noise decay) |
| Closed/open hat | 808-style six square oscillators at inharmonic ratios, through band-pass then high-pass. `MetalSynth` is Tone's version of this. | tune, decay, tone (HP cutoff) |
| Clap | Band-passed noise (~1 kHz) gated as 3–4 retriggered ~10 ms bursts, then a longer tail | tone, decay, spread (burst spacing) |
| Rim/cowbell | Two square oscillators (~540/800 Hz, the 808 cowbell) through a band-pass | tune, decay |

Also add:
- a **kit-level drive** (WaveShaper or `Tone.Distortion` before the compressor)
- per-pad pan
- an open/closed hat **choke group**: a closed-hat hit cuts the open hat's release

These are what make a programmed kit feel like an instrument.

Tone references: [MembraneSynth](https://tonejs.github.io/docs/r13/MembraneSynth), [NoiseSynth](https://tonejs.github.io/docs/14.7.30/NoiseSynth), [MetalSynth PR (808 cymbal tuning)](https://github.com/Tonejs/Tone.js/pull/1246.diff).

### 2.2 Analog-modelled drums from Macro (Plaits, already in the repo)

The Macro instrument already exposes Plaits' bank-3 drum engines: `bassDrum`, `snare` and `hiHat` (`lib/macroSpecs.js:65-70`). Each has two circuit variants on AUX and its own punch/tone/decay controls. The DSP is MIT-licensed, vendored and already compiled. A **"Macro kit"** that uses `MacroVoice` (`lib/macroVoice.js`) as the pad voice gives the most "real drum machine" character for no new DSP work.

Caveats:
- It's worklet-based, so it must load before playback (`prepareSounds`), the same as Macro lanes.
- It's gated by `NEXT_PUBLIC_MACRO_ENABLED`.
- CPU cost is one voice per pad, so measure it with `scripts/perf_bench.mjs`.

### 2.3 Sample kits (CC0 only)

Load them through `lib/sampleCache.js`, as the Sampler and Drums lanes already do. Rule: keep a per-file source and licence in `ATTRIBUTION.md`, and only take CC0 or public-domain sources so nothing needs on-screen credit.

**Good sources:**

| Source | Licence | Contents |
|---|---|---|
| Michael Fischer TR-808 set (via [Dirt-Samples](https://github.com/tidalcycles/Dirt-Samples)) | CC0 / public domain | Already used. The full set has many more kick, snare and tom tunings, plus cowbell, clave, conga, maracas and rimshot. |
| [Meadowlark factory library](https://github.com/BillyDM/meadowlark-factory-library) | CC0 | Kicks, snares, claps, hats, rides, crashes, loops |
| [SFZ Instruments drums](https://sfzinstruments.github.io/drums) | CC0 / public domain (check each kit) | Acoustic kits, e.g. [SM Drums](https://sfzinstruments.github.io/drums/sm_drums) and Karoryfer's Unruly Drums |
| [Cybernetic Orchestra samples](https://github.com/d0kt0r0/cybernetic-samples) | CC0 | Mixed one-shots |
| [oramics/sampled](https://github.com/oramics/sampled), [danigb/samples](https://github.com/danigb/samples) | Varies by folder | Check each folder before use |

**Avoid:**
- Freesound CC-BY packs, which need attribution.
- [Drumhaus](https://raw.githubusercontent.com/mxfng/drumhaus/main/LICENSE) (CC BY-NC-SA).
- MusicRadar SampleRadar and Bedroom Producers Blog packs. They're royalty-free to use in music, not to redistribute as raw files from a website.
- Commercial-machine packs with unclear terms.

**Format:** keep one-shots under 1 s, ship compressed files (mp3/ogg) with a WAV fallback, and warm a kit with `warmSamples` before it's selected.

## 3. Groove: what makes a pattern feel alive

Sound alone doesn't fix a stiff grid. Ranked by payoff per line of code:

1. **Swing** (50–75%): delay every odd 16th by `(swing-0.5)·2·16th`. Do it per drum lane, not via `Transport.swing`, which would also swing the melodic lanes.
2. **Per-step probability**: reuse the per-note dice in `lib/laneGating.js`, fresh on each pass.
3. **Humanize**: a few ms of timing jitter plus velocity jitter. Seed it (`mulberry32`) so export matches playback.
4. **Ratchets/rolls**: 1–4 sub-hits inside one step, with a velocity ramp.
5. **Per-pad length → polymeter**: e.g. a 16-step kick, 12-step hat and 7-step rim. This is the drum version of the app's per-lane loop cycles and fits the "city plays itself" idea.
6. **Fills**: every N bars, swap in a fill pattern or double the hat and snare density in the last bar.
7. **Flams, ghost notes** (the 0.4 level already exists), an accent lane and choke groups.

## 4. Connecting drums to GTFS data

Available in the browser per stop:
- `lat`, `lon`, `seq`, `dist`
- `signals.departures`, `signals.routes`, `signals.centrality`, `signals.demand` (see `docs/stop-signals.md`)

Per route: `type`, `stops.length`, `totalDist`.

When Live is turned back on: vehicle speed, delay, occupancy, arrivals and alerts (`lib/engine.js:1543`), with normalizers already in `lib/mappings.js:543-597`.

### Mappings, best first

1. **Stop roles: one line becomes a whole kit.**
   - hubs (`centrality` high or `routes ≥ 3`) → kick
   - transfer stops (`routes ≥ 2`) → snare or clap, snapped to the nearest backbeat
   - every stop → closed hat
   - low-demand stops → ghost notes
   - terminals → crash or fill

   Velocity comes from `demand` through the existing `lib/stopVelocity.js`. This is the most "the line *is* the groove" mapping, and the rhythm stays readable on the map.
2. **Euclidean rhythm from the route.** Use Björklund's algorithm, as described by Toussaint ([paper](https://cgm.cs.mcgill.ca/~godfried/publications/banff.pdf), [overview](https://en.wikipedia.org/wiki/Euclidean_rhythm)).
   - k = the stop count scaled into the pad length
   - n = the pad length
   - rotation = `hashStringToInt(routeId)` (`lib/mappings.js:611`)

   This turns raw distance clusters into traditional rhythms such as the tresillo E(3,8) and cinquillo E(5,8). It should be a choice beside the current "distance" mode, not a replacement.
3. **Stop spacing → groove.** `stopGapFactors` (`lib/mappings.js:747`) gives the gap profile. Densely spaced central stops mean a straight, busy 16th feel; long suburban gaps mean sparser hits and more swing. Gap variance can drive the humanize amount.
4. **Route length → polymeter.** Pad length = f(`stops.length`), clamped to 5–16. Drum lanes built from different lines then phase against each other.
5. **Line type → groove archetype.** This decides which pads the role mapping fills:
   - metro: four on the floor
   - tram: broken, breakbeat
   - bus: dub, half time
   - rail/HÉV: long-cycle polymeter
6. **Geography → pattern map (inspired by Grids).** Mutable Instruments' Grids lays drum patterns out on a 2D map learned from real loops ([manual](https://pichenette.readthedocs.io/en/latest/modules/grids/manual/)). Normalize a route's centroid inside `city.bounds` to (x, y) on a **hand-authored** 5×5 archetype grid, interpolate between neighbours, and let mean `demand` set density. Neighbouring lines then get related grooves. Grids' code and data are **GPL-3.0** ([source note](https://pichenette.readthedocs.io/en/latest/modules/grids/open_source/)), so author the table ourselves; don't copy it.
7. **Departures → density.** More daily departures puts hats on 16ths instead of 8ths.
8. **Live hooks** (for when Live returns):
   - an arrival triggers a fill or ratchet
   - `delay` gives laid-back micro-timing
   - occupancy drives velocity
   - a service alert causes a breakdown (kick mutes)
   - `NetworkState`'s effective tempo (`lib/networkState.js:149`) is offered as a BPM suggestion
9. **Pipeline idea.** Bake an hourly departures profile in `scripts/preprocess_lines.js`. That would allow a "time of day" knob that thickens patterns at rush hour. This needs `slim:all` and `index:routes` to be rerun afterwards.

## 5. Roadmap

- **P1. Pure pattern generator.** *Done:* `lib/drumGen.js`, `test/drum-gen.test.js`.
  - New pure module `lib/drumGen.js` with `test/drum-gen.test.js`, containing `euclid(k, n, rotation)` and `patternFromStops(stops, {mode: 'distance'|'euclid'|'roles', padId, length, routeId})`.
  - It reuses `stopVelocity`, `stopGapFactors` and `hashStringToInt`.
  - `distance` mode must reproduce `patternFromRoute` exactly.
  - Wire it into `DrumMachineTab.jsx` (`handlePickRoute`, `handleRegenerate`) with a mode picker.
- **P2. Groove.** *Done:* `lib/drumGroove.js`, `test/drum-groove.test.js`. Per-pad chance (not per step) and Shift-click rolls; flams, fills and per-pad lengths are still open.
  - Add swing, probability, humanize and ratchet in `DrumSequencer` (schedule and `_trigger`).
  - Store them as sparse fields in `drumPattern`, so no schema bump is needed.
  - Thread them through `lib/songState.js:166,395,603`, `lib/ai/planSchema.js:135`, `lib/ai/planSnapshot.js:134` and `lib/ai/planContract.js` (validation around `:421`; update the "pads cannot be retuned" prompt text at `:303`).
  - Keep the `skills/leid-composer` examples passing.
- **P3. Kits.** *Done:* `lib/drumKit.js`, `lib/drumVoices.js`, `test/drum-kit.test.js`, with Classic and Layered kits. The 808 sample kit moved to P4 (it needs the new samples) and the Macro kit is still open.
  - Layered synth voices with tune/decay/tone per pad, plus a kit picker: Synth, 808 samples, Macro.
  - Put the kit and voice vocabulary in `lib/drumSpecs.js` (server-pure, for plans and MCP).
- **P4. More sample kits** *Started:* the `tr808` kit (Fischer's CC0 TR-808 set, `public/samples/drums/808/`). Acoustic kits from the other CC0 sources above (Meadowlark, SFZ Instruments) are still open; each needs `ATTRIBUTION.md` entries and goes through the same `sampleCache` warm-up.
- **P5. Data-driven extras:** polymeter lengths, line-type archetypes, the geography map and the live hooks.

**Verification for each phase:**
1. `npm test` (generator and plan tests).
2. `npm run build`.
3. Listen in `npm run dev`. A green build does not verify a sound change.

## Sources

- [Toussaint, "The Euclidean algorithm generates traditional musical rhythms"](https://cgm.cs.mcgill.ca/~godfried/publications/banff.pdf)
- [Euclidean rhythm (Wikipedia)](https://en.wikipedia.org/wiki/Euclidean_rhythm)
- [Grids manual](https://pichenette.readthedocs.io/en/latest/modules/grids/manual/), [Grids open-source note (GPL)](https://pichenette.readthedocs.io/en/latest/modules/grids/open_source/), [Grids quickstart](https://pichenettes.github.io/mutable-instruments-documentation/modules/grids/downloads/grids_quickstart.pdf)
- [Tone.js MembraneSynth](https://tonejs.github.io/docs/r13/MembraneSynth), [NoiseSynth](https://tonejs.github.io/docs/14.7.30/NoiseSynth), [MetalSynth PR](https://github.com/Tonejs/Tone.js/pull/1246.diff)
- [Meadowlark factory library (CC0)](https://github.com/BillyDM/meadowlark-factory-library), [SFZ Instruments drums](https://sfzinstruments.github.io/drums), [Cybernetic Orchestra CC0 samples](https://github.com/d0kt0r0/cybernetic-samples), [oramics/sampled](https://github.com/oramics/sampled), [danigb/samples](https://github.com/danigb/samples)
- [Drumhaus licence (CC BY-NC-SA, avoid)](https://raw.githubusercontent.com/mxfng/drumhaus/main/LICENSE)
