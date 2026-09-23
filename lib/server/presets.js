import { and, desc, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { presets } from '../db/schema.js'

export function cityIdOf(body) {
  return body?.state?.cityId ?? body?.cityId ?? null
}

export function serializeSong(row) {
  return {
    schemaVersion: row.schemaVersion,
    id: row.id,
    name: row.name,
    cityId: row.cityId ?? row.state?.cityId ?? null,
    state: row.state,
    shareId: row.shareId ?? null,
    createdAt: row.createdAt?.getTime?.() ?? row.createdAt,
    updatedAt: row.updatedAt?.getTime?.() ?? row.updatedAt,
  }
}

export async function listSongs(userId, { limit } = {}) {
  const query = db.select({
    id: presets.id, name: presets.name, cityId: presets.cityId,
    shareId: presets.shareId, updatedAt: presets.updatedAt,
  }).from(presets).where(eq(presets.userId, userId)).orderBy(desc(presets.updatedAt))
  const rows = await (limit ? query.limit(limit) : query)
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    cityId: row.cityId ?? null,
    shareId: row.shareId,
    updatedAt: row.updatedAt?.getTime?.() ?? row.updatedAt,
  }))
}

export async function getSong(userId, id) {
  const [row] = await db.select().from(presets)
    .where(and(eq(presets.id, id), eq(presets.userId, userId))).limit(1)
  return row ? serializeSong(row) : null
}

export async function createSong(userId, body) {
  const now = new Date()
  const [row] = await db.insert(presets).values({
    id: body.id,
    userId,
    name: body.name,
    schemaVersion: body.schemaVersion ?? 1,
    cityId: cityIdOf(body),
    state: body.state,
    createdAt: now,
    updatedAt: now,
  }).returning()
  return serializeSong(row)
}

export async function upsertSong(userId, id, body) {
  const now = new Date()
  const [row] = await db.insert(presets).values({
    id,
    userId,
    name: body.name ?? 'Untitled',
    schemaVersion: body.schemaVersion ?? 1,
    cityId: cityIdOf(body),
    state: body.state ?? {},
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: presets.id,
    set: {
      name: body.name ?? 'Untitled',
      schemaVersion: body.schemaVersion ?? 1,
      cityId: cityIdOf(body),
      state: body.state ?? {},
      updatedAt: now,
    },
    where: eq(presets.userId, userId),
  }).returning()
  return row ? serializeSong(row) : null
}

export async function deleteSong(userId, id) {
  await db.delete(presets).where(and(eq(presets.id, id), eq(presets.userId, userId)))
}

// MCP writes use optimistic concurrency so a saved browser edit cannot be
// overwritten by a client that read an older snapshot.
export async function setSongTempo(userId, id, bpm, expectedUpdatedAt) {
  const current = await getSong(userId, id)
  if (!current) return { error: 'not_found' }
  if (current.updatedAt !== expectedUpdatedAt) return { error: 'conflict' }

  const now = new Date(Math.max(Date.now(), expectedUpdatedAt + 1))
  const [row] = await db.update(presets)
    .set({ state: { ...current.state, bpm }, updatedAt: now })
    .where(and(
      eq(presets.id, id),
      eq(presets.userId, userId),
      eq(presets.updatedAt, new Date(expectedUpdatedAt)),
    ))
    .returning()
  return row ? { song: serializeSong(row) } : { error: 'conflict' }
}
