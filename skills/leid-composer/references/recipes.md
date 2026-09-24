# Leið recipes

These are starting points, not templates to copy blindly. Every example uses placeholder route ids
such as `"<metro-1>"`. Replace each one with a real `id` from `list_routes` for the user's city, and
pick a line whose `stopCount` suits the role. If the city has no lines of a type (Zürich has no
metro, Warsaw has no trolley), use the nearest role: a low-stop tram or bus line for melody, or
`hev` for bass.

Before saving, check every value against `get_composer_guide`. It is authoritative, and anything it
doesn't list gets dropped.

## Contents
- [Dub](#dub): kick-ducked bass, sparse skank, long delay
- [Ambient drift](#ambient-drift): no drums, slow pads, big reverb
- [Minimal techno](#minimal-techno): driving four-on-the-floor, one hypnotic lead
- [Lo-fi keys](#lo-fi-keys): mellow piano, soft hats, warm filter
- [Cinematic swell](#cinematic-swell): orchestral samplers, arch contours

## Dub

- **Tempo and key:** 70–90 BPM (or 140 read at half time), minor or dorian.
- **Roles:** a metro line with few stops (≈10–16) as MonoSynth bass at octave -1 or -2, with legato
  and a low filter, ducked by the kick. A tram line with an 8n grid and chance ~0.6 plays the skank
  or chord stab. A bus line plays a quiet pad or organ that enters late.
- **Drums:** kick on 1 and 3, rim or snare on 3. Hats stay sparse.
- **FX:** a dotted-8th delay with high feedback on the skank, and a spring reverb.

```json
{
  "summary": "Deep minor dub: a kick-ducked bass, a delayed tram skank and a late organ.",
  "bpm": 76,
  "harmony": { "root": "G", "scaleType": "minor" },
  "masterVolume": -4,
  "tracks": [
    {
      "routeId": "<metro-1>",
      "synthType": "MonoSynth",
      "volume": -6,
      "pan": 0,
      "octave": -2,
      "glide": 0.08,
      "legato": true,
      "filter": { "type": "lowpass", "frequency": 600, "Q": 2 },
      "speed": 0.5,
      "gridResolution": "8n",
      "pitchVariety": { "contour": "randomWalk", "variety": 0.1 },
      "label": "Bass",
      "sidechain": { "enabled": true, "source": "drums:kick", "amountDb": -12, "attack": 0.005, "release": 0.25 }
    },
    {
      "routeId": "<tram-1>",
      "synthType": "PluckSynth",
      "volume": -12,
      "pan": 0.35,
      "octave": 0,
      "speed": 1,
      "gridResolution": "8n",
      "noteChance": 0.6,
      "pitchVariety": { "contour": "demand", "variety": 0 },
      "label": "Chords"
    },
    {
      "routeId": "<bus-1>",
      "synthType": "Sampler",
      "samplerPreset": "organ",
      "volume": -20,
      "pan": -0.3,
      "envelope": { "attack": 0.3, "decay": 0.5, "sustain": 0.6, "release": 3 },
      "speed": 0.25,
      "gridResolution": "4n",
      "loopRegion": { "startCell": 32, "endCell": 64 },
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
      "wet": 0.5,
      "params": [ { "paramId": "sync", "value": "8n." }, { "paramId": "feedback", "value": 0.6 } ],
      "sends": [ { "routeId": "<tram-1>", "level": 0.55 }, { "routeId": "drums", "level": 0.15 } ]
    },
    {
      "busId": "jcreverb",
      "wet": 0.4,
      "params": [ { "paramId": "roomSize", "value": 0.7 } ],
      "sends": [ { "routeId": "<bus-1>", "level": 0.4 }, { "routeId": "<tram-1>", "level": 0.2 } ]
    }
  ]
}
```

## Ambient drift

- **Tempo and key:** 60–80 BPM, lydian, major or pentatonic.
- **Density:** the whole point. Every melodic lane plays ≤ 0.5 notes per beat and pads ≤ 0.25, so
  use speed 0.25–0.5, a 4n grid and lines with few stops. Use no drums.
- **Roles:** an FM bell lead on a sparse metro line at octave +1, with noteChance ~0.7. Two
  bus-line pads with long releases play different loopRegions and speeds so they drift. Add a
  granular halo on one pad.
- **FX:** a cathedral or hall reverb doing most of the work, plus a slow ping-pong delay.

```json
{
  "summary": "Slow lydian drift: sparse bells over two pads that never quite line up.",
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
      "envelope": { "attack": 0.02, "decay": 0.6, "sustain": 0.2, "release": 3 },
      "speed": 0.5,
      "gridResolution": "4n",
      "noteChance": 0.7,
      "pitchVariety": { "contour": "demand", "variety": 0.2 },
      "label": "Lead"
    },
    {
      "routeId": "<bus-1>",
      "synthType": "AMSynth",
      "volume": -18,
      "pan": -0.4,
      "octave": 0,
      "envelope": { "attack": 0.8, "decay": 1, "sustain": 0.8, "release": 4 },
      "speed": 0.25,
      "gridResolution": "4n",
      "pitchVariety": { "contour": "arch", "variety": 0.1 },
      "granular": { "enabled": true, "mix": 0.4, "grainSize": 0.2, "overlap": 0.1, "playbackRate": 0.5, "loopStart": 0, "loopEnd": 1, "jitter": 0.4, "reverse": false, "attack": 0.5, "release": 3 },
      "label": "Pad"
    },
    {
      "routeId": "<bus-2>",
      "synthType": "Sampler",
      "samplerPreset": "harmonium",
      "volume": -20,
      "pan": 0.45,
      "octave": -1,
      "envelope": { "attack": 0.9, "decay": 0.5, "sustain": 0.7, "release": 4 },
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
      "wet": 0.7,
      "params": [ { "paramId": "irType", "value": "cathedral" }, { "paramId": "decay", "value": 8 } ],
      "sends": [ { "routeId": "<metro-1>", "level": 0.6 }, { "routeId": "<bus-1>", "level": 0.5 }, { "routeId": "<bus-2>", "level": 0.5 } ]
    },
    {
      "busId": "pingpong",
      "wet": 0.35,
      "params": [ { "paramId": "sync", "value": "4n." }, { "paramId": "feedback", "value": 0.5 } ],
      "sends": [ { "routeId": "<metro-1>", "level": 0.35 } ]
    }
  ]
}
```

## Minimal techno

- **Tempo and key:** 122–130 BPM, minor or phrygian.
- **Roles:** four-on-the-floor kick with an offbeat hat and a clap on 2 and 4. One tram line with a
  16n grid, a short MonoSynth envelope and a filter carries the rhythm. A metro bass is ducked hard
  by the kick. A quiet MetalSynth plays a colour lane on `loopPattern` so it comes and goes.
- **FX:** an autofilter or phaser for movement, and a short delay.

```json
{
  "summary": "Hypnotic phrygian techno: a pumping bass, a filtered tram sequence and metallic accents.",
  "bpm": 126,
  "harmony": { "root": "E", "scaleType": "phrygian" },
  "masterVolume": -4,
  "tracks": [
    {
      "routeId": "<tram-1>",
      "synthType": "MonoSynth",
      "volume": -9,
      "pan": 0.1,
      "octave": 0,
      "envelope": { "attack": 0.002, "decay": 0.15, "sustain": 0.1, "release": 0.2 },
      "filter": { "type": "lowpass", "frequency": 1800, "Q": 6 },
      "speed": 1,
      "gridResolution": "16n",
      "pitchVariety": { "contour": "randomWalk", "variety": 0.15 },
      "label": "Arp"
    },
    {
      "routeId": "<metro-1>",
      "synthType": "MonoSynth",
      "volume": -7,
      "pan": 0,
      "octave": -2,
      "envelope": { "attack": 0.005, "decay": 0.2, "sustain": 0.5, "release": 0.3 },
      "filter": { "type": "lowpass", "frequency": 400, "Q": 1.5 },
      "speed": 0.5,
      "gridResolution": "8n",
      "pitchVariety": { "contour": "randomWalk", "variety": 0 },
      "label": "Bass",
      "sidechain": { "enabled": true, "source": "drums:kick", "amountDb": -18, "attack": 0.003, "release": 0.18 }
    },
    {
      "routeId": "<tram-2>",
      "synthType": "MetalSynth",
      "volume": -22,
      "pan": -0.5,
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
      "wet": 0.6,
      "params": [ { "paramId": "sync", "value": "1n" }, { "paramId": "baseFrequency", "value": 300 }, { "paramId": "octaves", "value": 4 } ],
      "sends": [ { "routeId": "<tram-1>", "level": 0.6 } ]
    },
    {
      "busId": "delay",
      "wet": 0.3,
      "params": [ { "paramId": "sync", "value": "8t" }, { "paramId": "feedback", "value": 0.35 } ],
      "sends": [ { "routeId": "<tram-2>", "level": 0.4 } ]
    }
  ]
}
```

## Lo-fi keys

- **Tempo and key:** 70–88 BPM, dorian, minor or major pentatonic.
- **Roles:** a piano or electric-piano sampler on a mid-density metro line, with a lowpass around
  3 kHz. A contrabass or bass-electric sampler plays the bass. A tram line with soft hats at
  noteChance ~0.5 gives a shuffle feel.
- **Drums:** a lazy kick and snare with soft (0.4) ghost hats.
- **FX:** a chorus plus a warm hall reverb, and a light bitcrusher on the drums.

```json
{
  "summary": "Dusty dorian lo-fi: a filtered piano over an upright bass and a lazy beat.",
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
      "envelope": { "attack": 0.01, "decay": 0.4, "sustain": 0.5, "release": 1.8 },
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
      "wet": 0.4,
      "params": [ { "paramId": "frequency", "value": 0.6 }, { "paramId": "depth", "value": 0.5 } ],
      "sends": [ { "routeId": "<metro-1>", "level": 0.5 } ]
    },
    {
      "busId": "reverb",
      "wet": 0.45,
      "params": [ { "paramId": "irType", "value": "hall" }, { "paramId": "decay", "value": 3 } ],
      "sends": [ { "routeId": "<metro-1>", "level": 0.35 }, { "routeId": "drums", "level": 0.15 } ]
    },
    {
      "busId": "bitcrusher",
      "wet": 0.25,
      "params": [ { "paramId": "bits", "value": 8 } ],
      "sends": [ { "routeId": "drums", "level": 0.4 } ]
    }
  ]
}
```

## Cinematic swell

- **Tempo and key:** 60–90 BPM, minor or major.
- **Roles:** cello or contrabass samplers on hev lines give the low foundation. A violin, french-horn
  or flute sampler on a metro line uses the `arch` contour so the phrase rises and falls. A harp arp
  on a tram line adds shimmer. Use toms instead of a kit, or no drums at all.
- **Levels:** strings swell through release and reverb, not through attack. See NOTE LENGTH in the
  guide.

```json
{
  "summary": "Minor-key swell: low cellos, an arching violin line and a harp arpeggio.",
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
      "envelope": { "attack": 0.4, "decay": 0.5, "sustain": 0.8, "release": 3 },
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
      "envelope": { "attack": 0.5, "decay": 0.5, "sustain": 0.8, "release": 3 },
      "speed": 0.5,
      "gridResolution": "4n",
      "loopRegion": { "startCell": 16, "endCell": 64 },
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
      "wet": 0.6,
      "params": [ { "paramId": "irType", "value": "hall" }, { "paramId": "decay", "value": 6 } ],
      "sends": [ { "routeId": "<hev-1>", "level": 0.4 }, { "routeId": "<metro-1>", "level": 0.5 }, { "routeId": "<tram-1>", "level": 0.5 } ]
    }
  ]
}
```
