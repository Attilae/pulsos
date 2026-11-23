# Drums: more kits from free samples

Follow-up to `docs/drum-research.md` §2.3. Phase 4 shipped one sample kit, `tr808`: Fischer's CC0 TR-808, one file per pad in `public/samples/drums/808/`. This note covers three questions:

- Which free sample sources are safe to ship in the app.
- What they actually contain.
- How the kit model could grow past "one more kit = six more WAVs".

All licences below were checked on 2026-11-23, by reading each repository's `LICENSE` file and README through the GitHub API. Where a claim comes from a redistributor, not the original author, this note says so.

## 1. The rule

We ship raw sample files from a public website. That is redistribution, which is a different thing from using a sample inside a song. So:

- **Ship only CC0 or public-domain sounds whose licence we can trace to the author.** That rules out "royalty-free" packs (free to use in music, not to republish) and CC-BY / BY-SA (they need on-screen credit and, for BY-SA, carry their licence onto our edited files).
- **Record each file in `public/samples/drums/ATTRIBUTION.md`.** List its source path, upstream id (for Freesound, the sound id) and licence. `test/drum-kit.test.js` already fails if a kit file isn't credited.
- **Never fetch from a sample site at runtime.** Files are curated at build time and committed, like the 808 kit.

## 2. Sources

### Tier A: CC0 confirmed at the source

| Source | Licence evidence | Drum content | Notes |
|---|---|---|---|
| [tidalcycles/sounds-tr808-fischer](https://github.com/tidalcycles/sounds-tr808-fischer) | `LICENSE` is CC0-1.0 | Every TR-808 voice at many knob settings: about 25 kick tone/decay pairs, about 25 snare tone/snappy pairs, toms, congas, cowbell, clave, maracas, open/closed hat, cymbals | Already used by the `tr808` and `cc-kit/` kits. It can give several more 808 kits for almost no work (§4). |
| [stargatedaw/stargate-sample-pack](https://github.com/stargatedaw/stargate-sample-pack) | `LICENSE` is CC0 1.0. Each folder has a README with its origin. | About 200 already-trimmed drum one-shots (details below) | **Best single source.** Curated for a DAW to bundle, which is exactly our case. |
| [Karoryfer kits on sfzinstruments](https://sfzinstruments.github.io/drums): [Unruly Drums](https://github.com/sfzinstruments/karoryfer.unruly-drums), [Big Rusty Drums](https://github.com/sfzinstruments/karoryfer.big-rusty-drums), [Swirly Drums](https://github.com/sfzinstruments/karoryfer.swirly-drums) | Each repository's `LICENSE` is CC0-1.0 | Acoustic kits recorded at many velocity layers and round-robins, several mic positions | 4,000–5,600 files each (FLAC or WAV). Swirly adds world percussion: cajón, darbuka, djembe, bongos, cowbell. Use Stargate's pre-selected picks first, then go to the full kits for velocity layers (§5.3). |
| [sgossner/VCSL](https://github.com/sgossner/VCSL) (Versilian Community Sample Library) | `LICENSE` is CC0-1.0 | Orchestral and world percussion: bass drum, snares (hit, cross-stick, rimshot, roll), bongos, congas, darbuka, cajón, claves, cowbells, agogô, shakers, tambourines, claps, guiro, slit drum, cymbals, gongs | Velocity × round-robin naming (`_v2_rr1`). Good for a hand-percussion kit. |
| [BillyDM/meadowlark-factory-library](https://github.com/BillyDM/meadowlark-factory-library) | `LICENSE` is CC0-1.0 | **Only 17 kicks** (Deep, Distorted, Snappy) | `drum-research.md` listed full kits here; that was wrong. Useful only as alternative kicks. |
| [Sonic Pi samples](https://github.com/sonic-pi-net/sonic-pi/tree/dev/etc/samples) | `etc/samples/README.md` says every file is CC0 from Freesound (or donated as CC0) and links each original. The repository licence as a whole is mixed. | `drum_*` (an acoustic kit: kick, snare, hats, toms, splash, cowbell, at soft and hard), `elec_*` (electronic hits), 15 `bd_*` kicks, 4 `sn_*` snares, `perc_*` | FLAC. Confirm each Freesound page still says CC0 before copying (§2.4). |

**The Stargate pack in detail**, all one-shots:

- `fugue-state-audio/drums/`: **five complete synthesized kits.** `distkit`, `sdbkit`, `synthkit`, `x0xproc1` and `x0xproc2`, each with kick, snare, clap, closed and open hat, toms, most with ride or crash, and some with rim, claves, cowbell or maracas. They're synthesized by the author and described as public domain. The kit name is in each filename, so each one maps almost directly onto our six pads.
- `karoryfer/`: single picks from the three Karoryfer kits. There are 5 kicks, 5 snares, 3 hats, 4 cymbals, 4 toms, and 14 odd percussion hits (anvil, bones, chains, frame drum, medieval drum).
- `freesound/drums/`: kick, snare, clap, rimshot, bongo, and open, closed and crash cymbals. All CC0, with the original Freesound ids kept in the filenames.
- `sgossner/`: VCSL bass drum, snare, bongos, congas and darbuka, plus VSCO-2-CE percussion.
- `stargate/` and `microlag/`: a few kicks, hats, a clap and a snare.

Some files are long: Karoryfer rides are 3.2–3.6 MB, and crashes and rolls are over 1 MB. Trim them before shipping (§6).

### Tier B: public domain claimed by a redistributor (check the origin before use)

| Source | Claim | Problem |
|---|---|---|
| [oramics/sampled](https://github.com/oramics/sampled), drum machines `DM/CR-78`, `LM-2`, `MRK-2`, `TR-505` | Each README says "Public Domain" | The origins are Boxed Ear's free page, the hyperreal.org machine archive, a Submodern blog post and ProgSounds. None of them states a licence where we could check it. These are the only CR-78, LinnDrum and TR-505 sets found, so they're worth one email to the original authors before using them. |
| [SM Drums](https://sfzinstruments.github.io/drums/sm_drums) | sfzinstruments lists it as Public Domain. The repository has no `LICENSE`. | It's a 2.3 GB multi-mic kit, and Karoryfer's CC0 kits cover the same ground. Skip it. |

### Avoid

- **[tidal-drum-machines](https://github.com/geikha/tidal-drum-machines)** (used by Strudel): it has every classic machine, but no licence and no provenance. These are ripped machine samples.
- **[Dirt-Samples](https://github.com/tidalcycles/Dirt-Samples) as a whole**: no licence. Only the `808*` folders trace back to Fischer's CC0 set.
- **oramics `DM/TR-909/Detroit`**: from an F9 Audio free pack, with no public-domain claim. **No CC0 TR-909 set turned up.** The Fugue State `x0xproc` kits and our own synthesis (§5.5) fill that gap.
- **[Salamander Drumkit](https://github.com/endolith/Salamander-Drumkit)**: CC BY-SA 3.0. Trimmed files are modified files, so the share-alike would carry over to them.
- **[DrumGizmo Muldjord kit](https://github.com/sfzinstruments/DrumGizmo.MuldjordKit)**: CC-BY-4.0, so it needs attribution.
- **Free-download packs**: Bedroom Producers Blog, MusicRadar SampleRadar, Samples From Mars, Cassette 909 and similar. Free to use in music, not to redistribute.

### Freesound as a curation tool

Freesound's API v2 can filter search results to CC0 with `license:"Creative Commons 0"` ([API docs](https://freesound.org/docs/api/resources_apiv2.html), [CC example](https://opensource.creativecommons.org/blog/entries/freesound-intro/)). A one-off script could list CC0 one-shots per category ("kick", "rimshot", "shaker") to choose from by ear. Rules for using it:

- Store the sound id and the date the licence was checked.
- Run it at build time only, with a developer key. The browser never calls Freesound.
- Most Freesound content is CC-BY. The filter is the whole point of the script, not an optimisation.

## 3. What the current model allows

From `lib/drumKit.js` and `lib/drumVoices.js`:

- A kit is `{id, label, hint, samples: {pad: url}}` with exactly six pads: kick, snare, hat, rim, ride, clap.
- `sampleVoice` plays one `Tone.Sampler` per pad, fixed at C4. Tune changes the playback rate, decay can only shorten a sample, and tone adds a filter.
- Step level (1, 0.7 or 0.4) scales the gain only, so a soft hit is a quieter loud hit.
- `setKit` warms the files through `lib/sampleCache.js` and keeps the old voices playing until the new ones are decoded. `prefetchSnapshotSamples` warms them for Song Chainer sections.
- Plans name a kit by id (`drums.kit`, an enum of `DRUM_KIT_IDS`).

So adding a kit is cheap: about 6 files, one `DRUM_KITS` entry and one attribution section. The test, the warming and the plan vocabulary all pick it up automatically.

## 4. More kits on the current model (no code beyond `DRUM_KITS`)

Each row below fills all six pads from Tier A sources. Where a source has no matching sound, the closest one stands in, as the 808 cymbal already does for the ride pad.

| Kit id | Label | Kick | Snare | Hat | Rim | Ride | Clap | Source |
|---|---|---|---|---|---|---|---|---|
| `tr808-deep` | 808 deep | `BD2575`/`BD5075` (long decay) | `SD5025` | `CH` | `CL` (clave) | `OH50` (open hat) | `CP` | Fischer |
| `tr808-tight` | 808 tight | `BD0010` | `SD7575` | `CH` | `RS` | `CY2525` | `CP` | Fischer |
| `x0x` | x0x processed | x0xproc1-kick | x0xproc1-snare | x0xproc1-hatclsd | x0xproc1-rimshot | x0xproc1-ride | x0xproc1-clap | Stargate / Fugue State |
| `x0x-2` | x0x grit | x0xproc2-kick | x0xproc2-snare | x0xproc2-hatclsd | x0xproc2-rimshot | x0xproc2-cymbal | x0xproc2-clap | Stargate / Fugue State |
| `synth` | Synth kit | synthkit-kick | synthkit-snare | synthkit-hatclsd | synthkit-8bit | synthkit-ride | synthkit-clap | Stargate / Fugue State |
| `dist` | Distorted | distkit-kick | distkit-snare | distkit-hatclsd | distkit-claves | distkit-ride | distkit-clap | Stargate / Fugue State |
| `acoustic` | Acoustic | kick_Szpaderski_24_dampened | snare_12x5 | hihat_BRD_tight | VCSL Snare4_Xstick | ride_BRD_22 (trimmed) | VCSL Claps | Stargate / Karoryfer, VCSL |
| `acoustic-rusty` | Rusty | kick_Polmuz_mod_20_buzz | snare_ziggurat | hihat_BRD_closed | jewelers_anvil | crash_BRD_17 (trimmed) | freesound handclap01 | Stargate / Karoryfer, Freesound |
| `hand` | Hand percussion | VCSL Cajón (bass) | VCSL Conga slap | VCSL Shaker, small | VCSL Claves | VCSL Tambourine | VCSL Claps | VCSL |
| `world` | Frame and darbuka | Swirly cajon_kick | Darbuka 1 (tek) | Swirly hat_tight | Darbuka 3 | frame_drum_16 | Swirly snare_edge | Karoryfer Swirly, Stargate |

The Fischer names come from `ls` of the repository, but pick final files by ear. The table is a starting shortlist, not a mix decision.

At roughly 6 × 50–150 KB per kit, ten kits add about 4–8 MB to `public/`. That's fine for the CDN, and nothing downloads until a kit is chosen.

**Musical fit with the line-type convention** (`CLAUDE.md`, "Line → instrument"):

- **metro** (lead/bass): `x0x`, `tr808-tight`
- **tram/trolley** (rhythmic): `synth`, `dist`
- **bus** (pads/textures): `acoustic`, `hand`
- **hev/rail** (low, long): `tr808-deep`, `world`

The same mapping can feed the genre recipes in `lib/ai/musicalPolicy.js` (techno → `x0x`, dub → `acoustic-rusty`, ambient → `hand`), so plans pick a fitting kit.

## 5. Growing the model (ordered by payoff per effort)

### 5.1 Per-pad sample choice (a pad library, small)

Kits become presets over a **sample library**, and each pad can pick any sample of a fitting category.

- `lib/drumSamples.js` (pure) holds `{id, category: 'kick'|'snare'|…, url, label, source, licence}`. `DRUM_KITS[].samples` becomes `{pad: sampleId}`.
- A new sparse key, `pads: {pad: sampleId}`, overrides the kit's choice, beside `voices`. Absent means the kit default, so there's no schema bump. `normalizeDrumKit` validates ids against the library.
- UI: a "Sample" select in the existing per-pad sound panel (`drum-voice-panel`), filtered by category, with the kit's default listed first.
- Plans: `pattern.sample` is an id from the library (an enum in the strict schema). Both apply paths go through `planDrumPattern`.

This turns about 60 committed one-shots into thousands of combinations. It is the biggest gain for the least code.

### 5.2 Velocity → sample layer (small to medium)

Today a 0.4 step is a quieter loud hit. Karoryfer and VCSL ship velocity layers, so a soft step could play a soft *recording*:

- A library entry gains `layers: [{url, vel}]`. The `PadVoice` sample builder keeps one buffer per layer and picks by step level: accent → loudest, normal → middle, ghost → softest.
- Gain still scales within a layer, so humanize's velocity jitter keeps working.
- This is what makes ghost notes on an acoustic snare sound real (`roles` mode already writes them for quiet stops).

### 5.3 Round-robin (small, once 5.2 exists)

Rolls (`ratchets`) and fast hats on one sample sound like a machine gun. Swirly and VCSL ship 2–4 round-robins (`_rr1.._rr4`).

- Cycle them per pad, or pick one with the seeded RNG `drumStepHits` already takes.
- Keep it deterministic per pass, so MIDI and WAV exports match playback.

### 5.4 More than six pads (medium to large)

An open hat with **choke** (a closed hat cuts the open one off), toms for fills, and a perc pad would make kits like `hand` and `world` complete. This changes the pad model in many places:

- `PAD_DEFS`, the 6-row grid and the DAW `DrumLane`
- the sidechain source ids `__drums__:<pad>`
- plans, MIDI note mapping and the phone `DrumLaneSheet`

A cheaper middle step is an **alt sample per step**: a step flag that plays the pad's second sample (closed → open hat, snare → rimshot), with choke between them. The pad count stays at six.

### 5.5 Render our own kits (medium, no licence risk)

Sounds we synthesize ourselves are ours to license as CC0. A Node script could render one-shots offline:

- from the Layered Tone voices (`lib/drumVoices.js`, via `Tone.Offline`)
- from Macro, the committed Plaits wasm (`public/wasm/macro-*.wasm`, already run headless by `test/macro-dsp.test.js`). Its analog and synthetic kick, snare and hi-hat engines cover the missing **909-like** territory.

Plaits' code is MIT and the audio it renders isn't covered by that licence, so rendered files are plain CC0 by us. This also gives sample-quality kits at the cost of synthesis: rendering at several tune and decay settings is free.

### 5.6 User samples per pad (medium, Pro)

`lib/customAudio.js` already validates size, type and duration, and `useCustomUploadGate` already gates Sampler uploads on `limits.customUploads`. A per-pad "Load sample…" could reuse both. Like Sampler uploads, the file would stay on the device, so a shared song needs a fallback (the kit's default sample).

### 5.7 Data-driven sample choice (small, after 5.1)

- **Line type picks the kit** when a route is bound to a pad, following the table in §4.
- **Stop signals pick the layer.** Hubs (high `centrality`) play the accent layer, quiet stops play the ghost layer. This is the same mapping `roles` mode uses for velocity, with real recordings behind it.
- **City picks a default kit**, for example Budapest `acoustic-rusty` and Berlin `x0x`, as a seed for new sessions.

## 6. File format and size

- **Keep WAV or switch to FLAC. Never MP3 for drums.** MP3 encoders add about 20–50 ms of leading silence, which puts every hit late. `decodeAudioData` decodes FLAC in current Chrome, Firefox and Safari. Check it on the oldest iOS Safari we support before switching, and update the RIFF/WAVE check in `test/drum-kit.test.js` if we do.
- **Processing per file:**
  - mono
  - 44.1 kHz
  - leading silence trimmed to the first transient
  - tail cut at −60 dB, with a 5 ms fade, capped at 1.5 s (cymbals up to 3 s)
  - peak-normalized

  Pad balance then lives in code (`SAMPLE_PAD_GAIN`, or a per-sample gain in the library), so the files never need re-editing. Record "trimmed, normalized" in `ATTRIBUTION.md`.
- **Budget:** about 300 KB per kit and 10 MB for the whole library. The Karoryfer rides (3.2 MB each) and VCSL snare rolls (1.4 MB) must be cut.
- **Delivery:** `public/samples/drums/<kit>/` on the CDN, as now. Move to Vercel Blob only if the library grows past what's reasonable in git.
- A `scripts/import_drum_samples.js` (sox or ffmpeg) could do the processing from a small manifest and write the attribution table, so a new kit is "add manifest rows, run the script".

## 7. Recommendation

**Status (2026-11-23):** kit pack 1 is in, as six Stargate kits (`x0x`, `x0x-grit`, `synth`, `distorted`, `acoustic`, `rusty`) imported by `scripts/import_drum_samples.js`. The `hand` kit (VCSL) and the extra 808 kits are still open.

1. **Kit pack 1, now.** Add `x0x`, `synth`, `dist`, `acoustic` and `hand` from Stargate and VCSL, and `tr808-deep` from Fischer. Only `DRUM_KITS` entries, files and attribution change. Fix the Meadowlark line in `drum-research.md` §2.3.
2. **Pad library (§5.1).** It multiplies the value of every kit added after it.
3. **Velocity layers and round-robin (§5.2, §5.3)** for the acoustic and hand kits.
4. **Rendered kits (§5.5)**, for a CC0 909-style kit and Plaits-flavoured kits.
5. Later: the alt sample with choke (§5.4), user samples (§5.6), and the data-driven defaults (§5.7).

Email the Tier B origins (Boxed Ear for the CR-78, the LinnDrum archive) in parallel. If they confirm public domain, a CR-78 kit and a LinnDrum kit are the most characterful additions possible.

## Sources

- tidalcycles/sounds-tr808-fischer: https://github.com/tidalcycles/sounds-tr808-fischer
- Stargate sample pack: https://github.com/stargatedaw/stargate-sample-pack
- sfzinstruments drums catalogue: https://sfzinstruments.github.io/drums, SM Drums: https://sfzinstruments.github.io/drums/sm_drums
- Karoryfer: https://github.com/sfzinstruments/karoryfer.unruly-drums, https://github.com/sfzinstruments/karoryfer.big-rusty-drums, https://github.com/sfzinstruments/karoryfer.swirly-drums
- VCSL: https://github.com/sgossner/VCSL
- Meadowlark factory library: https://github.com/BillyDM/meadowlark-factory-library
- Sonic Pi samples and their provenance: https://github.com/sonic-pi-net/sonic-pi/blob/dev/etc/samples/README.md
- oramics/sampled: https://github.com/oramics/sampled
- tidal-drum-machines: https://github.com/geikha/tidal-drum-machines
- Salamander Drumkit: https://github.com/endolith/Salamander-Drumkit
- DrumGizmo Muldjord kit: https://github.com/sfzinstruments/DrumGizmo.MuldjordKit
- Freesound API v2: https://freesound.org/docs/api/resources_apiv2.html, CC0 filter example: https://opensource.creativecommons.org/blog/entries/freesound-intro/
