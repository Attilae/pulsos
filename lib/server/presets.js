import { randomUUID } from 'node:crypto'
import { and, desc, eq, ne, sql } from 'drizzle-orm'
import { db } from '../db/index.js'
import { presets } from '../db/schema.js'
import { LIBRARY_LIMITS, validateSongBody } from '../storageLimits.js'
import { MINUTE_MS } from '../rateWindow.js'
import { consumeBudget } from './rateCounter.js'

// A write refused by the storage policy (lib/storageLimits.js). `status` is what
// the HTTP routes answer with; MCP tools report `message`.
export class StorageLimitError extends Error {
  constructor(code, message, status) {
    super(message)
    this.code = code
    this.status = status
  }
}

// Shared by song and composition writes (app/api/compositions).
export async function throttleLibraryWrites(userId) {
  const r = await consumeBudget(`library_write:user:${userId}`, {
    limit: LIBRARY_LIMITS.writesPerMinute, windowMs: MINUTE_MS,
  })
  if (!r.allowed) throw new StorageLimitError('rate_limited', 'Too many saves; try again in a minute.', 429)
}

function checkSongBody(body) {
  const checked = validateSongBody(body)
  if (!checked.ok) throw new StorageLimitError('invalid_song', checked.error, 400)
  return checked.bytes
}

// Inside a transaction: serialize this user's song writes, then check the row
// and byte budgets against every other song they own. Holding the advisory lock
// until commit is what stops two concurrent writes both fitting the last slot.
async function checkLibraryBudget(tx, userId, songId, incomingBytes) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`presets:${userId}`}))`)
  const [row] = await tx.select({
    n: sql`count(*)::int`,
    bytes: sql`coalesce(sum(pg_column_size(${presets.state})), 0)::bigint`,
  }).from(presets).where(and(eq(presets.userId, userId), ne(presets.id, songId)))
  if ((row?.n ?? 0) >= LIBRARY_LIMITS.maxSongs) {
    throw new StorageLimitError('song_limit', `You can keep up to ${LIBRARY_LIMITS.maxSongs} songs; delete some to save more.`, 403)
  }
  if (Number(row?.bytes ?? 0) + incomingBytes > LIBRARY_LIMITS.maxSongBytesTotal) {
    throw new StorageLimitError('storage_limit', 'Your song library is full; delete some songs to save more.', 403)
  }
}

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
  const rows = await query.limit(Math.min(limit || LIBRARY_LIMITS.maxSongs, LIBRARY_LIMITS.maxSongs))
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
  const bytes = checkSongBody(body)
  await throttleLibraryWrites(userId)
  const now = new Date()
  const row = await db.transaction(async (tx) => {
    await checkLibraryBudget(tx, userId, body.id, bytes)
    const [inserted] = await tx.insert(presets).values({
      id: body.id,
      userId,
      name: body.name,
      schemaVersion: body.schemaVersion ?? 1,
      cityId: cityIdOf(body),
      state: body.state,
      createdAt: now,
      updatedAt: now,
    }).returning()
    return inserted
  })
  return serializeSong(row)
}

export async function upsertSong(userId, id, body) {
  const bytes = checkSongBody(body)
  await throttleLibraryWrites(userId)
  const now = new Date()
  const row = await db.transaction(async (tx) => {
    await checkLibraryBudget(tx, userId, id, bytes)
    const [written] = await tx.insert(presets).values({
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
    return written
  })
  return row ? serializeSong(row) : null
}

export async function deleteSong(userId, id) {
  await db.delete(presets).where(and(eq(presets.id, id), eq(presets.userId, userId)))
}

// Same shape the browser mints (lib/persistence.js newSongId), plus a longer
// random tail since server writes don't share the browser's per-tab clock.
export function newServerSongId() {
  return `song_${Date.now().toString(36)}_${randomUUID().replace(/-/g, '').slice(0, 10)}`
}

// MCP writes use optimistic concurrency so a saved browser edit cannot be
// overwritten by a client that read an older snapshot. `transform` receives the
// current song and returns the next state (or { error } to abort without writing).
export async function updateSongState(userId, id, expectedUpdatedAt, transform) {
  const current = await getSong(userId, id)
  if (!current) return { error: 'not_found' }
  if (current.updatedAt !== expectedUpdatedAt) return { error: 'conflict' }

  const next = await transform(current)
  if (next?.error) return next
  const state = next.state
  let bytes
  try {
    bytes = checkSongBody({ state })
    await throttleLibraryWrites(userId)
  } catch (err) {
    if (err instanceof StorageLimitError) return { error: 'storage_limit', message: err.message }
    throw err
  }
  const now = new Date(Math.max(Date.now(), expectedUpdatedAt + 1))
  let row
  try {
    row = await db.transaction(async (tx) => {
      await checkLibraryBudget(tx, userId, id, bytes)
      const [updated] = await tx.update(presets)
        .set({ state, cityId: cityIdOf({ state }) ?? current.cityId, updatedAt: now })
        .where(and(
          eq(presets.id, id),
          eq(presets.userId, userId),
          eq(presets.updatedAt, new Date(expectedUpdatedAt)),
        ))
        .returning()
      return updated
    })
  } catch (err) {
    if (err instanceof StorageLimitError) return { error: 'storage_limit', message: err.message }
    throw err
  }
  return row ? { song: serializeSong(row) } : { error: 'conflict' }
}

export function setSongTempo(userId, id, bpm, expectedUpdatedAt) {
  return updateSongState(userId, id, expectedUpdatedAt, (current) => ({ state: { ...current.state, bpm } }))
}
