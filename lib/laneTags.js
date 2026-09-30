// Per-lane role labels ("bass", "lead", "pad") and their colour.
//
// Purely an annotation layer: nothing here reaches the engine or changes a note.
// A tag is `{ text, color }` keyed by routeId in MixerTab's `trackLabels` map,
// persisted with the song (lib/songState.js). The colour is what the DAW lane
// box paints as its left border, so a mix reads by role at a glance rather than
// by transit line — line colour already means "which line", and overloading it
// would lose that.
//
// Pure and dependency-free: songState imports this, and songState is reachable
// from server-side snapshot code, so nothing here may pull in tone/engine.

export const DEFAULT_LANE_TAG = { text: '', color: '' }

// Max label length. Long enough for "Counter-melody", short enough that the chip
// never pushes the lane's mix controls off a 1280px lane header.
export const LANE_TAG_MAX_LEN = 18

// One-tap roles. Each carries its own colour so a whole mix can be tagged
// without anyone picking colours; the colour is still editable afterwards.
//
// Eight distinguishable hues, but pulled into the app's muted palette (the
// first versions were Tailwind's saturated defaults, which shouted over the
// lime accent) and kept mid-lightness so every chip reads on both themes.
// Saved songs keep whatever hex they stored; this only changes new tags.
export const LANE_TAG_PRESETS = [
  { text: 'Lead',    color: '#e5534b' },
  { text: 'Bass',    color: '#6c7fd8' },
  { text: 'Pad',     color: '#5ab0e6' },
  { text: 'Chords',  color: '#4caf7d' },
  { text: 'Arp',     color: '#d4b13a' },
  { text: 'Perc',    color: '#e2803b' },
  { text: 'Texture', color: '#3fa89c' },
  { text: 'FX',      color: '#d0679e' },
]

// Swatches offered in the colour picker: the preset hues plus two neutrals, so a
// custom label ("Verse", "Drone") can still be colour-coded. Both neutrals are
// mid-greys: the old near-white one vanished against the light theme.
export const LANE_TAG_COLORS = [
  ...LANE_TAG_PRESETS.map(p => p.color),
  '#a4abb6',
  '#565c66',
]

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

/**
 * Coerce anything loaded from a snapshot into a safe `{ text, color }`.
 *
 * The colour ends up in an inline style, so it is validated rather than trusted:
 * a saved song is user data that can come from a shared link, and a bare hex is
 * the only shape any of our writers produce.
 */
export function normalizeLaneTag(tag) {
  if (!tag || typeof tag !== 'object') return { ...DEFAULT_LANE_TAG }

  // Leading space stripped and length clamped, but NOT trimmed at the end: this
  // runs on every keystroke of the label input, and a trailing trim there makes
  // it impossible to type the space *between* two words ("Sub Bass" — the space
  // is eaten the moment it's typed). Whitespace-only still collapses to empty,
  // so a label of blanks doesn't count as a label.
  const rawText = typeof tag.text === 'string' ? tag.text.trimStart().slice(0, LANE_TAG_MAX_LEN) : ''
  const text    = rawText.trim() ? rawText : ''

  const rawColor = typeof tag.color === 'string' ? tag.color.trim() : ''
  const color    = HEX_COLOR.test(rawColor) ? rawColor.toLowerCase() : ''
  return { text, color }
}

/** True when a tag has nothing to show — the entry is dropped rather than stored. */
export function isEmptyLaneTag(tag) {
  const t = normalizeLaneTag(tag)
  return !t.text && !t.color
}

/** Normalize a whole routeId → tag map, dropping empty entries. */
export function normalizeLaneTags(map) {
  const out = {}
  for (const [routeId, tag] of Object.entries(map ?? {})) {
    const clean = normalizeLaneTag(tag)
    if (clean.text || clean.color) out[routeId] = clean
  }
  return out
}
