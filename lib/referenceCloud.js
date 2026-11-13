// Browser client for cloud-stored reference loops (app/api/reference/*).
// The audio goes straight from the browser to Vercel Blob; the app's own
// routes only issue the upload token, record the result and hand out download
// URLs. lib/useReferenceTrack.js is the only caller.

import { upload } from '@vercel/blob/client'
import { loopPathname, validateLoopMeta } from './referenceLoops.js'

export class ReferenceCloudError extends Error {
  constructor(message, code) {
    super(message)
    this.name = 'ReferenceCloudError'
    this.code = code // 'loop_limit' | 'too_large' | 'unavailable' | 'rate_limited' | 'failed' | …
  }
}

async function readError(res, fallback) {
  let body = null
  try { body = await res.json() } catch { /* not JSON */ }
  return new ReferenceCloudError(body?.error ?? fallback, body?.code ?? (res.status === 401 ? 'unauthorized' : 'failed'))
}

// { loops, limit, plan, maxBytes, access, enabled } for the signed-in user.
export async function fetchLoopLibrary() {
  const res = await fetch('/api/reference', { credentials: 'same-origin' })
  if (!res.ok) throw await readError(res, "Couldn't load your stored loops")
  return res.json()
}

// Upload `file` as loop `id`. `access` is the store's mode from the library.
export async function uploadLoop(file, { id, userId, durationSec, access, onProgress }) {
  const input = { id, name: file.name ?? 'loop', bytes: file.size, durationSec }
  const meta = validateLoopMeta(input)
  if (!meta.ok) throw new ReferenceCloudError(meta.error, meta.code ?? 'invalid_loop')
  const pathname = loopPathname(userId, id, meta.value.name)
  if (!pathname) throw new ReferenceCloudError("This file type can't be stored", 'invalid_loop')

  let blob
  try {
    blob = await upload(pathname, file, {
      access,
      handleUploadUrl: '/api/reference/upload',
      clientPayload: JSON.stringify(meta.value),
      multipart: file.size > 8 * 1024 * 1024,
      onUploadProgress: onProgress ? (e => onProgress(e.percentage)) : undefined,
    })
  } catch {
    // The SDK hides why the token route refused, so callers check the library
    // (slots, size) before calling this and get a specific message that way.
    throw new ReferenceCloudError("Couldn't upload the loop", 'failed')
  }

  const res = await fetch('/api/reference', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...meta.value, pathname: blob.pathname }),
  })
  if (!res.ok) throw await readError(res, "Couldn't store the loop")
  return (await res.json()).loop
}

// The share link this session was opened from (lib/useSongPersistence.js sets
// it when it imports ?shared=<id>). It lets a visitor, signed in or not, read
// the loop that belongs to that shared song.
let shareSource = null
export function setLoopShareSource(shareId) { shareSource = shareId || null }
export function getLoopShareSource() { return shareSource }

// The stored audio as a File, or null when there is none the caller may read.
// `shareId` reads the loop of a song opened from a public share link.
export async function downloadLoop(id, { shareId = shareSource } = {}) {
  const query = shareId ? `?shared=${encodeURIComponent(shareId)}` : ''
  const res = await fetch(`/api/reference/${encodeURIComponent(id)}${query}`, { credentials: 'same-origin' })
  if (res.status === 404 || res.status === 401) return null
  if (!res.ok) throw await readError(res, "Couldn't load the loop")
  const { url, name } = await res.json()
  const audio = await fetch(url)
  if (!audio.ok) throw new ReferenceCloudError("Couldn't download the loop", 'failed')
  const data = await audio.blob()
  return new File([data], name || 'loop', { type: data.type })
}

export async function deleteCloudLoop(id) {
  const res = await fetch(`/api/reference/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'same-origin' })
  if (!res.ok) throw await readError(res, "Couldn't delete the loop")
}
