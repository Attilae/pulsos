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
export const LANE_TAG_PRESETS = [
  { text: 'Lead',    color: '#ef4444' },
  { text: 'Bass',    color: '#8b5cf6' },
  { text: 'Pad',     color: '#38bdf8' },
  { text: 'Chords',  color: '#22c55e' },
  { text: 'Arp',     color: '#eab308' },
  { text: 'Perc',    color: '#f97316' },
  { text: 'Texture', color: '#14b8a6' },
  { text: 'FX',      color: '#ec4899' },
]

// Swatches offered in the colour picker: the preset hues plus two neutrals, so a
// custom label ("Verse", "Drone") can still be colour-coded.
export const LANE_TAG_COLORS = [
  ...LANE_TAG_PRESETS.map(p => p.color),
  '#94a3b8',
  '#f8fafc',
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
