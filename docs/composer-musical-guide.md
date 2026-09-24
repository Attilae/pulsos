# Leið: a musical guide for the composer

Research date: 2026-09-24. Scope: instrumental, loop-based electronic starting points for Leið, including synthesis and sampling with the instruments already in the repository.

**The desired result is a small musical idea that sounds intentional, survives repeated listening, and gives the listener a reason to touch a control.** A valid plan is only the first requirement. Musical success needs a clear focal point, complementary parts, an appropriate groove, and room to develop.

This is a research and implementation guide. It does not change the running composer. Read the [synthesis and sampling chapter](composer-synthesis-guide.md) alongside the genre recipes: instrument choice, articulation, register, rhythm, and effects are one musical decision. The companion [composer instruction draft](composer-musical-prompt.md) distils the recommendations for a future prompt update.

## How to use this guide

1. Read the capability boundaries before translating musical ideas into plan fields.
2. Choose one genre recipe, one mood, and one focal role.
3. Pair each role with a [sound recipe](composer-synthesis-guide.md#5-sound-recipes-for-the-current-composer), fit its envelope to the rhythmic spacing, then translate only supported controls.
4. Validate the plan and audition the result with the listening rubric.
5. Offer three specific edits that develop the same idea.

The sources are production tutorials and music education from Ableton, Berklee, Native Instruments, and iZotope. They support musical conventions and techniques; they do not prove that a particular generated song will be good. **All exact defaults, density budgets, starter patterns, evaluation thresholds, and Leið adaptations below are proposed design choices to test by listening.** Genre boundaries overlap. Tempo ranges are useful starting regions, never validity constraints. A user's explicit musical direction takes precedence.

## 1. Compose relationships before choosing patches

Begin with a short musical brief: “Warm deep house, 122 BPM, a restrained bass groove beneath one answering keys figure; space comes from short echoes.” This describes what the parts do together.

Assign each audible lane a job. A useful default is three pitched roles plus drums; use fewer for sparse music. A user asking for a dense piece can deliberately expand this budget.

| Role | Musical job | Starting register / activity | Failure to avoid |
| --- | --- | --- | --- |
| Bass | Establish tonal centre and rhythmic weight | Roughly C2–C3; a few deliberate attacks | Several independent low melodies competing |
| Hook | Give the listener something recognizable | Roughly C4–C5; short repeating figure | Continuous scale wandering with no phrase |
| Harmony / support | Add colour and context | Mid register, slower than the hook | Calling an unrelated melody a chord progression |
| Answer | Respond during the hook's gaps | Different register or timbre; optional | A second equally loud lead playing continuously |
| Texture | Add atmosphere or movement | Quiet, sparse or slowly sustained | Long tails occupying every frequency |
| Drums | Define pulse and genre-specific accents | Stable anchors, lighter subdivisions | Every available pad playing at equal strength |

Registers describe sounding pitches, not Leið octave-offset values. Inspect the actual route pitches before deciding that an offset produces bass.

### Melody and phrasing

A melody combines pitch and rhythm. Phrase endings can be established by a rest, a held note, or tonal resolution; stepwise motion and contrasting leaps contribute different kinds of character. [Berklee: What is Melody in a Song?](https://online.berklee.edu/takenote/conjunct-disjunct-melody-basic-definitions/)

A small motif gives repetition something identifiable to repeat. Note length, rests, phrase length, and placement around the downbeat are compositional choices in their own right. [Berklee: Writing Melodies](https://online.berklee.edu/takenote/simple-tools-for-better-melodies/)

Proposed starting rules:

- Establish one motif using roughly 3–5 pitch classes, usually within an octave. Repeated notes are welcome.
- Repeat its rhythmic identity before changing it. Change its ending, a single accent, or one pitch to make an answer.
- Leave a perceptible gap or held ending. A stream of equally spaced notes rarely communicates a sentence.
- For tonal styles, make strong arrivals agree with the intended harmony. Being in one scale does not make every simultaneous note pair restful.
- Give a leap a purpose: a peak, response, or transition. Avoid continuous large register jumps unless requested.
- Let the bass be simpler than the hook. Let an answering part occupy its gaps.

**Original illustration, not an executable Leið plan:** In A natural minor, play E4–G4–A4, then rest; answer E4–D4–C4, then rest. Keep A2 as a sparse bass anchor. The repeated rhythmic shape supplies identity, and the changed ending supplies contrast. This is an example to audition, not a claim that the current composer can encode those notes.

### Harmony

Choose the harmonic plan before decorating it: a tonic pedal, one repeated chord colour, two alternating chords, or a short progression. Start with a pedal when the generator cannot explicitly control chord changes. Minor, major, Dorian, and pentatonic scales are palettes; none is a complete mood or genre recipe.

For a future note-authoring layer, useful original exercises include Am–F–C–G for a broad melodic arc, Am7–Dm7 for restrained harmonic colour, and a sustained A/E pedal for an open texture. Keep common tones and move other chord voices short distances. Keep close chord clusters above the bass register. These are examples, not universal genre formulas.

### Groove, density, and repetition

Choose straight, swung, broken, or half-time feel independently of BPM. At 140 BPM a backbeat on beat 3 can suggest a 70 BPM pulse; a straight eighth-note arpeggio does not. Do not change BPM alone and claim a different groove.

Our initial density budget is **one busy pitched part at a time**. If the hook is active, simplify bass and support. Preserve kick/backbeat anchors while varying ornamental hits. Reserve chance for decoration until the main identity works without it.

Different loop lengths can create motion against a common pulse. Ableton illustrates this through patterns that drift relative to one another. [Ableton: Asynchronous or Polyrhythmic Loops](https://makingmusic.ableton.com/asynchronous-or-polyrhythmic-loops)

For Leið, start with a stable rhythmic anchor and at most one conspicuously drifting supporting layer. Listen through their overlap cycle. Several individually pleasant route loops can still collide when their phases change.

## 2. Genre recipes

The ranges and defaults in the table are **recommended initial settings for Leið**, informed by the linked references below. They are intentionally narrower than all the music a genre name can describe. Start with the named branch: “techno” alone should not silently mean both hypnotic minimalism and maximal hard techno.

| Recipe | Starting BPM region | Default | Essential identity |
| --- | --- | --- | --- |
| House | 120–130 | 124 | Quarter-note kick, offbeat lift, bass interaction |
| Deep house | 118–125 | 122 | House pulse, warm harmony, restrained melodic conversation |
| Hypnotic techno | 125–140 | 132 | Repeated rhythmic cell, stable pulse, timbral development |
| Dub techno | 110–125 | 118 | Sparse chord-like stabs, negative space, echo as a response |
| Melodic techno | 120–130 | 124 | Recognizable motif, harmonic tension, restrained percussion |
| Lo-fi hip-hop | 65–90 | 78 | Relaxed backbeat, soft attacks, economical melodic loop |
| Ambient / generative | No required tempo; try 60–90 internally | 72 | Slow perceived events, space, evolving texture |
| Synthwave | 85–115 | 100 | Repeating synth bass, prominent backbeat, broad lead/pad contrast |
| UK garage / 2-step | 128–138 | 132 | Broken kick, shuffled subdivisions, syncopated bass |
| Liquid-leaning drum & bass | 168–176 | 174 | Fast broken drums, slower harmonic layer, clear bass |
| Uplifting trance | 134–142 | 138 | Driving pulse, melodic repetition, arpeggiation and release |

### House

The core reference is a steady quarter-note kick, backbeat clap, and percussion woven around that pulse; 120–130 BPM is a common teaching range. [Native Instruments: House Music 101](https://blog.native-instruments.com/house-music-101/)

**Leið recipe:** drums + compact bass + one short hook. Make the bass rhythm converse with the kick. Use a bright, short envelope on the hook, light reverb, and a quiet delay response. Keep support softer than the hook. **First tweak:** open the hook filter a little. **Reject:** an incessant high arpeggio obscuring the bass groove.

### Deep house

Warm keyboard colours, bass, organ figures, some swing, and low-to-mid-120s tempos form the reference. The tutorial demonstrates a short chord progression and dotted-eighth echo. [Native Instruments: Deep House](https://blog.native-instruments.com/how-to-make-a-deep-house-track/)

**Leið recipe:** choose a warm keys-like sampler, simple low line, and occasional upper answer. Prefer a shared tonal centre and restrained brightness. Reverb should give depth; chorus can gently broaden support. **First tweak:** darken the keys or raise their delay send. **Boundary:** true chord voicings and swing need more than the current composer fields; a route-based sketch should be described accordingly.

### Hypnotic techno

Repetitive drum-led pulse and a 125–140 BPM working range are supported by the production reference. [Native Instruments: How to Make Techno](https://blog.native-instruments.com/how-to-make-techno/)

**Leið recipe:** firm drums, short low part, one narrow-range synth cell, optional quiet metallic answer. Treat rhythm and sound colour as the hook. Use controlled distortion and a small delay send; keep the bass dry. One drifting upper loop can work against stable drums. **First tweak:** filter cutoff or distortion send on the cell. **Reject:** every lane moving rapidly across two octaves with long reverb tails.

### Dub techno

The reference demonstrates synthesized chord stabs developed through sampling and effects. [Ableton: Dub Techno Chords](https://www.ableton.com/en/blog/make-dub-techno-chords-operator-and-lives-effects/)

**Leið recipe:** sparse stab-like upper material, a quiet low anchor, and lots of space for echo. Our 110–125 BPM region is a design choice. Use a synced delay as the audible answer and reverb behind it; avoid competing busy melodies. **First tweak:** vary the stab's delay send, then its filter. **Boundary:** the current composer can set delay time/feedback, but cannot author exact chord stabs or an arbitrary feedback-effects chain.

### Melodic techno

Melody, evolving harmony, atmospheric pads, sparse beats, reverb, and delay distinguish the reference; it gives a 120–130 BPM range. [Native Instruments: Melodic Techno](https://blog.native-instruments.com/melodic-techno/)

**Leið recipe:** let one upper figure dominate; pair it with slower bass and one restrained sustained support. Use minor or Dorian colour deliberately. A single arpeggiated role is enough initially. **First tweak:** shorten the hook release for definition or raise its octave for lift. **Reject:** describing independent scale melodies as a composed progression. A full tension/build/drop arc needs section control.

### Lo-fi hip-hop

The reference emphasizes 60–90 BPM, relaxed drums, warm textures, repetition, and economical harmonic material. [Native Instruments: Lo-fi Hip-hop](https://blog.native-instruments.com/lo-fi-hip-hop-beats/)

**Leið recipe:** warm keys-like lead, gentle backbeat, optional sparse bass, little high-frequency competition. Use softer envelopes and low-pass filtering; small chorus/reverb amounts can soften the image. Bitcrushing is available; an authentic tape/crackle model is not. **First tweak:** lower melodic variety, then compare a slightly brighter filter. **Boundary:** low BPM and low-pass filtering alone do not create swing.

### Ambient / generative

Ambient texture can involve granular processing, movement, and tonal coloration as well as reverberation. [Native Instruments: Better Ambient Atmospheres](https://blog.native-instruments.com/better-ambient-atmospheres/)

**Leið recipe:** two or three complementary layers, no obligatory drums, slow perceived attacks, and one relatively clear foreground detail. Our internal 72 BPM default is a scheduling convenience, not a genre definition. Give long releases fewer onsets. Choose compatible tonal material before adding spacious effects. **First tweak:** reduce a layer or change its release. **Reject:** dense notes hidden under huge reverb. Slow music still needs an intentional distribution of events.

### Synthwave

The reference builds a synth-led track at 100 BPM with bass, drums, chords, lead and effects. [Native Instruments: Synthwave](https://blog.native-instruments.com/synthwave/)

**Leið recipe:** even synth-bass pulse, clear backbeat, one legible lead, softer pad-like support. Our suggested effects are gentle chorus on support, restrained lead delay, and reverb behind the melody. **First tweak:** contrast a darker bass with a brighter lead. **Boundary:** chorus/detuned textures approximate part of the palette; the current plan cannot specify a gated-reverb snare or detailed analogue oscillator patch.

### UK garage / 2-step

Broken kicks, a backbeat, sub bass, and delayed subdivisions create the characteristic shuffle in the reference, around 130 BPM. [Native Instruments: UK Garage](https://blog.native-instruments.com/uk-garage-music/)

**Leið recipe:** use a broken drum skeleton, short bass notes, and sparse pluck-like responses. Keep reverb short enough that rhythmic gaps remain audible. **First tweak:** reduce overlapping melodic activity and make the bass more staccato. **Boundary:** the composer lacks a swing/microtiming field and vocal-chop control. Call the current output a garage-inspired straight-grid sketch; authentic shuffle is a capability gap, not something fixed by changing tempo.

### Liquid-leaning drum & bass

The reference discusses atmospheric/liquid branches and demonstrates a 174 BPM track with broken drums and bass. Its overview says 160–170 BPM but its worked example uses 174; this is one reason not to make published genre ranges hard rules. [Native Instruments: Drum & Bass](https://blog.native-instruments.com/drum-and-bass/)

**Leið recipe:** fast drums, slower sparse bass and harmony, a clear melodic detail. Avoid making every pitched lane play at drum speed. Leave bass mostly dry and add space to upper material. **First tweak:** simplify the lead or darken support. **Boundary:** one repeating 16-step kit pattern cannot reproduce sliced breaks and evolving ghost-note detail.

### Uplifting trance

The reference combines four-on-the-floor pulse, repeating melodic figures, atmospheric synths and long builds; its example uses 140 BPM. [Native Instruments: Trance](https://blog.native-instruments.com/trance-music/)

**Leið recipe:** one arpeggiated focal lane, rhythmically clear low support, restrained pad-like material, and steady drums. Use delay for lift, with reverb behind the lead. **First tweak:** change the focal arp's rate or brighten its filter, one at a time. **Boundary:** start with a trance-inspired loop. Exact chord sequences, supersaw patch programming, risers, and a composed breakdown/drop need further control.

### Hybrid requests

Choose a primary rhythmic identity and borrow one or two traits from the secondary style. “Ambient techno” can keep the techno pulse and borrow ambient space; it need not maximize both note density and reverb. “Lo-fi house” can keep house drums and borrow soft keys and darker tone. State the interpretation in the explanation. For an unfamiliar style, research it or acknowledge the approximation instead of attaching the label to generic minor-key arpeggios.

## 3. Rhythm sketches and melodic exercises

These are **original seed patterns**, not definitive genre transcriptions. They illustrate the intended accents. Each row is one 4/4 bar of sixteenth-note steps, indexed **0–15**; beats land at 0, 4, 8, 12. Unlisted steps are rests.

| Seed | Kick steps | Snare / clap steps | Hat steps | What to listen for |
| --- | --- | --- | --- | --- |
| House | 0, 4, 8, 12 | 4, 12 | 2, 6, 10, 14 | Offbeats lift the steady kick |
| Relaxed hip-hop | 0, 7, 10 | 4, 12 | 0, 2, 4, 6, 8, 10, 12, 14 | Unequal accents soften the even hats |
| 2-step skeleton | 0, 10 | 4, 12 | 2, 6, 9, 14 | Broken kick leaves room; shuffle still needs timing control |
| D&B skeleton | 0, 10 | 4, 12 | 0, 2, 4, 6, 8, 10, 12, 14 | Fast subdivision against slower bass motion |
| Half-time | 0, 10 | 8 | 0, 2, 4, 6, 8, 10, 12, 14 | Beat 3 defines the broad backbeat |

The current drum plan accepts 16 velocity values per pad: use `0` for rests, `1` for strong anchors, `0.7` for secondary accents, and `0.4` for quieter hits. Start with quieter hats than kick/backbeat. Identical step positions can support different styles through sound, tempo, accents, and microtiming. This table alone cannot establish genre authenticity.

For future melodic authoring, audition three versions of the same phrase: original; same rhythm with one changed ending; original with one note removed. Prefer the version that strengthens the recognizable gesture. Developing one meaningful change at a time is supported by Ableton's variation exercise. [Ableton: Mutation Over Generations](https://makingmusic.ableton.com/creating-variation-2-mutation-over-generations)

## 4. Effects should have a job

| Effect / process | Musical purpose | First move | Common failure |
| --- | --- | --- | --- |
| Low-pass filter | Set brightness and foreground/background contrast | Darken support before boosting lead | All parts become dull, or resonance becomes the loudest note |
| Reverb | Create depth and connect sparse events | Apply more to support than bass | Dense overlapping tails erase articulation |
| Delay | Answer a motif and establish a secondary rhythm | Add to one sparse upper part | Repeats obscure the next phrase |
| Chorus | Add motion and breadth | Use gently on sustained support | Low end loses focus; every lane becomes diffuse |
| Distortion | Add harmonic weight or a rough focal texture | Apply to one role and compare at similar loudness | Loudness is mistaken for improvement |
| Sidechain ducking | Make space or create rhythmic breathing | Use only with a suitable rhythmic source | Whole mix pumps without relation to the intended kick |
| EQ | Separate overlapping spectral roles | Remove an unnecessary overlap | Fixing an overcrowded arrangement with ever more processing |
| Granular layer | Add a slowly changing secondary texture | Introduce quietly around a stable motif | Texture hides the motif completely |

Reverb can mask low-frequency clarity. Filtering its input/return and ducking it around dry sounds are established techniques. [iZotope: Mixing Reverb](https://www.izotope.com/community/blog/essential-tips-for-mixing-reverb)

For the current composer, reduce the bass's reverb/delay sends and simplify the arrangement when return filtering is unavailable. Synced delay and sidechain ducking are available; use their real parameter/source IDs. A send value is an amplitude/routing control; it is not a percentage of perceived wetness or a reverb decay time.

For synthetic reverb, start with short spaces around 0.4–1.2 seconds for articulate material, 1.5–3 seconds for pads, and longer tails only when density allows. An eighth-note delay is `30 / BPM` seconds; a dotted eighth is `45 / BPM`. Prefer the plan's delay sync control (`8n`, `8n.`, etc.) to numeric time. These are proposed audition ranges. Fixed impulse responses do not acquire a new decay just because the plan supplies a decay value. Compare effects at similar output level and keep enough headroom for summing and tails.

## 4a. Connect genre, synthesis, and rhythm

A short, bright attack makes a syncopated figure read differently from the same notes with a slow swell. A bass tail can fill the space intended for the next kick. A granular shadow can develop a repeated figure without adding another melody. Choose those relationships before adding more lanes.

The [synthesis chapter](composer-synthesis-guide.md) contains the instrument audit, techniques, practical settings, and complete beat blueprints. Use these proposed combinations as entry points, then audition them:

| Genre direction | Bass / foundation | Foreground / support | Sound-and-rhythm relationship |
| --- | --- | --- | --- |
| House / deep house | Filtered `Synth` bass + stable kit | `Sampler` piano/organ or restrained `FMSynth` | Short bass articulation leaves kick room; keys make the answer |
| Hypnotic techno | Compact `Synth` bass + kit | Dry `Synth` cell and occasional filtered `NoiseSynth` | Change brightness and percussion accents while preserving the cell |
| Dub techno | Simple dry low anchor | Organ sample or short `PolySynth` figure + synced delay | Sparse attacks give echoes space; exact chord stabs still need note authoring |
| Melodic techno | Restrained low `Synth` | One `FMSynth`/`PolySynth` motif; softer support | Shorter foreground and slower support preserve the melody |
| Lo-fi hip-hop | Gentle kit; optional sparse bass | Piano sample, low-pass tone, restrained chorus/bitcrusher | Softer transients change feel; filtering does not provide shuffle |
| Ambient | No obligatory kit; slow event pacing | Sampler or `PolySynth` detail + low granular layer | Keep the source audible while its texture evolves |
| Synthwave | Repeating low `Synth` | `PolySynth` lead/support, modest chorus | Strong backbeat and contrasting envelopes give shape |
| UK garage | Broken kit + short filtered bass | Sparse FM/plucked-style figure | Preserve rhythmic gaps; true swing remains unavailable |
| Liquid D&B | Fast kit + slower bass | Piano/FM detail and restrained spacious support | Pitched material need not match the hats' speed |
| Trance | Stable kick and low support | One articulated `PolySynth` arp + delay | Gate and release determine whether the arp drives or smears |

These choices use the six types visible in the current picker. They are proposed Leið adaptations, not claims that a synth class guarantees a genre or that every patch has been auditioned. The chapter also covers six additional types accepted by the plan but absent from the current picker.

## 5. Translate the music honestly into Leið

The following audit describes the repository on the research date. The shared vocabulary is in [planContract.js](../lib/ai/planContract.js), the accepted structure in [planSchema.js](../lib/ai/planSchema.js), and in-app request context in [composer.js](../lib/ai/composer.js). The MCP skill also has [five existing recipes](../skills/leid-composer/references/recipes.md); those recipes are not included in the in-app prompt.

| Intention | Available to the composer | Boundary / consequence |
| --- | --- | --- |
| Tonal coherence | Global/per-lane root and scale, octave, contour, variety | Does not write specific notes or guarantee consonant simultaneous voices |
| Melodic figure | Route selection, crop, grid, speed, arp | Cannot encode a chosen motif, per-stop pitches, or exact melodic rhythm |
| Chords | Polyphonic instruments, overlapping notes, arps, drone | A `Chords` label or `PolySynth` alone does not create a chord progression; no authored voicing schedule |
| Groove | 16-step drums with velocity, lane speed/grid | No swing or microtiming fields; a coarse grid is not a groove template |
| Sparse variation | Lane `noteChance`, loop play/rest pattern | Chance drops fresh notes each pass; it is not a stable rhythmic phrase |
| Timbre | Synth/sample preset, ADSR, filter, glide, granular layer | Sound names and patches still require audition in their actual register |
| Mix | Volume, pan, sidechain, FX sends and bus parameters | No authored eight-band EQ state or return-chain construction in the plan |
| Arrangement | Repeating lane cycles and play/rest patterns | No section schedule, delayed entrance field, or Song Chainer composition authoring |
| Revision | MCP can read saved snapshots | In-app request sends current user text and route context, without the current musical snapshot or conversation history |
| Evaluation | Schema validation and dropped-field reporting | No automatic audition or listening-based quality gate |

### Current vocabulary worth preserving

- Scales: `major`, `minor`, `pentatonic`, `pentatonicMinor`, `dorian`, `phrygian`, `lydian`, `mixolydian`. Roots use sharps (`C#`, not `Db`).
- Contours: `demand`, `geographic`, `randomWalk`, `arch`; variety `0–1`. A contour is a pitch-generating method, not a composed motif.
- Grid/arp rates: `4n`, `8n`, `8t`, `16n`, `16t`, `32n`. Lane speeds: `0.25`, `0.5`, `1`, `1.5`, `2`, `3`, `4`.
- BPM: `40–240`; octave offset: `-2–2`; volume/master: `-40–6` dB; pan: `-1–1`.
- Synths accepted by the plan: `Synth`, `FMSynth`, `AMSynth`, `MonoSynth`, `MembraneSynth`, `MetalSynth`, `NoiseSynth`, `PluckSynth`, `PolySynth`, `DuoSynth`, `Sampler`, `Drums`. The current DAW picker exposes only `Synth`, `FMSynth`, `NoiseSynth`, `PolySynth`, `Sampler`, `Drums`; see the [instrument matrix](composer-synthesis-guide.md#1-instrument-inventory) before choosing the other six.
- Drum pads: `kick`, `snare`, `hat`, `rim`, `ride`, `clap`. These IDs differ from the one-shot `Drums` instrument's sample IDs.
- Planned FX buses: at most three. Available IDs: `reverb`, `jcreverb`, `delay`, `pingpong`, `chorus`, `phaser`, `tremolo`, `vibrato`, `autofilter`, `autopanner`, `wah`, `distortion`, `bitcrusher`, `widener`.

Use the runtime contract as the final authority when implementing. Do not copy this list into another independently maintained validator.

### Route choice needs more information

The in-app model receives loaded route IDs, names, types, and stop counts. MCP also has city-wide route summaries, mean demand, descriptions, and access to saved songs. Neither planning request supplies a rendered note sequence or audio.

Stop count can suggest density but does not reveal how many distinct onsets survive a grid/crop, where simultaneous notes fall, or how the melody resolves. The composer should not claim it selected a “four-note hook” from that metadata alone. A future route-analysis stage should expose candidate note events, pitch range, onset count, loop duration, and phrase-ending candidates. Preserve transit identity by selecting and reshaping route-derived material deliberately.

### Loop windows: a crucial correction

In [engine.js](../lib/engine.js), `_buildRoutePart` rebases the selected route region to the beginning of the lane loop. **A later `startCell` selects different material; it does not make the lane enter later in the song.** The existing arrangement wording and a “late” recipe should be corrected when integrating this guide.

With the current 64-cell / 16-beat route grid:

```text
loop beats = 16 × (endCell − startCell) / 64 / speed
loop seconds = loop beats × 60 / BPM
```

At 120 BPM and speed 1, a full window lasts 8 seconds; a 16-cell window lasts 2 seconds. Moving that 16-cell window to cells 48–64 still creates a 2-second loop starting with the other lanes. Cropping may make a figure repeat more often. Lower speed, a coarser grid, and deliberate rest cycles can counter density, but must be checked together.

### New ideas and edits need different application rules

[planSnapshot.js](../lib/ai/planSnapshot.js) preserves omitted settings while replacing the enabled lane set. This makes hidden inherited state a musical issue.

For a **new composition**, use an explicit baseline: turn off unwanted arps, granular layers, drone, sidechain, and old sends; explicitly set intended chance/rest behavior. A drumless replacement needs `drums: { enabled: false, patterns: [] }`. Omission or `null` can preserve an old kit. This reset must happen in a deliberate application policy or complete supported fields; prose alone cannot clear omitted state.

For a **revision**, preserve the user's accepted motif, key, groove, and unaffected settings. Supply the model the current snapshot and change intent before expecting instructions such as “keep the bass, make the lead warmer” to work reliably. A reset is inappropriate for this mode.

### FX contract corrections

In [fxTrack.js](../lib/fxTrack.js), numeric delay/pingpong `delayTime` and reverb `preDelay` reach Tone in **seconds**, despite “ms” labels in the prompt metadata. Chorus `delayTime` really is milliseconds. Correct the metadata and cover the unit conversion when changing runtime instructions.

Reverb `decay` and `preDelay` affect `irType: synthetic`. Named impulse responses such as cave/cathedral are fixed recordings; their decay is not changed by those fields. `custom` needs a supplied buffer the composition plan cannot provide. Use `synthetic` when requesting an exact tail. `jcreverb` is implemented with `JCReverb`; avoid promising an authentic spring-reverb model based on its UI name.

Sidechain sources can be a route, `drums`, or a specific pad such as `drums:kick`. Choose `drums:kick` for kick-driven breathing and ensure that pad actually plays. Ducking from the entire drum pattern creates a different rhythm. Keep attack/release appropriate to tempo; audition the resulting recovery between hits.

## 6. Generation procedure

These are proposed stages for the composer pipeline, not claims about the present implementation.

1. **Interpret.** Identify new composition versus revision, primary genre, energy, groove, tonal colour, and explicit constraints. Choose a documented default for missing details.
2. **Allocate roles.** Select the bass/foreground/support relationship and a small lane budget. Keep one recognizable focal idea or, for ambient work, one recognizable textural relationship.
3. **Choose material and synthesis.** Match routes and actual instrument patches/sample presets to those roles. Choose attack character, spectral range, and tail behavior together. Use actual candidate-note previews when implemented; with current metadata, make conservative selections and avoid precise melodic claims.
4. **Build the foundation.** Establish drum anchors and low-end interaction. For drumless music, establish pacing through attacks, holds, and silence.
5. **Shape the foreground.** Adjust contour, range, density, and instrument-appropriate envelope. Check gate duration against attack and release; sampler attack/release do not behave like full synth ADSR. Preserve space around attacks. Add an answer only if it improves the focal idea.
6. **Add character.** Choose one or two purposeful effect treatments. Decide how the idea changes across several repeats without randomizing every lane.
7. **Translate and validate.** Emit only supported schema fields, valid city route IDs, valid presets, coherent effect sources, and explicit new-composition resets. Reject silently dropped essential instructions.
8. **Audition and repair.** Use the checks below. Fix the specific defect before adding another layer.
9. **Explain the invitation.** In the existing explanation field, describe the intended relationship and three useful controls to try. Do not claim listening verification if only the plan was checked.

For deployment, supply universal policy plus the selected recipe and the real capability contract. Do not append every genre chapter to every request. Both the website and MCP should use the same source of musical policy.

## 7. Decide whether it is worth developing

### Structural checks before playback

The plan must validate without losing musically essential fields. Check for an audible enabled role, valid routes/samples, intended drums, functioning sidechain sources, sensible register separation, and explicit inherited-state handling. Compute loop lengths, likely onset density, and chance/rest interactions where event data is available. A silent initial passage can be intentional, but a new sketch should communicate its identity promptly.

These checks can find broken plans. They cannot determine whether a melody is memorable or a groove feels good.

### Listening pass

Listen at a comfortable level through at least four meaningful repetitions and long enough for effect tails and rest cycles to develop, usually 30–60 seconds; use longer for slow ambient pieces. Compare similar output loudness. Ask:

| Criterion | 0 | 1 | 2 |
| --- | --- | --- | --- |
| Identity | No recognizable idea | Interesting sound, vague phrase | Clear motif, groove, or textural relationship |
| Groove / pacing | Unintentional collisions or deadness | Mostly works | Compelling pulse or intentional spacious pacing |
| Tonal relationship | Distracting clashes or register jumps | Compatible but unfocused | Bass, foreground, and support reinforce intent |
| Clarity | Masking, harshness, or uncontrolled tails | A few balance problems | Roles are easy to hear at moderate level |
| Repetition | Fatiguing or randomly unstable | Tolerable | Repetition remains inviting and variation makes sense |
| Editability | Nothing suggests a useful move | One obvious tweak | Several edits develop the same identity |

**Proposed acceptance target:** at least 9/12, with no zero in identity, pacing, or clarity, and an affirmative answer to “Would I willingly keep this playing while changing one control?” This is a product testing rubric, not a scientific measure of musical quality. User preferences and intentional dissonance can override stylistic defaults.

Keep an audio defect gate separate: clipping, missing samples, runaway feedback, accidental silence, or severely imbalanced output fail regardless of musical score. Peak measurements can help detect defects; a plan's fader values cannot guarantee headroom. Check bass focus in mono and on a small speaker when assessing a release candidate.

### Repair the cause

| Heard problem | First repair |
| --- | --- |
| Everything sounds like random notes | Reduce variety and pitch activity; isolate the best foreground figure |
| Every part fights for attention | Remove or soften a support lane; separate registers |
| Groove disappears | Restore reliable drum anchors; remove chance from structural material |
| Bass is muddy | Simplify its rhythm, shorten excessive tails, reduce spatial sends |
| Short crop sounds frantic | Calculate the new loop duration; slow it down or lengthen it |
| Ambient sounds empty | Add one quiet identifiable event, not necessarily drums |
| Repetition becomes tiring | Alter one ending, texture, or supporting appearance |
| Genre is only recognizable from tempo | Revisit beat accents, sound roles, and articulation |
| New ambient request still has drums | Fix explicit replacement/reset handling |
| Patch is inaudible despite sensible volume | Check sample loading, attack versus gate, and whether the filter removed the fundamental |
| Changing an envelope does little | Check the instrument's actual envelope adapter; sampler and legacy types differ |
| A “warmer” patch loses the hook | Restore the transient or a little upper-mid definition before raising volume |

## 8. Make the user want to play with it

The explanation should make a musical promise the plan can actually support. Name the focal role and suggest three bounded actions with an audible purpose. Avoid “adjust parameters to taste.”

Example for a deep-house-inspired sketch:

> A warm keys figure sits above a restrained bass line and steady house drums. Try opening the keys filter for brightness, raising their delay send slightly for a more audible echo response, or slowing the upper lane for more space.

Example for a drumless ambient sketch:

> A sparse bright detail floats over a softer sustained layer. Try lowering the support volume to bring the detail forward, shortening its release for more silence, or changing the upper contour to explore a different shape.

The offered controls must exist in the generated plan/UI. A future interface could expose three meaningful actions—“more space,” “more movement,” “darker”—with preview and undo. Their mappings should preserve the established motif and groove. Until that interface exists, use concrete controls in the explanation.

## 9. Implementation order and evidence of improvement

| Priority | Change | Evidence to require |
| --- | --- | --- |
| 1 | Correct loop-window, FX-unit, fixed-IR, and inherited-state guidance | Contract tests for affected semantics; listen to representative recipes |
| 2 | Add shared role policy and a selected genre recipe to website and MCP | Valid outputs plus blind preference over the old prompt |
| 2a | Add instrument-aware sound recipes and correct misleading envelope/control assumptions | Audible contrast on the same route; no unsupported parameter promises |
| 3 | Distinguish new composition from edits; supply current snapshot | “Keep bass, change lead” preserves the bass and unrelated settings |
| 4 | Expose route note previews and measure duration/density | Chosen routes actually match requested register and activity |
| 5 | Add explicit motif/chord and rhythm controls, then swing and sections | Audible examples demonstrating each requested capability |
| 5a | Expose a bounded set of synthesis parameters already supported by the underlying instruments | Useful FM, filter, and sample transformations survive saving/reloading and work in playback |
| 6 | Add audio preview/measurement and bounded repair | Fewer silent, clipped, crowded, or misleading outputs |

For the first comparison, use 12 briefs covering house, deep house, techno, dub, melodic techno, lo-fi, ambient, synthwave, garage, D&B, trance, and one hybrid. Generate three candidates per brief with each prompt version: 72 clips total. Keep the model, city, available routes, and generation settings matched; log variability rather than cherry-picking the best take. Randomize order, conceal prompt version, and have at least two listeners score the rubric and choose which clip they would continue editing. Listen at matched levels.

Separately test dense versus sparse routes, different cities, new blank sessions, replacement over an effects-heavy song, and revisions that preserve a chosen part. Measure unsupported/dropped fields, accidental inherited-state problems, listenability scores, and willingness to edit. No target uplift is claimed before that test is run.

Existing pure-logic tests can protect schema/application behavior. Runtime changes in the app or audio engine also require `npm run build` under repository guidance. Actual musical improvement requires playback evaluation; neither a passing build nor valid JSON establishes it.

## Research notes

All external references are linked next to the claims they support and were consulted on the research date. The genre recipes deliberately focus on styles compatible with Leið's loop-based identity. They are not a complete genre taxonomy, historical account, or guarantee of authenticity. Future requests for jazz, funk, orchestral music, non-Western traditions, or more specific electronic subgenres need their own musical research and a capability assessment.

The strongest immediate opportunity is to give the existing controls coherent musical intent and repair misleading guidance. Exact melodic composition and arrangement require additional representational control. Both deserve separate evaluation.
