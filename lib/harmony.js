// Pure harmony vocabulary (root notes + scale types with their UI labels). Kept
// out of components/DawView.jsx, which re-exports it, so server code can validate
// an AI plan's harmony without importing React.

export const NOTE_ROOTS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

export const SCALE_TYPES = [
  ['major',           'Major'],
  ['minor',           'Minor'],
  ['pentatonic',      'Pent.'],
  ['pentatonicMinor', 'Pent. Min'],
  ['dorian',          'Dorian'],
  ['phrygian',        'Phrygian'],
  ['lydian',          'Lydian'],
  ['mixolydian',      'Mixolyd.'],
]
