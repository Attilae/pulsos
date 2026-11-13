// Cloud storage rules for reference loops ("Your loop"), shared by the browser
// client (lib/referenceCloud.js) and the server (lib/server/referenceLoops.js).
// Pure: no Tone, React, DB or Blob imports. Tested in test/reference-loops.test.js.
//
// A loop is stored on Vercel Blob under the uploader's own folder and recorded
// in the `reference_loops` table. Its id is the same id the song snapshot and
// the browser's IndexedDB cache already use (snapshot.referenceTrack.id), so a
// song needs no extra field to find its audio on another device.

const MB = 1024 * 1024

// Loops over this size still play, but stay on the device they were added on.
export const REFERENCE_CLOUD_MAX_BYTES = 25 * MB

export const REFERENCE_LOOP_ID_RE = /^[A-Za-z0-9_-]{8,64}$/
export const REFERENCE_LOOP_NAME_MAX = 120

// Extension → the content type stored with the blob. Anything else is refused,
// so a stored loop is never served back as a document a browser would render.
const CONTENT_TYPES = Object.freeze({
  wav: 'audio/wav',
  wave: 'audio/wav',
  mp3: 'audio/mpeg',
  aif: 'audio/aiff',
  aiff: 'audio/aiff',
  aifc: 'audio/aiff',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  webm: 'audio/webm',
})

export const REFERENCE_CONTENT_TYPES = Object.freeze([...new Set(Object.values(CONTENT_TYPES))])

export function loopExtension(name) {
  const m = /\.([a-z0-9]+)$/i.exec(name ?? '')
  const ext = m ? m[1].toLowerCase() : ''
  return CONTENT_TYPES[ext] ? ext : ''
}

export function loopContentType(name) {
  return CONTENT_TYPES[loopExtension(name)] ?? null
}

// Blob pathname for one user's loop. The user id is a path segment, which is
// what lets the server check that a pathname belongs to the caller.
export function loopPathname(userId, id, name) {
  const ext = loopExtension(name)
  if (!userId || !REFERENCE_LOOP_ID_RE.test(id ?? '') || !ext) return null
  return `loops/${encodeURIComponent(userId)}/${id}.${ext}`
}

// True when `pathname` is this user's upload of loop `id`. Blob may append a
// random suffix before the extension (`<id>-<suffix>.wav`).
export function isOwnLoopPathname(pathname, userId, id) {
  if (typeof pathname !== 'string' || !userId || !REFERENCE_LOOP_ID_RE.test(id ?? '')) return false
  const prefix = `loops/${encodeURIComponent(userId)}/${id}`
  if (!pathname.startsWith(prefix)) return false
  const rest = pathname.slice(prefix.length)
  return /^(-[A-Za-z0-9]+)?\.[a-z0-9]+$/.test(rest) && !!loopExtension(pathname)
}

// Validates what the browser says about a loop before a token is issued or a
// row is written. Returns { ok, value } or { ok: false, error }.
export function validateLoopMeta(input) {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Invalid loop' }
  const id = input.id
  if (typeof id !== 'string' || !REFERENCE_LOOP_ID_RE.test(id)) return { ok: false, error: 'Invalid loop id' }
  const name = typeof input.name === 'string' ? input.name.trim().slice(0, REFERENCE_LOOP_NAME_MAX) : ''
  if (!name || !loopExtension(name)) return { ok: false, error: 'Choose a WAV, AIFF, MP3, FLAC, OGG or M4A file' }
  const bytes = Number(input.bytes)
  if (!Number.isFinite(bytes) || bytes <= 0) return { ok: false, error: 'File is empty' }
  if (bytes > REFERENCE_CLOUD_MAX_BYTES) {
    return { ok: false, error: `Loops over ${REFERENCE_CLOUD_MAX_BYTES / MB} MB stay on this device`, code: 'too_large' }
  }
  const durationSec = Number(input.durationSec)
  return {
    ok: true,
    value: {
      id,
      name,
      bytes: Math.round(bytes),
      durationSec: Number.isFinite(durationSec) && durationSec > 0 ? Math.min(durationSec, 3600) : 0,
    },
  }
}

// `limit` null = unlimited.
export function loopSlotsLeft(count, limit) {
  if (limit == null) return Infinity
  return Math.max(0, limit - (count ?? 0))
}

export function loopLimitMessage(limit, plan) {
  const n = `${limit} ${limit === 1 ? 'loop' : 'loops'}`
  return plan === 'free'
    ? `Free accounts store ${n}. Delete one, or upgrade to Pro to store more.`
    : `Your plan stores ${n}. Delete one to store another.`
}

export function formatLoopSize(bytes) {
  if (!(bytes > 0)) return ''
  return bytes >= MB ? `${(bytes / MB).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}
