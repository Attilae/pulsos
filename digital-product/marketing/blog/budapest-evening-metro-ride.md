---
title: "How Budapest Becomes a Synth Patch in Leið"
slug: "budapest-generative-music-evening-metro-ride"
description: "Inside a Budapest preset in Leið: route-driven synths, granular processing, resonator voices and deliberate silences turn transit data into an arrangement."
excerpt: "A breakdown of ‘a little evening metro ride 2’, where Budapest’s tram, trolleybus and bus routes become instruments, modulation sources and musical phrases."
tags:
  - Leið
  - Generative music
  - Sound design
  - Budapest
  - Preset breakdown
---

# How Budapest Becomes a Synth Patch in Leið

A tram route can supply a bass phrase. A trolleybus line can become a granular lead. Another route can move a synthesizer’s tone without making a sound of its own.

The Leið preset **“a little evening metro ride 2”** brings those possibilities together in a Budapest arrangement at **134 BPM**, with **G-sharp major** selected throughout its active musical lanes. Five route-based voices share the work: two Macro instruments, a processed synth lead, a resonator and a noise part. A drum pattern gives them a common pulse, while two additional routes control the timbre of one instrument.

It is a useful patch to take apart because its structure extends beyond the notes. Playback speed, arpeggiators, granular processing and periods of silence all contribute to the arrangement.

## The city supplies the material

In Leið, a transit line becomes a musical lane and its stops provide the sequence of note events. This preset uses the **Demand** pitch contour, which maps the route’s stop-demand signal into a melodic shape. That signal is derived from transit data; it is not a live count of passengers boarding a vehicle.

The session runs in **Mock mode**, using simulated playback over Budapest route data. Its relationship to the city comes from that underlying network and the way the patch transforms it.

Although the preset’s name evokes a metro journey, the enabled musical voices here come from tram, trolleybus and bus routes. The metro lanes remain disabled.

A useful way to read the arrangement is by musical role:

| Source | Instrument or destination | Role in the patch |
| --- | --- | --- |
| Tram 41 | Macro, Virtual analog | Continuous arpeggiated upper voice |
| Tram 56 | Macro, Virtual analog | Low-register foundation |
| Trolleybus 80 | Synth through Texture Mk II | Lead with alternating play and rest loops |
| Trolleybus 73 | Resonator, Modal | Slower, occasional ringing phrases |
| Bus 25 | NoiseSynth | Intermittent noise percussion |
| Trolleybus 72 | Tram 41’s Morph parameter | Route-shaped timbral movement |
| Tram 37 | Tram 41’s Out / Aux parameter | Movement between the Macro outputs |
| Drum lane | Step pattern | Shared rhythmic pulse and sidechain source |

The division gives each route a job. Some provide pitch, some provide rhythm, and others change how another route sounds.

## Tram 41: an arpeggio with a moving identity

Tram 41 uses **Macro’s Virtual analog model**, described in the instrument as two detuned classic waveforms. The lane runs at normal speed on a sixteenth-note grid, with a **random arpeggiator at a sixteenth-note rate**. The arpeggiator has three steps, a distance setting of two and a 110% gate.

Those settings create a busy upper part, but the most distinctive routing sits beneath the instrument: two other transit lines control its tone.

**Trolleybus 72 modulates Morph**, with 230 ms of smoothing. **Tram 37 modulates Out / Aux**, with no smoothing. The first route supplies a softened control curve; the second changes the balance between the instrument’s outputs more directly.

This gives the city influence over both the musical sequence and the sound that plays it. A repeating phrase can take on a different character as its modulation sources move through their own stops.

The lane’s EQ includes a high-pass at **206 Hz**, separating this upper part from the bass below. Its sends are modest: **5% reverb, 21% delay, 11% chorus and 21% distortion**.

There is also a kick sidechain, set to **9 dB of ducking**, with an immediate attack and a **220 ms release**. Each kick trigger can pull the upper voice back, making room for the rhythmic pulse.

## Tram 56: the same model, a different register

Tram 56 also uses Macro’s Virtual analog model, but its **octave setting is four octaves down**. The visible note rail sits around the second octave, placing it far below tram 41.

Its synthesis settings differ too: **37% detune, 74% timbre and 84% morph**, with two voices. An **Analog low-pass filter** is set to **5.32 kHz**, with **18% resonance**, **2.05 drive** and a **24 dB slope**.

The rhythm remains active. A **diverging sixteenth-note arpeggiator** uses three steps, a distance of one and a **70% gate**. Shorter gates give this part a more separated articulation than the overlapping setting on tram 41.

The effects routing also separates their roles. Tram 56 sends **nothing to reverb**, while feeding **13% delay, 34% chorus and 39% distortion**. The low part can gain movement and colour without being placed in the same reverberant space as the occasional voices above it.

The contrast comes from a small set of decisions: register, articulation, filtering and sends. Both lanes start from the same synthesis model, yet they occupy different parts of the arrangement.

## Trolleybus 80: a lead that leaves room

Route 80 is explicitly labelled **Lead**. Its source is a Synth with a **fat-triangle oscillator**, **410 ms glide** and **legato enabled**. It runs at **half speed** and plays one loop before resting for one loop.

That rest is part of the composition. It creates recurring space around a voice whose processing can already produce a substantial tail.

The lane feeds **Texture Mk II** in **Clean tape** quality, using **Gates** mode. The granular settings include:

- **Size: 78%**, with Time and Shape at 100%.
- **Grain pitch: +12 semitones**.
- **Drift randomization** on Time, Size and Shape.
- **Density: random, 79%**.
- **Feedback: 76%**.
- **Dry/wet: 70%**.

The wet granular signal is shifted an octave up, while feedback recirculates material and the drifting controls keep the texture moving. The synth’s glide and the granular processing provide two different kinds of movement within the same voice.

This lane sends **37% to reverb and 26% to delay**, with no chorus or distortion send. Its processing gives it a different identity from the two Macro parts, while the play/rest pattern controls how often that identity enters the mix.

## Trolleybus 73 and bus 25: occasional detail

Two more lanes add contrast without playing continuously.

**Trolleybus 73** uses the **Modal Resonator**, with three voices, Strike enabled and Bow at **40%**. Its envelope has a **1.5-second release**, allowing notes to ring beyond their initial excitation.

The lane runs at **quarter speed** with an upward sixteenth-note arpeggiator. It plays **one loop, then rests for two**, and sits at **−3 dB**. Its sends are comparatively spacious: **46% reverb and 65% delay**. A kick sidechain ducks it by 9 dB with a 180 ms release.

**Bus 25** takes a percussive role through **white NoiseSynth**. Its envelope has a **5 ms attack, 328 ms decay, zero sustain and 100 ms release**. A **598 Hz high-pass with a 24 dB slope** removes low-frequency energy, leaving space for the kick and bass.

This lane also plays one loop and rests for two, at **−4 dB**, with **52% chorus and 50% distortion sends**. Although its rail displays mapped note names, the instrument generates noise; those names should not be read as a conventional pitched melody.

Together, these lanes introduce occasional ringing and noisy events around the more continuous parts.

## A steady pulse underneath changing phrases

The drum lane sits at **−2 dB**. Its visible 16-step window contains evenly spaced kick hits, a sparse snare and late hi-hat activity. Rim, ride and clap are muted.

That restrained pattern provides a reference for the busier arpeggios and slower phrases. The kick also has a second function through its sidechain connections to tram 41 and trolleybus 73.

Across the five musical lanes, note chance is set to **100%** and pitch Variation to **0%**. Much of the variation therefore comes from specific places: the random arpeggiator, granular drift, route-driven modulation, differing speeds and play/rest cycles.

These are separate decisions that can be adjusted independently. The patch can retain a dependable pulse while changing its surface and density.

## Shared effects bring the parts together

Four shared effect buses serve the arrangement: **Reverb, Delay, Chorus and Distortion**. Their returns are at 100%, with each lane’s send determining its contribution.

The reverb uses the **Warehouse** impulse-response selection. The delay is synchronized to **eighth notes**, with **0.40 feedback**. Chorus runs freely at **1 Hz**, with a 4.5 ms delay, 0.50 depth and 180-degree spread. Distortion is set to **0.40 drive** with **4× oversampling**.

The send choices matter as much as the bus settings. The bass avoids reverb, the resonator feeds substantial delay, and the granular lead avoids the chorus and distortion buses. Each voice shares some processing with the ensemble while retaining its own balance.

The enabled master chain then runs through **EQ, Glue, Warmth and Limiter**. It uses a **25 Hz low cut**, **−1 dB low-mid adjustment**, **+1 dB air**, **31% warmth**, a **−24 dB compressor threshold**, a **2:1 ratio**, **+1 dB drive** and a **−1 dB ceiling**.

## Take the method into your own patch

The most transferable idea here is the assignment of musical roles. A route provides a starting sequence, then sound design determines what that sequence contributes.

To explore a similar approach, start with one low voice and one upper voice. Separate their register and articulation. Let another route control a timbre parameter. Add a slower voice that rests between phrases, then introduce processing where it serves that voice’s role.

Keep returning to the relationship between the parts: which one anchors the piece, which one moves, and which one needs room to disappear and return?

[Open Leið and start with Budapest](https://layth.space/). Choose a route, give it a musical job, and build the arrangement around it.
