// Pure drum-pad specs — no Tone import (see lib/fxSpecs.js). Re-exported by
// lib/engines/drumEngine.js.

export const PAD_DEFS = [
  { id: 'kick',  label: 'Kick',  defaultRouteName: '6' },
  { id: 'snare', label: 'Snare', defaultRouteName: '2' },
  { id: 'hat',   label: 'Hat',   defaultRouteName: '4' },
  { id: 'rim',   label: 'Rim',   defaultRouteName: 'M2' },
  { id: 'ride',  label: 'Ride',  defaultRouteName: 'M3' },
  { id: 'clap',  label: 'Clap',  defaultRouteName: '1' },
]

export const STEPS        = 16   // visible / playback loop length (1 bar of 16ths)
export const SOURCE_STEPS = 64   // underlying buffer length per pad

// Step values are velocities: 0 = off, else 0..1 scaling the voice's baked level.
// Clicking a step cycles through these (full first, so a fresh click hits at the
// pre-velocity-feature strength).
export const STEP_LEVELS = [0, 1, 0.7, 0.4]
