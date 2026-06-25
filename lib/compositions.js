// Composition persistence backed by the /api/compositions route handlers.
//
// A composition is a song built by chaining saved presets in order. Mirrors the
// shape and async contract of lib/persistence.js (songs/presets). All calls are
// async and user-scoped (signed-in only); list/load degrade to []/null when the
// caller isn't authenticated.

import { AuthRequiredError } from './persistence.js'

export const COMPOSITION_SCHEMA_VERSION = 1

async function _json(res) {
  if (res.status === 401) throw new AuthRequiredError()
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`[compositions] ${res.status} ${detail}`)
  }
  return res.json()
}

export async function listCompositions() {
  try {
    const rows = await _json(await fetch('/api/compositions', { credentials: 'include' }))
    return Array.isArray(rows)
      ? [...rows].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      : []
  } catch (e) {
    if (e instanceof AuthRequiredError) return []
    console.warn('[compositions] listCompositions failed', e)
    return []
  }
}

export async function loadComposition(id) {
  if (!id) return null
  try {
    const res = await fetch(`/api/compositions/${encodeURIComponent(id)}`, { credentials: 'include' })
    if (res.status === 404) return null
    return await _json(res)
  } catch (e) {
    if (e instanceof AuthRequiredError) return null
    console.warn('[compositions] loadComposition failed', e)
    return null
  }
}

// Upsert: PUT /api/compositions/:id handles both new and existing rows.
export async function saveComposition(comp) {
  if (!comp?.id) throw new Error('saveComposition: missing id')
  const res = await fetch(`/api/compositions/${encodeURIComponent(comp.id)}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: comp.name,
      schemaVersion: COMPOSITION_SCHEMA_VERSION,
      cityId: comp.cityId ?? null,
      bpm: comp.bpm ?? 120,
      items: comp.items ?? [],
    }),
  })
  return _json(res)
}

export async function deleteComposition(id) {
  if (!id) return
  try {
    await fetch(`/api/compositions/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      credentials: 'include',
    })
  } catch (e) {
    console.warn('[compositions] deleteComposition failed', e)
  }
}

export function newCompositionId() {
  return `comp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}
