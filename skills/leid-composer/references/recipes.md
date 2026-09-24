# Leið recipes

These are starting points, not templates to copy blindly. Every example uses placeholder route ids
such as `"<metro-1>"`. Replace each one with a real `id` from `list_routes` for the user's city, and
pick a line whose `stopCount` suits the role. If the city has no lines of a type (Zürich has no
metro, Warsaw has no trolley), use the nearest role: a low-stop tram or bus line for melody, or
`hev` for bass.

Before saving, check every value against `get_composer_guide`. It is authoritative, and anything it
doesn't list gets dropped. Its **sound recipes** (R1–R13) name the instrument, envelope, `tone` and
filter for each role. The examples below are built from them. Nobody has auditioned these examples in
the user's city, so describe them as starting points and never claim to have heard them.

Every example uses the six instruments the DAW's picker offers (Synth, FMSynth, NoiseSynth,
PolySynth, Sampler, Drums), so the user can keep editing each lane. Every envelope also fits the
one-beat note gate, so none of them trigger a preview advisory.

## Contents
- [Warm house beat](#warm-house-beat): square-wave bass, piano, a quiet xylophone answer, kick-ducked
- [Hypnotic transit beat](#hypnotic-transit-beat): struck-FM cell, dry bass, noise ticks, distortion
- [Dub](#dub): legato bass, delayed organ stabs, a pad that answers every other pass
- [Ambient drift](#ambient-drift): no drums, FM bells, slow pads, grain shadow
- [Minimal techno](#minimal-techno): driving four-on-the-floor, one filtered saw sequence
- [Lo-fi keys](#lo-fi-keys): mellow piano, soft hats, warm filter
- [Cinematic swell](#cinematic-swell): orchestral samplers, arch contours

## Warm house beat

- **Tempo and key:** 120–125 BPM, dorian or minor.
- **Sound design:**
  - R1 bass: a Synth with a square wave, `sustain 0` and a short decay, so each note is a pulse that
    ends before the next kick.
  - R5 piano keys: attack and release are the only envelope values that matter on a Sampler.
  - A quiet R8 xylophone answer on a rest pattern. Leave it out if it crowds the keys.
- **Groove:** a quarter-note kick, the clap on 2 and 4, and offbeat hats quieter than the kick. The
  bass ducks off `drums:kick`.
- **FX:**
  - A synced dotted-8th delay on the keys and the answer, never on the bass.
  - A roughly 1 s synthetic reverb behind the keys.
  - Keep wet at 1 and set the amount with low sends.

```json
{
  "summary": "Warm dorian house: a square-wave bass pulses between the kicks under a piano figure, with a quiet xylophone answering every other pass. Try shortening the bass decay for more bounce, opening the piano filter for brightness, or raising the answer's delay send.",
  "bpm": 122,
  "harmony": { "root": "A", "scaleType": "dorian" },
  "masterVolume": -4,
  "tracks": [
    {
      "routeId": "<metro-1>",
      "synthType": "Synth",
      "volume": -9,
      "pan": 0,
      "octave": -1,
      "envelope": { "attack": 0.008, "decay": 0.12, "sustain": 0, "release": 0.08 },
      "tone": { "oscillator": "square" },
      "filter": { "type": "lowpass", "frequency": 900, "Q": 0.7 },
      "speed": 1,
      "gridResolution": "8n",
      "pitchVariety": { "contour": "randomWalk", "variety": 0.1 },
      "label": "Bass",
      "sidechain": { "enabled": true, "source": "drums:kick", "amountDb": -9, "attack": 0.005, "release": 0.15 }
    },
    {
      "routeId": "<metro-2>",
      "synthType": "Sampler",
      "samplerPreset": "piano",
      "volume": -8,
      "pan": -0.2,
      "octave": 0,
      "envelope": { "attack": 0.01, "decay": 0.1, "sustain": 1, "release": 0.3 },
      "filter": { "type": "lowpass", "frequency": 3500, "Q": 0.7 },
      "speed": 0.5,
      "gridResolution": "8n",
      "pitchVariety": { "contour": "randomWalk", "variety": 0.15 },
      "label": "Lead"
    },
    {
      "routeId": "<tram-1>",
      "synthType": "Sampler",
      "samplerPreset": "xylophone",
      "volume": -18,
      "pan": 0.35,
      "octave": 1,
      "envelope": { "attack": 0.005, "decay": 0.1, "sustain": 1, "release": 0.25 },
      "filter": { "type": "lowpass", "frequency": 8000, "Q": 0.7 },
      "speed": 0.5,
      "gridResolution": "4n",
      "loopPattern": { "play": 1, "rest": 1, "offset": 1 },
      "pitchVariety": { "contour": "arch", "variety": 0.1 },
      "label": "Texture"
    }
  ],
  "drums": {
    "enabled": true,
    "volume": -7,
    "filter": { "type": "lowpass", "frequency": 14000, "Q": 0.7 },
    "patterns": [
      { "padId": "kick", "steps": [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0] },
      { "padId": "clap", "steps": [0,0,0,0, 0.7,0,0,0, 0,0,0,0, 0.7,0,0,0] },
      { "padId": "hat",  "steps": [0,0,0.7,0, 0,0,0.7,0, 0,0,0.7,0, 0,0,0.7,0.4] }
    ]
  },
  "fx": [
    {
      "busId": "delay",
      "wet": 1,
      "params": [ { "paramId": "sync", "value": "8n." }, { "paramId": "feedback", "value": 0.3 } ],
      "sends": [ { "routeId": "<metro-2>", "level": 0.14 }, { "routeId": "<tram-1>", "level": 0.2 } ]
    },
    {
      "busId": "reverb",
      "wet": 1,
      "params": [ { "paramId": "irType", "value": "synthetic" }, { "paramId": "decay", "value": 1.1 }, { "paramId": "preDelay", "value": 0.015 } ],
      "sends": [ { "routeId": "<metro-2>", "level": 0.14 }, { "routeId": "<tram-1>", "level": 0.18 }, { "routeId": "drums", "level": 0.04 } ]
    }
  ]
}
```

## Hypnotic transit beat

- **Tempo and key:** 128–134 BPM, phrygian or minor.
- **Sound design:**
  - The cell is R12, an FM struck key. `tone.modEnvelope` decays faster than the carrier, which gives
    a bright attack with a clean tail. Without it, FMSynth's default 0.5 s modulator attack makes the
    brightness bloom late.
  - R1 bass, dry and low.
  - An R9 NoiseSynth tick through a highpass, only as quiet texture.
- **Groove:** firm kick, offbeat hats with quieter 16ths, a sparse clap. The cell loops only the first half of its
  line, so it repeats twice as often and sounds more insistent. Every lane still starts together.
- **FX:**
  - A little distortion on the cell.
  - A synced 8th delay on the cell.
  - The third bus stays free.

```json
{
  "summary": "Hypnotic phrygian techno: a struck FM cell repeats over a dry square bass and firm kick, with noise ticks drifting in and out. Try raising the cell's distortion send, lowering its modulationIndex for a softer bite, or moving its filter.",
  "bpm": 132,
  "harmony": { "root": "E", "scaleType": "phrygian" },
  "masterVolume": -4,
  "tracks": [
    {
      "routeId": "<tram-1>",
      "synthType": "FMSynth",
      "volume": -9,
      "pan": 0.1,
      "octave": 0,
      "envelope": { "attack": 0.005, "decay": 0.2, "sustain": 0, "release": 0.1 },
      "tone": { "harmonicity": 2, "modulationIndex": 3, "modEnvelope": { "attack": 0.001, "decay": 0.12, "sustain": 0, "release": 0.08 } },
      "filter": { "type": "lowpass", "frequency": 5000, "Q": 1 },
      "speed": 1,
      "loopRegion": { "startCell": 0, "endCell": 32 },
      "gridResolution": "16n",
      "pitchVariety": { "contour": "randomWalk", "variety": 0.1 },
      "label": "Lead"
    },
    {
      "routeId": "<metro-1>",
      "synthType": "Synth",
      "volume": -8,
      "pan": 0,
      "octave": -1,
      "envelope": { "attack": 0.005, "decay": 0.1, "sustain": 0, "release": 0.06 },
      "tone": { "oscillator": "square" },
      "filter": { "type": "lowpass", "frequency": 500, "Q": 0.8 },
      "speed": 1,
      "gridResolution": "8n",
      "pitchVariety": { "contour": "randomWalk", "variety": 0 },
      "label": "Bass",
      "sidechain": { "enabled": true, "source": "drums:kick", "amountDb": -14, "attack": 0.003, "release": 0.14 }
    },
    {
      "routeId": "<tram-2>",
      "synthType": "NoiseSynth",
      "volume": -24,
      "pan": -0.45,
      "envelope": { "attack": 0.003, "decay": 0.04, "sustain": 0, "release": 0.025 },
      "filter": { "type": "highpass", "frequency": 5000, "Q": 0.7 },
      "speed": 1,
      "gridResolution": "16n",
      "noteChance": 0.6,
      "loopPattern": { "play": 1, "rest": 1, "offset": 1 },
      "label": "Perc"
    }
  ],
  "drums": {
    "enabled": true,
    "volume": -6,
    "patterns": [
      { "padId": "kick", "steps": [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0] },
      { "padId": "hat",  "steps": [0,0,0.7,0.4, 0,0,0.7,0, 0,0,0.7,0.4, 0,0,0.7,0] },
      { "padId": "clap", "steps": [0,0,0,0, 0.7,0,0,0, 0,0,0,0, 0.7,0,0,0] }
    ]
  },
  "fx": [
    {
      "busId": "distortion",
      "wet": 1,
      "params": [ { "paramId": "distortion", "value": 0.35 }, { "paramId": "oversample", "value": "2x" } ],
      "sends": [ { "routeId": "<tram-1>", "level": 0.18 } ]
    },
    {
      "busId": "delay",
      "wet": 1,
      "params": [ { "paramId": "sync", "value": "8n" }, { "paramId": "feedback", "value": 0.3 } ],
      "sends": [ { "routeId": "<tram-1>", "level": 0.14 } ]
    }
  ]
}
```

## Dub

- **Tempo and key:** 70–90 BPM (or 140 read at half time), minor or dorian.
- **Roles:**
  - A metro line with few stops (≈10–16) plays the bass: a triangle Synth at octave -2 with legato
    and a little glide, ducked by the kick. Legato suits a mono synth. On a Sampler or PolySynth it
    stacks voices instead.
  - A tram line plays the organ stab on an 8n grid with chance ~0.6. It is one note per stop, not a
    chord.
  - A bus line plays a soft PolySynth pad on a `loopPattern` that rests first and then alternates, so
    it comes in on the second pass. A later `loopRegion` would *not* delay it: every lane starts
    together, and a window only chooses which part of the line loops.
- **Drums:** kick on 1 and 3, rim or snare on 3. Hats stay sparse.
- **FX:** a dotted-8th delay with high feedback on the stab is the audible answer, with a small
  `jcreverb` room behind it. Keep the bass dry.

```json
{
  "summary": "Deep minor dub: a kick-ducked legato bass, delayed organ stabs and a soft pad that answers every other pass. Try raising the stab's delay send, darkening the pad, or shortening the bass release.",
  "bpm": 76,
  "harmony": { "root": "G", "scaleType": "minor" },
  "masterVolume": -4,
  "tracks": [
    {
      "routeId": "<metro-1>",
      "synthType": "Synth",
      "volume": -6,
      "pan": 0,
      "octave": -2,
      "glide": 0.08,
      "legato": true,
      "envelope": { "attack": 0.01, "decay": 0.3, "sustain": 0.6, "release": 0.3 },
      "tone": { "oscillator": "triangle" },
      "filter": { "type": "lowpass", "frequency": 600, "Q": 1.5 },
      "speed": 0.5,
      "gridResolution": "8n",
      "pitchVariety": { "contour": "randomWalk", "variety": 0.1 },
      "label": "Bass",
      "sidechain": { "enabled": true, "source": "drums:kick", "amountDb": -12, "attack": 0.005, "release": 0.25 }
    },
    {
      "routeId": "<tram-1>",
      "synthType": "Sampler",
      "samplerPreset": "organ",
      "volume": -12,
      "pan": 0.35,
      "octave": 0,
      "envelope": { "attack": 0.005, "decay": 0.1, "sustain": 1, "release": 0.2 },
      "filter": { "type": "lowpass", "frequency": 2500, "Q": 0.7 },
      "speed": 1,
      "gridResolution": "8n",
      "noteChance": 0.6,
      "pitchVariety": { "contour": "demand", "variety": 0 },
      "label": "Chords"
    },
    {
      "routeId": "<bus-1>",
      "synthType": "PolySynth",
      "volume": -20,
      "pan": -0.3,
      "envelope": { "attack": 0.08, "decay": 0.4, "sustain": 0.5, "release": 1.5 },
      "tone": { "oscillator": "triangle" },
      "filter": { "type": "lowpass", "frequency": 1800, "Q": 0.7 },
      "speed": 0.25,
      "gridResolution": "4n",
      "loopPattern": { "play": 1, "rest": 1, "offset": 1 },
      "pitchVariety": { "contour": "arch", "variety": 0.1 },
      "label": "Pad"
    }
  ],
  "drums": {
    "enabled": true,
    "volume": -8,
    "patterns": [
      { "padId": "kick", "steps": [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0] },
      { "padId": "rim",  "steps": [0,0,0,0, 0,0,0,0, 0.7,0,0,0, 0,0,0,0] },
      { "padId": "hat",  "steps": [0,0,0.4,0, 0,0,0.4,0, 0,0,0.4,0, 0,0,0.4,0] }
    ]
  },
  "fx": [
    {
      "busId": "delay",
      "wet": 1,
      "params": [ { "paramId": "sync", "value": "8n." }, { "paramId": "feedback", "value": 0.6 } ],
      "sends": [ { "routeId": "<tram-1>", "level": 0.28 }, { "routeId": "drums", "level": 0.08 } ]
    },
    {
      "busId": "jcreverb",
      "wet": 1,
      "params": [ { "paramId": "roomSize", "value": 0.7 } ],
      "sends": [ { "routeId": "<bus-1>", "level": 0.16 }, { "routeId": "<tram-1>", "level": 0.08 } ]
    }
  ]
}
```

## Ambient drift

- **Tempo and key:** 60–80 BPM, lydian, major or pentatonic.
- **Density:** the whole point. Every melodic lane plays ≤ 0.5 notes per beat and pads ≤ 0.25, so
  use speed 0.25–0.5, a 4n grid and lines with few stops. Use no drums.
- **Roles:**
  - An FM bell lead on a sparse metro line at octave +1, with noteChance ~0.7. Its `tone.modEnvelope`
    makes the bell strike rather than bloom.
  - Two bus-line pads with different speeds and loop windows, so they drift. The windows change
    *which* material each pad loops and how long its cycle is; both still start together. The second
    pad rests every other pass.
  - A quiet grain shadow on the synth pad (R11): mix around 0.08, no jitter.
- **Envelopes:** a slow attack longer than one beat (0.91 s at 66 BPM) never peaks, so the pads take
  their softness from a moderate attack, a long release and the reverb.
- **FX:** a long `synthetic` reverb does most of the work, plus a slow ping-pong delay. Only
  `synthetic` follows `decay`; the named rooms are fixed recordings.

```json
{
  "summary": "Slow lydian drift: struck FM bells over two soft pads that never quite line up, with a faint grain shadow. Try lowering the harmonium, shortening the bell release, or raising the pad's grain mix a touch.",
  "bpm": 66,
  "harmony": { "root": "D", "scaleType": "lydian" },
  "masterVolume": -5,
  "tracks": [
    {
      "routeId": "<metro-1>",
      "synthType": "FMSynth",
      "volume": -10,
      "pan": 0.2,
      "octave": 1,
      "envelope": { "attack": 0.01, "decay": 0.6, "sustain": 0.2, "release": 3 },
      "tone": { "harmonicity": 2, "modulationIndex": 3, "modEnvelope": { "attack": 0.001, "decay": 0.4, "sustain": 0, "release": 0.3 } },
      "speed": 0.5,
      "gridResolution": "4n",
      "noteChance": 0.7,
      "pitchVariety": { "contour": "demand", "variety": 0.2 },
      "label": "Lead"
    },
    {
      "routeId": "<bus-1>",
      "synthType": "PolySynth",
      "volume": -18,
      "pan": -0.4,
      "octave": 0,
      "envelope": { "attack": 0.3, "decay": 0.6, "sustain": 0.6, "release": 2.5 },
      "tone": { "oscillator": "triangle" },
      "filter": { "type": "lowpass", "frequency": 2200, "Q": 0.7 },
      "speed": 0.25,
      "gridResolution": "4n",
      "pitchVariety": { "contour": "arch", "variety": 0.1 },
      "granular": { "enabled": true, "mix": 0.08, "grainSize": 0.1, "overlap": 0.05, "playbackRate": 0.5, "loopStart": 0.1, "loopEnd": 0.55, "jitter": 0, "reverse": false, "attack": 0.1, "release": 1.5 },
      "label": "Pad"
    },
    {
      "routeId": "<bus-2>",
      "synthType": "Sampler",
      "samplerPreset": "harmonium",
      "volume": -20,
      "pan": 0.45,
      "octave": -1,
      "envelope": { "attack": 0.3, "decay": 0.1, "sustain": 1, "release": 3 },
      "speed": 0.25,
      "gridResolution": "4n",
      "loopRegion": { "startCell": 16, "endCell": 48 },
      "loopPattern": { "play": 1, "rest": 1, "offset": 0 },
      "pitchVariety": { "contour": "arch", "variety": 0 },
      "label": "Texture"
    }
  ],
  "fx": [
    {
      "busId": "reverb",
      "wet": 1,
      "params": [ { "paramId": "irType", "value": "synthetic" }, { "paramId": "decay", "value": 6 } ],
      "sends": [ { "routeId": "<metro-1>", "level": 0.42 }, { "routeId": "<bus-1>", "level": 0.35 }, { "routeId": "<bus-2>", "level": 0.35 } ]
    },
    {
      "busId": "pingpong",
      "wet": 1,
      "params": [ { "paramId": "sync", "value": "4n." }, { "paramId": "feedback", "value": 0.5 } ],
      "sends": [ { "routeId": "<metro-1>", "level": 0.12 } ]
    }
  ]
}
```

## Minimal techno

- **Tempo and key:** 122–130 BPM, minor or phrygian.
- **Roles:**
  - A four-on-the-floor kick with an offbeat hat and a clap on 2 and 4.
  - One tram line carries the rhythm: a 16n grid and a short sawtooth Synth (R3) with `sustain 0`,
    through a moderately resonant filter.
  - A metro bass (R1), ducked hard by the kick.
  - A quiet highpassed NoiseSynth tick on a `loopPattern`, so it comes and goes.
- **FX:** an autofilter for movement and a short delay.

```json
{
  "summary": "Hypnotic phrygian techno: a pumping bass, a filtered saw sequence and noise ticks that come and go. Try moving the sequence filter, raising its autofilter send, or thinning the ticks.",
  "bpm": 126,
  "harmony": { "root": "E", "scaleType": "phrygian" },
  "masterVolume": -4,
  "tracks": [
    {
      "routeId": "<tram-1>",
      "synthType": "Synth",
      "volume": -10,
      "pan": 0.1,
      "octave": 0,
      "envelope": { "attack": 0.003, "decay": 0.15, "sustain": 0, "release": 0.1 },
      "tone": { "oscillator": "sawtooth" },
      "filter": { "type": "lowpass", "frequency": 1800, "Q": 3 },
      "speed": 1,
      "gridResolution": "16n",
      "pitchVariety": { "contour": "randomWalk", "variety": 0.15 },
      "label": "Arp"
    },
    {
      "routeId": "<metro-1>",
      "synthType": "Synth",
      "volume": -7,
      "pan": 0,
      "octave": -1,
      "envelope": { "attack": 0.005, "decay": 0.14, "sustain": 0, "release": 0.08 },
      "tone": { "oscillator": "square" },
      "filter": { "type": "lowpass", "frequency": 450, "Q": 1 },
      "speed": 0.5,
      "gridResolution": "8n",
      "pitchVariety": { "contour": "randomWalk", "variety": 0 },
      "label": "Bass",
      "sidechain": { "enabled": true, "source": "drums:kick", "amountDb": -18, "attack": 0.003, "release": 0.18 }
    },
    {
      "routeId": "<tram-2>",
      "synthType": "NoiseSynth",
      "volume": -24,
      "pan": -0.5,
      "envelope": { "attack": 0.003, "decay": 0.04, "sustain": 0, "release": 0.025 },
      "filter": { "type": "highpass", "frequency": 4000, "Q": 0.7 },
      "speed": 0.5,
      "gridResolution": "8n",
      "noteChance": 0.5,
      "loopPattern": { "play": 1, "rest": 1, "offset": 1 },
      "label": "Perc"
    }
  ],
  "drums": {
    "enabled": true,
    "volume": -6,
    "patterns": [
      { "padId": "kick", "steps": [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0] },
      { "padId": "hat",  "steps": [0,0,0.7,0, 0,0,0.7,0, 0,0,0.7,0, 0,0,0.7,0.4] },
      { "padId": "clap", "steps": [0,0,0,0, 0.7,0,0,0, 0,0,0,0, 0.7,0,0,0] }
    ]
  },
  "fx": [
    {
      "busId": "autofilter",
      "wet": 1,
      "params": [ { "paramId": "sync", "value": "1n" }, { "paramId": "baseFrequency", "value": 300 }, { "paramId": "octaves", "value": 4 } ],
      "sends": [ { "routeId": "<tram-1>", "level": 0.36 } ]
    },
    {
      "busId": "delay",
      "wet": 1,
      "params": [ { "paramId": "sync", "value": "8t" }, { "paramId": "feedback", "value": 0.35 } ],
      "sends": [ { "routeId": "<tram-2>", "level": 0.12 } ]
    }
  ]
}
```

## Lo-fi keys

- **Tempo and key:** 70–88 BPM, dorian, minor or major pentatonic.
- **Roles:**
  - A piano sampler on a mid-density metro line, with a lowpass around 3 kHz. On a Sampler only
    attack and release shape the sound; the recording supplies the rest.
  - A contrabass or bass-electric sampler plays the bass.
  - A tram line with a one-shot hat at noteChance ~0.5 loosens the top end. Chance is not swing: the
    grid stays straight.
- **Drums:** a lazy kick and snare, with soft (0.4) ghost notes.
- **FX:** a gentle chorus plus a short `synthetic` reverb, and a light bitcrusher on the drums.

```json
{
  "summary": "Dusty dorian lo-fi: a filtered piano over an upright bass and a lazy beat. Try a slightly brighter piano filter, the chorus send, or lower melodic variety.",
  "bpm": 78,
  "harmony": { "root": "A", "scaleType": "dorian" },
  "masterVolume": -4,
  "tracks": [
    {
      "routeId": "<metro-1>",
      "synthType": "Sampler",
      "samplerPreset": "piano",
      "volume": -7,
      "pan": -0.15,
      "octave": 0,
      "envelope": { "attack": 0.02, "decay": 0.1, "sustain": 1, "release": 0.8 },
      "filter": { "type": "lowpass", "frequency": 3000, "Q": 0.8 },
      "speed": 0.5,
      "gridResolution": "8n",
      "pitchVariety": { "contour": "randomWalk", "variety": 0.2 },
      "label": "Lead"
    },
    {
      "routeId": "<hev-1>",
      "synthType": "Sampler",
      "samplerPreset": "contrabass",
      "volume": -9,
      "pan": 0,
      "octave": -1,
      "envelope": { "attack": 0.005, "decay": 0.1, "sustain": 1, "release": 0.15 },
      "speed": 0.5,
      "gridResolution": "4n",
      "pitchVariety": { "contour": "randomWalk", "variety": 0 },
      "label": "Bass",
      "sidechain": { "enabled": true, "source": "drums:kick", "amountDb": -6, "attack": 0.01, "release": 0.3 }
    },
    {
      "routeId": "<tram-1>",
      "synthType": "Drums",
      "drumVoice": "hihat",
      "volume": -18,
      "pan": 0.4,
      "speed": 1,
      "gridResolution": "8t",
      "noteChance": 0.5,
      "label": "Perc"
    }
  ],
  "drums": {
    "enabled": true,
    "volume": -9,
    "filter": { "type": "lowpass", "frequency": 7000, "Q": 0.7 },
    "patterns": [
      { "padId": "kick",  "steps": [1,0,0,0, 0,0,0,0.4, 0,0,1,0, 0,0,0,0] },
      { "padId": "snare", "steps": [0,0,0,0, 0.7,0,0,0, 0,0,0,0, 0.7,0,0,0.4] }
    ]
  },
  "fx": [
    {
      "busId": "chorus",
      "wet": 1,
      "params": [ { "paramId": "frequency", "value": 0.6 }, { "paramId": "depth", "value": 0.5 } ],
      "sends": [ { "routeId": "<metro-1>", "level": 0.2 } ]
    },
    {
      "busId": "reverb",
      "wet": 1,
      "params": [ { "paramId": "irType", "value": "synthetic" }, { "paramId": "decay", "value": 2 } ],
      "sends": [ { "routeId": "<metro-1>", "level": 0.16 }, { "routeId": "drums", "level": 0.07 } ]
    },
    {
      "busId": "bitcrusher",
      "wet": 1,
      "params": [ { "paramId": "bits", "value": 8 } ],
      "sends": [ { "routeId": "drums", "level": 0.1 } ]
    }
  ]
}
```

## Cinematic swell

- **Tempo and key:** 60–90 BPM, minor or major.
- **Roles:**
  - Cello or contrabass samplers on hev lines give the low foundation.
  - A violin, french-horn or flute sampler on a metro line uses the `arch` contour, so the phrase
    rises and falls.
  - A harp arp on a tram line adds shimmer.
  - Use toms instead of a kit, or no drums at all.
- **Levels:** strings swell through release and reverb, not through a long attack. A Sampler's attack
  softens its transient, and at 72 BPM a note is held for 0.83 s, so keep the attack well under that.
  The concert-hall IR is a fixed recording, so there is no `decay` to set on it.
- **Entrances:** the harp arp rests on the first pass (`loopPattern` offset). That is the only way to
  hold a lane back. A `loopRegion` never delays a lane.

```json
{
  "summary": "Minor-key swell: low cellos, an arching violin line and a harp arpeggio that enters on the second pass. Try lowering the cello, shortening the violin release, or slowing the harp arp.",
  "bpm": 72,
  "harmony": { "root": "C", "scaleType": "minor" },
  "masterVolume": -5,
  "tracks": [
    {
      "routeId": "<hev-1>",
      "synthType": "Sampler",
      "samplerPreset": "cello",
      "volume": -10,
      "pan": -0.2,
      "octave": -1,
      "envelope": { "attack": 0.3, "decay": 0.1, "sustain": 1, "release": 3 },
      "speed": 0.25,
      "gridResolution": "4n",
      "pitchVariety": { "contour": "arch", "variety": 0 },
      "label": "Bass"
    },
    {
      "routeId": "<metro-1>",
      "synthType": "Sampler",
      "samplerPreset": "violin",
      "volume": -8,
      "pan": 0.15,
      "octave": 0,
      "envelope": { "attack": 0.35, "decay": 0.1, "sustain": 1, "release": 3 },
      "speed": 0.5,
      "gridResolution": "4n",
      "pitchVariety": { "contour": "arch", "variety": 0.15 },
      "label": "Lead"
    },
    {
      "routeId": "<tram-1>",
      "synthType": "Sampler",
      "samplerPreset": "harp",
      "volume": -16,
      "pan": 0.45,
      "octave": 1,
      "speed": 0.25,
      "gridResolution": "4n",
      "arp": { "enabled": true, "style": "up", "rate": "8n", "gate": 0.6, "octaves": 1, "steps": 3, "distance": 2 },
      "loopPattern": { "play": 1, "rest": 1, "offset": 1 },
      "label": "Arp"
    }
  ],
  "drums": null,
  "fx": [
    {
      "busId": "reverb",
      "wet": 1,
      "params": [ { "paramId": "irType", "value": "hall" } ],
      "sends": [ { "routeId": "<hev-1>", "level": 0.2 }, { "routeId": "<metro-1>", "level": 0.3 }, { "routeId": "<tram-1>", "level": 0.3 } ]
    }
  ]
}
```
