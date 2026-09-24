// Per-lane note length: how long an ordinary stop note is held before its
// release starts. Before this existed every mock stop note used a one-beat
// ('4n') gate whatever the grid, speed or loop window, so a slow attack on a
// short-gated lane never peaked and a pad couldn't be held past a beat.
//
// Stored sparse (`trackNoteLengths`, routeId → Tone division): absent means the
// engine's legacy gate, so older songs play byte-for-byte as before and no
// schema bump is needed. Arp steps (their own gate), legato and drone notes
// aren't affected, and PluckSynth ignores note length entirely.
//
// Pure — engine, MIDI export, song snapshots and the AI plan contract share it.

export const DEFAULT_NOTE_LENGTH = '4n'

// Tone divisions, shortest first, with their length in beats (quarter notes).
export const NOTE_LENGTH_BEATS = {
  '16n': 0.25,
  '8n':  0.5,
  '8n.': 0.75,
  '4n':  1,
  '4n.': 1.5,
  '2n':  2,
  '1n':  4,
}
export const NOTE_LENGTHS = Object.keys(NOTE_LENGTH_BEATS)

export const NOTE_LENGTH_LABELS = {
  '16n': '1/16', '8n': '1/8', '8n.': '1/8·', '4n': '1/4', '4n.': '1/4·', '2n': '1/2', '1n': '1 bar',
}

/** A valid note length, or null (= the lane's default gate). */
export function normalizeNoteLength(value) {
  return typeof value === 'string' && value in NOTE_LENGTH_BEATS ? value : null
}

/** Beats a note is held for; `fallbackBeats` when the lane has no length set. */
export function noteLengthBeats(value, fallbackBeats = 1) {
  return NOTE_LENGTH_BEATS[normalizeNoteLength(value)] ?? fallbackBeats
}

/** Sparse, validated copy of a routeId → length map (invalid entries dropped). */
export function normalizeNoteLengthMap(map) {
  const out = {}
  for (const [id, value] of Object.entries(map ?? {})) {
    const len = normalizeNoteLength(value)
    if (len) out[id] = len
  }
  return out
}
