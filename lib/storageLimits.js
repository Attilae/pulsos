// Bounds on what a user can store: per-record shape/size limits checked before a
// write, plus the per-user library budgets lib/server/presets.js and
// app/api/compositions enforce atomically. Every writer (the HTTP routes and the
// MCP tools) goes through those, so a record can't be oversized by one path and
// rejected by another. Pure, tested in test/storage-limits.test.js.

export const RECORD_ID_MAX = 128
export const RECORD_NAME_MAX = 200

// One song snapshot. A large real song (dozens of lanes with per-stop edits,
// automation and drums) is a few hundred KB; 2 MB leaves room without letting a
// single row grow without bound.
export const SONG_LIMITS = Object.freeze({
  maxBytes: 2 * 1024 * 1024,
  maxDepth: 32,
  maxArrayLength: 20_000,
  maxStringLength: 100_000,
  maxKeys: 20_000,
})

// A composition only references presets by id, so it stays small.
export const COMPOSITION_LIMITS = Object.freeze({
  maxBytes: 64 * 1024,
  maxDepth: 8,
  maxArrayLength: 256,
  maxStringLength: 1_000,
  maxKeys: 64,
})

export const LIBRARY_LIMITS = Object.freeze({
  maxSongs: 500,
  // Stored (pg_column_size) bytes across all of a user's songs.
  maxSongBytesTotal: 100 * 1024 * 1024,
  maxCompositions: 200,
  // Song + composition writes per user per minute. Autosave is debounced to
  // 800 ms, so continuous editing stays well under this.
  writesPerMinute: 180,
})

// Walks a JSON value iteratively (no recursion limit to trip over) and reports
// the first bound it breaks, or its encoded size.
export function checkJsonBounds(value, limits) {
  let encoded
  try { encoded = JSON.stringify(value) } catch { return { ok: false, error: 'not serializable' } }
  if (encoded === undefined) return { ok: false, error: 'not serializable' }
  const bytes = byteLength(encoded)
  if (bytes > limits.maxBytes) return { ok: false, error: `too large (${bytes} bytes, max ${limits.maxBytes})` }

  const stack = [[value, 1]]
  while (stack.length) {
    const [node, depth] = stack.pop()
    if (typeof node === 'string') {
      if (node.length > limits.maxStringLength) return { ok: false, error: 'string too long' }
      continue
    }
    if (node === null || typeof node !== 'object') continue
    if (depth > limits.maxDepth) return { ok: false, error: 'nested too deeply' }
    if (Array.isArray(node)) {
      if (node.length > limits.maxArrayLength) return { ok: false, error: 'array too long' }
      for (const item of node) stack.push([item, depth + 1])
      continue
    }
    const keys = Object.keys(node)
    if (keys.length > limits.maxKeys) return { ok: false, error: 'too many keys' }
    for (const key of keys) {
      if (key.length > limits.maxStringLength) return { ok: false, error: 'key too long' }
      stack.push([node[key], depth + 1])
    }
  }
  return { ok: true, bytes }
}

export function validateRecordId(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= RECORD_ID_MAX
}

export function validateRecordName(name) {
  return name == null || (typeof name === 'string' && name.length <= RECORD_NAME_MAX)
}

// Checks a song write body ({ name, state, schemaVersion, ... }). `state` may be
// absent on an upsert (the route defaults it to {}).
export function validateSongBody(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'body required' }
  if (!validateRecordName(body.name)) return { ok: false, error: `name is limited to ${RECORD_NAME_MAX} characters` }
  if (body.schemaVersion != null && !Number.isInteger(body.schemaVersion)) {
    return { ok: false, error: 'schemaVersion must be an integer' }
  }
  if (body.state != null && (typeof body.state !== 'object' || Array.isArray(body.state))) {
    return { ok: false, error: 'state must be an object' }
  }
  const checked = checkJsonBounds(body.state ?? {}, SONG_LIMITS)
  return checked.ok ? checked : { ok: false, error: `song ${checked.error}` }
}

export function validateCompositionBody(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'body required' }
  if (!validateRecordName(body.name)) return { ok: false, error: `name is limited to ${RECORD_NAME_MAX} characters` }
  if (body.items != null && !Array.isArray(body.items)) return { ok: false, error: 'items must be an array' }
  if (body.bpm != null && !Number.isFinite(body.bpm)) return { ok: false, error: 'bpm must be a number' }
  if (body.cityId != null && (typeof body.cityId !== 'string' || body.cityId.length > RECORD_ID_MAX)) {
    return { ok: false, error: 'invalid cityId' }
  }
  const checked = checkJsonBounds(body.items ?? [], COMPOSITION_LIMITS)
  return checked.ok ? checked : { ok: false, error: `composition ${checked.error}` }
}

function byteLength(text) {
  return typeof Buffer !== 'undefined' ? Buffer.byteLength(text) : new TextEncoder().encode(text).length
}
