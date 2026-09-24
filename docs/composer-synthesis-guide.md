# Leið composer: synthesis and sampling

Research date: 2026-09-24. Companion chapter to the [musical and genre guide](composer-musical-guide.md) and [composer instruction draft](composer-musical-prompt.md). Audited against the installed **Tone.js 15.1.22** and the current repository. This is documentation, not a runtime change or a collection of auditioned presets.

**Compose the notes and the sound together.** The same pattern can become a bass groove, a gentle keys figure, or a percussion texture depending on its source, register, articulation, and processing. Choose the role first, then design how that role begins, occupies space, and ends.

All numerical recipes below are original starting settings for evaluation. They are not measurements of successful generated music. External sources explain the synthesis methods; repository references establish what Leið actually does. Library capability, engine capability, UI control, and composer control are different boundaries.

Quick navigation: [instrument inventory](#1-instrument-inventory), [techniques](#2-synthesis-techniques-and-their-musical-use), [timing](#3-envelopes-are-part-of-the-groove), [samples/granular](#4-use-samples-as-musical-material), [sound recipes](#5-sound-recipes-for-the-current-composer), [beat blueprints](#6-build-a-beat-from-complementary-sounds), [improvement priorities](#7-unlock-more-of-the-existing-instruments), [audition procedure](#8-audition-sound-design-in-context).

## 1. Instrument inventory

The primary references are [soundSpecs.js](../lib/soundSpecs.js), [engine.js](../lib/engine.js) (`buildSynthOpts`, synth construction, `updateEnvelope`, `_triggerSynth`), [DawView.jsx](../components/DawView.jsx), and [planSchema.js](../lib/ai/planSchema.js). The current picker offers **six** types: `Synth`, `FMSynth`, `NoiseSynth`, `PolySynth`, `Sampler`, and `Drums`. The plan accepts **12**, including six additional types with engine implementations but absent from that picker.

### Instrument matrix

| Type | Sound-making method / role to explore | Composer can shape now | Important boundary |
| --- | --- | --- | --- |
| `Synth` | Triangle oscillator by default, with amplitude envelope; bass, lead, plucked-style figure | Amp ADSR, register, filter, articulation, FX | AI cannot select oscillator waveform |
| `FMSynth` | Carrier/modulator pair; tonal colour, keys-like material, digital lead | Carrier ADSR, register, external filter and FX | Ratio, index, oscillator shapes and modulation envelope are not plan fields |
| `NoiseSynth` | Noise with amplitude envelope; ticks, shakers, breathy texture | ADSR, route filter, level, event rhythm | Noise has no melodic pitch; octave/scale does not turn it into a bass or lead |
| `PolySynth` | Voice allocator around a synth; overlapping figures and sustained support | Amp ADSR, filter, register and FX | Default inner voice is `Synth`; it does not compose chords; AI cannot select inner voice |
| `Sampler` | Pitched playback of mapped samples | Named preset, pitch, attack/release, filter, FX | Decay/sustain do not shape it; no generated sample zones or velocity-layer selection |
| `Drums` | One sample voice on a route | Drum voice, attack/release, route timing/filter/FX | Fixed C4 trigger; route pitch is deliberately ignored; separate from the six-pad kit |
| `AMSynth` — additional | Audio-rate amplitude modulation; hollow or complex colour | Carrier ADSR and common lane controls | Harmonicity and modulation envelope are outside AI control |
| `MonoSynth` — additional | Oscillator, internal filter/envelope; bass/lead gestures | Common ADSR/filter/glide controls | Internal filter-envelope parameters are not the same as the route filter and are outside AI control |
| `MembraneSynth` — additional | Pitched oscillator transient; kicks/toms | Amp ADSR, route pitches, common controls | Pitch sweep settings are outside AI control; variable route notes create tuned percussion |
| `MetalSynth` — additional | Inharmonic oscillator bank; metallic percussion | Common envelope/filter/level controls | Treat as a percussion colour; do not infer ordinary pitched harmony or universal ADSR behavior |
| `PluckSynth` — additional | Excited resonator / plucked-string model | Route notes, external filter, volume, FX | Engine calls attack only; duration, velocity and generic ADSR do not control its pluck |
| `DuoSynth` — additional | Two parallel monosynth voices with ratio/vibrato | Common ADSR and lane controls | Current builder applies shared amp envelope and oscillator choice to both voices; no AI voice ratio/vibrato programming |

“Additional” means inspect and audition before using as a default recipe, particularly because the user cannot reselect it from the current picker. Prefer the six visible types for the initial supported recipe set. Keep the others in the knowledge base with their actual limitations.

### Which synthesis controls are exposed?

| Control | Existing implementation / UI | AI plan |
| --- | --- | --- |
| Waveform selection | UI includes sine, triangle, square, sawtooth, fat variants, pulse, PWM where applicable | Not exposed |
| FM/AM harmonicity and modulation envelope | Engine parameters; relevant synth editor controls | Not exposed |
| FM modulation index | Engine and FM editor | Not exposed |
| PolySynth inner voice | Engine can use Synth/FM/AM; current UI uses generic synth controls | Not exposed |
| Two independent Duo patches | Underlying library supports distinct voices; current builder links key settings | Not exposed |
| Full synth amp ADSR | Engine/UI with instrument-specific exceptions | Exposed as `envelope` |
| Sample attack/release | Engine/UI | Exposed through `envelope.attack/release` |
| Insert filter type/frequency/Q | Engine/UI, separate from synth-internal filter envelope | Exposed |
| Granular layer | Engine/UI | Exposed with limitations below |
| Synth envelopes / filter automation | Some manual engine/UI paths | No authored automation lane in the plan |
| User sample loading | Manual, session/instance behavior below | No sample upload or zone-map authoring |

Do not emit hypothetical `oscillator`, `harmonicity`, `modulationIndex`, `voice`, or `filterEnvelope` fields into the current plan. A sound-design explanation cannot make an unsupported field work.

### The six-pad kit is already a small synthesis ensemble

The main drum kit in [drumEngine.js](../lib/engines/drumEngine.js) is synthesized, whereas the selectable `Drums` lane is sample-based:

| Kit pad | Fixed source | Character-setting defaults | Composition implication |
| --- | --- | --- | --- |
| `kick` | MembraneSynth at C1 | Pitch decay 0.05 s, sweep setting 6 octaves | Use as the dependable low anchor |
| `snare` | White NoiseSynth | Decay 0.13 s | Broad noisy backbeat; leave spectral room |
| `hat` | MetalSynth at C6 | Decay 0.05 s | Short bright subdivisions; use lower velocity |
| `rim` | MembraneSynth at A4 | Pitch decay 0.008 s, sweep setting 2 octaves | Compact contrasting accent |
| `ride` | MetalSynth at C5 | Decay 0.4 s | Longer metallic tail increases density |
| `clap` | Pink NoiseSynth | Decay 0.18 s | A softer-spectrum noise accent; not a sampled handclap |

These are audited defaults, not AI-adjustable pad patches. The kit has per-pad levels internally and a fixed compressor before shared DAW inserts. The plan can set pattern velocities and shared treatment; it cannot change each pad's pitch/synthesis settings or give every pad its own FX chain. Choose hat versus ride, rim versus clap, and their accents deliberately to exploit the timbral contrast already available.

## 2. Synthesis techniques and their musical use

### Subtractive synthesis: establish a useful spectrum, then shape it

Subtractive synthesis shapes an oscillator's spectrum using filters and envelopes. A harmonically rich source gives the filter more material to work with. [Native Instruments: Subtractive Synthesis](https://blog.native-instruments.com/subtractive-synthesis/)

For Leið, select `Synth` or a compatible `PolySynth` patch and use the route filter to assign foreground/background. A low-pass filter can reduce brightness, but a cutoff below the bass fundamental also weakens the intended note. Raising cutoff cannot add harmonics missing from the source. Use moderate resonance initially; its peak should not become an accidental second hook.

**Manual exploration:** compare triangle, square, and sawtooth on the same phrase at similar loudness. Then try a short envelope and a sustained envelope. Hear how source spectrum and articulation change the role before adding effects. Waveform choice is available manually, not to the current AI plan.

`Tone.Synth` itself is an oscillator through an amplitude envelope. Leið's route filter supplies additional spectral shaping. `MonoSynth` has a separate internal filter/envelope path; moving the route cutoff does not rewrite that envelope. [Tone.js: Synth](https://tonejs.github.io/docs/15.1.22/classes/Synth.html), [Tone.js: MonoSynth](https://tonejs.github.io/docs/15.1.22/classes/MonoSynth.html)

### FM: separate loudness motion from timbre motion

In FM synthesis, a modulator affects a carrier's frequency. Frequency ratio, modulation amount, and their evolution influence the spectrum; harmonic and inharmonic relationships produce different colours. Independently shaped carrier and modulator envelopes allow the attack and tail to differ spectrally. [Native Instruments: FM Synthesis](https://blog.native-instruments.com/what-is-fm-synthesis/)

Tone's `FMSynth` provides harmonicity, modulation index, carrier envelope, and modulation envelope. [Tone.js: FMSynth](https://tonejs.github.io/docs/15.1.22/classes/FMSynth.html)

**Leið-specific consequence:** its default patch uses sine carrier/modulator, harmonicity `3`, modulation index `4`, and modulation attack `0.5` seconds. The plan edits carrier ADSR but cannot shorten that modulation attack. An amplitude attack of 0.005 seconds therefore does not guarantee a bright struck FM bell. A short note may end before the modulation develops fully.

**Today:** use the existing FM colour as an audition candidate, adjust note activity, amp envelope, register, and external filtering. **Manual technique / future AI control:** compare a quickly decaying modulation envelope with a longer carrier tail for a struck character; use slower modulation onset for a developing tone. Try a few simple ratios before inharmonic ones. Ratio and index changes belong to the actual FM editor or a future schema extension, not invented plan fields. A two-operator patch is not a complete DX7/FM8 algorithm.

### AM: spectral character versus tremolo

`AMSynth` modulates one synth's amplitude with another audio-rate synth. Its ratio affects the resulting timbre. [Tone.js AMSynth source](https://raw.githubusercontent.com/Tonejs/Tone.js/15.1.22/Tone/instrument/AMSynth.ts)

Use AM as an alternative foreground colour when a simpler oscillator feels too plain; evaluate it against the harmony, because extra spectral components can sound rough. Keep it sparse initially. Do not equate choosing `AMSynth` with setting a slow tremolo. Slow periodic gain changes and audio-rate modulation serve different musical jobs. In Leið's send architecture, a tremolo bus modulates its branch while the dry signal remains present.

### Polyphony, layering, and unison are different choices

`PolySynth` allocates voices for another instrument; it is not a distinct synthesis algorithm. [Tone.js: PolySynth](https://tonejs.github.io/docs/15.1.22/classes/PolySynth.html)

Use overlapping voices when the phrase needs sustained support. Avoid long tails on every fast note. Polyphony does not supply voicings or a chord progression. Leið's default Poly voice is `Synth`; its builder falls back to that inner voice's envelope when none is supplied, so specify the intended envelope rather than relying on a different-looking “Poly” default entry.

Layering should give each component a job: transient/body, dry detail/texture, or low anchor/upper colour. Two unrelated route lanes are not automatically a tightly layered patch. Shared note timing/pitch needs explicit duplication or note control, which the current plan does not author. A granular layer does follow its lane, with the caveats below.

For `DuoSynth`, two internal voices can create composite colour, but this is still a monophonic architecture rather than independent chord notes. The older official architecture description agrees with the audited installed implementation; use local code for current parameter behavior. [Tone.js: DuoSynth architecture](https://tonejs.github.io/docs/14.7.11/DuoSynth)

### Percussion synthesis: design the transient, body, and tail

A kick-like synthetic sound can use an oscillator with a rapid pitch movement and amplitude envelope. Tone's `MembraneSynth` implements that approach. [Tone.js: MembraneSynth](https://tonejs.github.io/docs/15.1.22/classes/MembraneSynth.html)

Leið's sampled `Drums` voice is the straightforward choice for a consistent route-triggered drum sound. Explore `MembraneSynth` when pitched percussion is intended; a moving route melody will change its pitch. Do not promise a tunable 808 kick from controls that only change its amp envelope.

Noise can contribute an unpitched transient or breathy layer. Use `NoiseSynth` with short amplitude shaping and a route high-pass/band-pass filter for light ticks and shaker-like texture. Its timing can follow the route, but its musical function comes from rhythm and spectrum, not the selected scale.

Tone's `MetalSynth` combines inharmonic FM oscillators and high-pass shaping. Its constructor uses a zero-sustain envelope, so a generic sustained-pad recipe is inappropriate. [Tone.js MetalSynth source](https://raw.githubusercontent.com/Tonejs/Tone.js/15.1.22/Tone/instrument/MetalSynth.ts)

The kit, a `Drums` route, `NoiseSynth`, and `MembraneSynth` are distinct sound sources. Do not double all their attacks by default. Choose one foundation and add another only for a clear rhythmic or spectral contrast.

### Physical modelling: preserve the resonator's own decay

The Pluck family uses a Karplus–Strong-style string model: an excitation feeds a resonant delay structure. Tone's older official documentation describes the method; current Leið triggering was checked in the installed implementation. [Tone.js: PluckSynth](https://tonejs.github.io/docs/14.7.58/PluckSynth)

In Leið, `_triggerSynth` invokes only `triggerAttack` for this type. Generic note length, velocity, and ADSR do not provide the shaping promised for ordinary synth voices. Use external level/filter/FX and sparse notes; do not tell the user to shorten its ADSR release to tighten the pluck. Its own damping/resonance controls already have static manual editors; they need a composer adapter to become AI-controllable. A short-envelope `Synth` is the more predictable AI-generated plucked-style alternative today.

## 3. Envelopes are part of the groove

Attack is time to rise; decay is time to reach the sustain level; sustain is a level held while the gate remains open; release is the fade after note-off. Release is not total note length. [Tone.js: Envelope](https://tonejs.github.io/docs/15.1.22/classes/Envelope.html)

Calculate timing before choosing a “soft” or “tight” preset:

```text
quarter-note seconds = 60 / BPM
eighth-note seconds = 30 / BPM
sixteenth-note seconds = 15 / BPM
arp gate seconds = arp step seconds × gate fraction
```

At 124 BPM, eighths are about 242 ms and sixteenths about 121 ms. For an eighth-note arp with a 0.5 gate, note-off is about 121 ms after onset. A 400 ms attack will not reach its intended peak before release. A 600 ms release can overlap several subsequent events.

**Current scheduling matters:** normal mock-route notes use a **one-beat gate (`4n`)**, regardless of grid, speed, or crop; the legacy percussive mode uses `8n`. A sixteenth-note grid changes where onsets can land, not their ordinary gate length. With sustain `0`, amp decay can make a short pulse within that gate. With nonzero sustain, shortening release alone does not shorten the held body. This is especially important for samples, where no amp decay/sustain adapter exists.

Every route stop launches an entire arp sequence. Its note gates use `rate × gate`, but successive stop-launched sequences can overlap. Reduce source-stop activity before assuming that a slower arp rate reduces the aggregate density. Legato holds can work for mono voices; Sampler/PolySynth can accumulate voices instead of providing true mono legato. Only synths exposing portamento receive glide. Keep sampler/poly legato off in initial recipes.

Proposed envelope families for ordinary ADSR-capable synths:

| Intent | Attack | Decay | Sustain | Release | Rhythm implication |
| --- | --- | --- | --- | --- | --- |
| Compact bass pulse | 0.005–0.015 s | 0.08–0.18 s | 0 | 0.05–0.12 s | Decays within the ordinary one-beat gate |
| Plucked-style foreground | 0.003–0.01 s | 0.1–0.25 s | 0 | 0.06–0.2 s | Clearly defined attacks and gaps |
| Held lead | 0.01–0.04 s | 0.1–0.3 s | 0.4–0.7 | 0.1–0.3 s | More connected figure; monitor overlap |
| Soft support | 0.03–0.1 s | 0.15–0.5 s | 0.3–0.65 | 0.3–0.8 s | Softens articulation without assuming long note gates |
| Slow swell — conditional | 0.3–1 s | 0.2–0.8 s | 0.5–0.8 | 0.8–2 s | Needs a sufficiently long held/drone note; not arbitrary short triggers |

Do not apply this table unchanged to Sampler, Drums, PluckSynth, or every legacy instrument. Use the instrument adapter and its actual gate. For a drumless ambient request, slow scheduling and restrained short attacks may work better than long attacks on short notes.

Velocity and note chance are not interchangeable. Velocity changes the strength of a hit; chance changes whether it happens. Preserve reliable low-end anchors and use quieter subdivisions before random omission. Do not assume velocity changes FM brightness or chooses new sample layers unless an explicit mapping does so.

Leið sidechain ducking is a scheduled gain dip triggered by note events, not an audio-level detector/compressor. Source velocity scales its depth; arps trigger the duck once per source stop, not every arp note. FX sends are tapped after route filtering/EQ/ducking, but previously generated effect tails are not ducked by that insert. Bus tremolo/autofilter also leaves dry sound present. Design rhythmic breathing around the actual source events and routing.

## 4. Use samples as musical material

### The available palette

The preset registry contains **22** IDs. These are source families, not a promise of every articulation associated with those instruments:

| Family | Exact preset IDs | Useful role to audition |
| --- | --- | --- |
| Keys | `piano`, `piano-tji`, `casio`, `organ`, `harmonium` | Foreground motif, repeating keys figure, sustained source material |
| Bass / bowed strings | `bass-electric`, `contrabass`, `cello`, `violin` | Low anchor, mid-register body, textural support |
| Plucked strings | `guitar-acoustic`, `guitar-electric`, `guitar-nylon`, `harp` | Rhythmic detail, sparse answer, granular source |
| Woodwind / reed | `bassoon`, `clarinet`, `flute`, `saxophone` | Breath-like foreground colour or quieter answer |
| Brass | `french-horn`, `trombone`, `trumpet`, `tuba` | Sparse body/accent; avoid unnecessary low-mid crowding |
| Tuned percussion | `xylophone` | Clear percussive motif or upper response |

The one-shot `Drums` IDs are `kick`, `snare`, `hihat`, `openhat`, `crash`, `tom-lo`, `tom-mid`, `tom-hi`. The separate kit has `kick`, `snare`, `hat`, `rim`, `ride`, `clap`. Use the correct vocabulary for each.

### Source selection matters more than pretending every sample is a synth

Tone's Sampler repitches mapped source recordings to cover notes not explicitly sampled; its exposed envelope controls are attack and release. [Tone.js: Sampler](https://tonejs.github.io/docs/15.1.22/classes/Sampler.html)

In Leið, only `envelope.attack` and `envelope.release` are routed to the sampler; decay and sustain do not impose a synth ADSR. Raising attack can soften or remove a useful transient. Increasing release cannot restore audio after a finite sample has ended. Its ordinary route gate is still one beat, so a small release does not make an organ sample a short sixteenth-note stab. Changing the sample family is often more effective than pushing an unsuitable source through more effects.

Ordinary sample repitching changes playback speed and duration as well as pitch. Start near a preset's natural register; wide transposition can be a deliberate texture, but should be auditioned. The app does not offer a full sample-editing plan with independent time stretching, slice markers, round robins, velocity layers, or sustain-loop authoring.

Sample-based instruments need suitable sustain behavior to support held notes; recordings have finite duration unless the instrument loops them. [Yamaha: Sample Playback and Envelopes](https://yamahasynth.com/learn/synth-programming/synthesizer-basics-with-the-mx-part-i/)

### User samples and reproducibility

[MixerTab.jsx](../components/tabs/MixerTab.jsx)'s upload handler decodes the audio and calls `engine.setSamplerBuffer`. This adds a zone to an existing sampler instance. It does not create a persisted sample mapping or replace the named preset in saved React state. A rebuild can lose that zone; an absent sampler instance cannot receive it. The AI plan cannot upload or author these zones.

Consequently, generated examples should use the named presets. Treat user-upload workflows as manual experimentation until persistence and lifecycle behavior are improved. [sampleCache.js](../lib/sampleCache.js) helps reuse decoded preset material; cached loading is not a guarantee that a manually added sample zone will survive rebuilding or sharing. Unloaded sample voices drop triggers until ready: check both cold and warmed playback, especially for network-backed presets.

### Granular resynthesis: create a related texture

Granular synthesis reorganizes short portions of existing sound. Grain size, overlap, position, and playback behavior change how much of the source remains recognizable. [Native Instruments: Granular Synthesis](https://blog.native-instruments.com/granular-synthesis/)

Tone's `GrainPlayer` separates playback rate from pitch and crossfades successive grains through its overlap control. [Tone.js: GrainPlayer](https://tonejs.github.io/docs/15.1.22/classes/GrainPlayer.html)

Leið's [granularVoice.js](../lib/granularVoice.js) uses a rendered source, not a live capture of the entire lane mix:

- The synth source is rendered offline for 2 seconds with a C4 note starting at 0.05 seconds, held for 1.2 seconds. This is dry instrument material before route filter, EQ, and FX.
- There is one shared stream per granular voice rather than independent polyphonic grain clouds per note. Chords use the first note for grain pitch.
- Grain triggering does not receive the lane's velocity. Pitch transposition is clamped to ±2400 cents.
- `mix` adds grain output alongside the existing dry source; it does not crossfade the dry level away. The renderer/source gains differ, so a small mix can be more audible than expected.
- For sample sources, the nearest mapped zone is treated as C4 without correcting its original root key. Some presets can therefore produce a detuned grain layer. User-uploaded zones are not used by this named-preset render path.

**Use now:** start from a synthetic source, preserve the dry motif, use a low grain mix, and compare texture at playback rates 0.5 and 1. Keep pitched bass dry. Sample-source grain harmony needs a tuning check first.

Accepted granular ranges are grain size/overlap `0.01–0.5` seconds, rate `0.25–4`, mix/jitter/window fractions `0–1`, attack `0–2` seconds, release `0.01–6` seconds. Keep the loop window ordered and comfortably larger than a grain; avoid a tiny window pressed against the buffer end. Jitter randomizes source position, not drum timing. Instrument edits can re-render the source and restart the grain player; this is not guaranteed seamless timbral automation.

For an original first experiment, try grain size `0.1` s, overlap `0.05` s, rate `0.5`, low mix around `0.08`, and no jitter/reverse. Then change only grain size or mix. More overlap smooths transitions but does not guarantee a better sound. A very short grain can become a new timbre; larger grains retain more source detail. Commercial granular manuals demonstrate these possibilities, but their polyphony, scanning, and modulation systems should not be assumed to exist in Leið. [Native Instruments: ASHLIGHT Grain Page](https://docs.native-instruments.com/ni-tech-manuals/ashlight-manual/en/grain-page)

## 5. Sound recipes for the current composer

These recipes use the six types visible in the picker and the plan's existing fields. They are **settings to audition**, not full JSON plans. Resolve the actual route and source register, supply all required nested fields, and apply the main guide's explicit reset policy. A filter range is a starting region; listen for the intended note before accepting it.

`A/D/S/R` below means attack/decay/sustain/release; times are seconds, sustain is a 0–1 level. For samples, only A/R are effective. Start at restrained levels and compare at matched loudness.

| Recipe | Source and articulation | Filter / effect suggestion | Musical use and first edit |
| --- | --- | --- | --- |
| R1. Compact synth bass | `Synth`; A/D/S/R `0.008/0.12/0/0.08`; low sounding register, glide off | Low-pass roughly 500–1500 Hz, Q 0.7; dry initially | House/techno foundation. Shorten decay if its body masks the next kick |
| R2. Sampled bass anchor | `Sampler`, `bass-electric` or `contrabass`; A `0.005`, R `0.1`; sparse notes | Low-pass 1200–3000 Hz; preserve useful attack | Lo-fi/deep-house support. Compare source presets before adding distortion |
| R3. Defined plucked-style hook | `Synth`; `0.005/0.16/0/0.1`; one active foreground | Low-pass 2500–6000 Hz; quiet synced delay | House/garage-inspired response. Change decay, then echo send |
| R4. Restrained FM colour | `FMSynth`; carrier `0.01/0.2/0.35/0.2`; medium activity | Low-pass 3000–6000 Hz; little reverb | Digital melodic detail. Compare slower event rate; no claim of programmed FM bell attack |
| R5. Warm sampled keys | `Sampler`, `piano` or `piano-tji`; A `0.005–0.02`, R `0.15–0.35` | Low-pass 2500–5000 Hz; modest reverb or chorus | Lo-fi/deep house. Retain enough transient for the rhythm to read |
| R6. Sparse organ response | `Sampler`, `organ`; A `0.005`, R `0.12–0.25`; one-beat ordinary gate | Low-pass 1500–4000 Hz; delay sync `8n.`, feedback around `0.25`, low send | Dub/house texture. Reduce source activity to expose echoes; exact chords remain unavailable |
| R7. Soft synth support | `PolySynth`; explicit `0.04/0.25/0.45/0.5`; slower than the hook | Low-pass 1500–3500 Hz; restrained chorus/reverb | Ambient/melodic support. Reduce release if overlapping notes blur harmony |
| R8. Clear sampled answer | `Sampler`, `xylophone`, `harp`, or `guitar-nylon`; A `0.003–0.01`, R `0.15–0.3` | Low-pass only if needed; sparse echo | Distinct answer to warm keys. Compare register and preset, not extra melody density |
| R9. Light noise percussion | `NoiseSynth`; `0.003/0.04/0/0.025`; quiet | High-pass around 2500–5000 Hz or band-pass to taste; no long reverb | Techno/house texture. Shorten decay or remove events when hats already occupy the role |
| R10. Route-triggered drum accent | `Drums`, one selected sample, e.g. `tom-lo`; A `0.001`, R `0.08` | Suitable route filter; mostly dry | Occasional contrast to the kit. Change sample or timing; octave does not retune it |
| R11. Related grain shadow | R7 dry source plus granular `mix 0.08`, `grainSize 0.1`, `overlap 0.05`, `playbackRate 0.5`, window `0.1–0.55`, no jitter/reverse | Shared lane filter; reduce other spatial effects first | Ambient/melodic texture. Increase mix slightly only while the dry figure stays identifiable |

R11 still requires the remaining granular fields from the contract, including its attack/release. Its window is normalized to the rendered buffer and selects part of R7's held body. Start with a short grain-layer attack/release. A short-decay R3 source leaves much of the two-second render silent: if using it instead, locate and trim around audible attack/body material after audition. Do not use the table as a partial nested object if the schema requires a complete object.

### Useful manual extensions using the same instruments

| Explore manually | Technique | Musical payoff | Why it is not an AI recipe yet |
| --- | --- | --- | --- |
| Bass character | Compare triangle and square, then low-pass and envelope | Change weight and audibility without another lane | Oscillator choice absent from plan |
| FM struck tone | Faster modulator attack/decay than carrier decay | Bright onset with a cleaner tail | Mod envelope/index/ratio absent from plan |
| Slowly developing FM support | Modulator opens more slowly while carrier holds | Evolving timbre without new notes | Needs both held-note behavior and mod envelope control |
| AM alternative lead | Change carrier/modulator ratio at restrained level | Hollow/rough colour contrasting ordinary oscillator lead | Ratio absent; type outside picker |
| Resonant bass gesture | Coordinate MonoSynth internal filter envelope and amp envelope | Dynamic brightness with each attack | Internal filter envelope absent; type outside picker |
| Short physical pluck | Shape PluckSynth resonator decay/damping in its manual editor | Naturally decaying picked texture | Generic ADSR/gate cannot do this; composer adapter needed |

These are exploration directions, not promises that all manual UI paths are correct. Resolve the lifecycle/adapter defects below before promoting them to supported composer presets.

Two original manual experiments make the synthesis knowledge concrete:

- **FM struck figure:** sine carrier/modulator; compare ratios `1` and `2`, index `2–5`; mod A/D/S/R `0.001/0.12/0/0.08`, carrier `0.005/0.2/0/0.1`. Try a mid-register repeating figure with little reverb. Change index at matched level to hear spectral change, then lengthen carrier decay while leaving modulation short. These are editor settings, not valid extra fields in an AI plan.
- **Resonant mono bass:** start from MonoSynth's saw source, internal filter-envelope base around `100–200` Hz, excursion `2–3` octaves, Q around `1–3`, short filter attack and decay around `0.1–0.2` s. Use amp `0.005/0.15/0/0.08`. Compare a dry version and modest distortion. Verify the actual root remains audible and the envelope does not mask the next kick. The outer route filter is a separate stage.

Known adapter issues make automated sweeps a separate task: Pluck resonance automation assumes a `.value` property although Tone stores a number; generic envelope automation assumes a top-level envelope unsuitable for Duo and sample instruments, and one sampler-specialized path omits `Drums`. Manual construction/editor updates and automation therefore must not be treated as equivalent. Fix and audition those paths before promising continuously evolving patches from them.

## 6. Build a beat from complementary sounds

Use the [genre tempos and drum skeletons](composer-musical-guide.md#2-genre-recipes) with these sound assignments. Begin with a fresh baseline. The examples fit within three pitched lanes and three planned FX buses; they describe musical roles, not specific notes or guaranteed genre authenticity.

### Warm house starting point — 122 BPM

- Foundation: house kit skeleton with restrained hats and reliable kick/clap.
- Bass: R1, sparse and dry. Avoid low-end support layers duplicating its job.
- Foreground: R5, keeping enough piano transient to articulate the figure.
- Answer: optional R8 at a quieter level and slower activity. Omit if it crowds the foreground.
- Shared FX: synthetic reverb plus synced delay. Start near 1 second of reverb and low sends; use `wet:1` on these parallel buses. Echo should answer upper material, not fill the bass register.
- Try: shorten synth-bass decay; brighten piano slightly; introduce the quiet answer. Each edit has a separate musical purpose.

### Hypnotic transit beat — 132 BPM

- Foundation: steady kit; use its accents to establish the pulse.
- Bass: R1 with low variety and a controlled tail.
- Foreground: R3, repeated as the principal cell.
- Texture: R9, quiet and intermittent, only if the kit needs a contrasting texture.
- Shared FX: a little distortion on the foreground and a synced delay; keep one spare bus instead of filling it automatically.
- Try: compare dry versus distortion at matched level; reduce texture density; alter the foreground filter. Keep the notes recognizable while changing colour.

### Soft broken beat — 78 BPM

- Foundation: relaxed hip-hop skeleton with softer hats. It is straight-grid unless a future timing layer provides swing.
- Foreground: R5, or compare `guitar-nylon` with the same rhythmic role.
- Bass: R2 only if the foreground leaves low-frequency room.
- Answer: R8, sparse; no second continuous lead.
- Shared FX: restrained chorus or bitcrusher on upper material, with a small room reverb. Select two treatments first.
- Try: change the sample source; shorten sample release; reduce high-frequency percussion. Do not substitute random chance for human timing.

### Atmospheric fast beat — 174 BPM

- Foundation: D&B drum skeleton; the one-bar kit cannot replace detailed break editing.
- Bass: R1 or R2 with deliberate gaps; audition release against the fast kick pattern.
- Foreground: R4 or R5 with slower note activity than the percussion.
- Support: R7 only if its overlapping notes reinforce the tonal centre.
- Shared FX: room/plate-like synthetic reverb and a light delay on upper material; dry bass. Start without grain, then compare R11 on synthetic support as a separate variation.
- Try: remove every unnecessary support event; shorten bass tail; brighten the single focal instrument. Fast drums do not require frantic melodic motion.

For drumless ambient, combine R7 with a sparse R8-like sampled detail and optionally R11. To try grain on R3 instead, first trim the render to audible material. Explicitly disable inherited drums. Keep sample-based granular processing out of the default until root-note handling is corrected.

## 7. Unlock more of the existing instruments

Prioritize a reliable mapping from musical intent to audible behavior before a larger parameter list.

| Priority | Existing opportunity / defect | Concrete improvement | Verification |
| --- | --- | --- | --- |
| First | Plan accepts more types than the picker shows | Publish a shared capability registry with visible/selectable/supported status | Generated instruments are identifiable and editable in the UI |
| First | Generic ADSR hides instrument differences | Instrument-aware envelope metadata and adapters; fix explanations | Changing each offered control produces the expected audible change |
| First | Ordinary gate is fixed at one beat; each stop launches a full arp | Expose effective note gates and aggregate arp density to the planner; consider explicit duration control | Staccato requests produce short bodies, and faster grids do not create unintended overlap |
| First | FM default modulation develops slowly | Document it; add a few explicit FM patch profiles or bounded mod controls | Compare transient and held notes in the same register |
| First | Sample grain root is relabelled C4 | Preserve source-key metadata and compensate tuning | Dry and grain agree at C4 and octave boundaries |
| First | Uploaded zones are instance-local | Persist sample asset/mapping state and restore it on rebuild | Reload, switch instruments, save/share round trip |
| Next | Oscillator and FM controls already exist | Expose waveform, harmonicity, index, and mod ADSR with type-specific validation | Schema, state application, rebuild and playback agree |
| Next | Mono filter envelope / Pluck decay need dedicated controls | Add bounded, correctly typed instrument-specific adapters | Verify parameter changes on actual audio; no silent no-ops |
| Next | Poly/Duo behavior is not explicit | Declare inner voice and voice-specific settings, or publish named tested profiles | Voice allocation and intended timbral contrast survive state changes |
| Next | Grains have independent level/tuning/lifecycle semantics | Make additive mix clear; preserve pitch and velocity intent; invalidate renders appropriately | Repeated edits do not leave stale, detuned, or unexpectedly loud layers |

Avoid offering wavetable scanning, arbitrary FM algorithms, independent sample time stretching, per-pad kit effects, or detailed oscillator unison count/spread merely because a related synthesizer could support them. Start by making the controls already implemented coherent and reusable.

## 8. Audition sound design in context

Extend the main guide's listening rubric with a controlled comparison. For each promoted recipe, use the same route, key, BPM, and note events while changing one sound decision. Test low/mid/high registers, sparse and dense activity, retriggers, and held notes. Include stop/start and saved-state reload when implementation changes touch parameter handling.

Record both dry and in-mix examples. Check:

1. Does the transient make the intended rhythm easier to follow?
2. Does the actual gate let the envelope develop?
3. Is the bass still audible without dominating, including on small speakers?
4. Do tails, sample lengths, or grain layers blur subsequent events?
5. Does the control change its advertised property, rather than only loudness?
6. Does the instrument remain useful at more than one route density/register?
7. Can the listener name one attractive edit that preserves the beat's identity?

A recipe becomes a recommended default after successful audition, not because its numbers fit the schema. Log the source preset, effective patch, event timing, FX routing, and inherited state so failures can be reproduced. This research expands the composer's musical vocabulary; measured and listening-based comparisons establish which choices deserve to ship.
