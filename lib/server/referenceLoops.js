// Reference loops ("Your loop") in the cloud: rows in `reference_loops`, audio
// on Vercel Blob. Rules shared with the browser are in lib/referenceLoops.js.
//
// The count limit (plan.limits.referenceLoops) is checked inside the write's
// transaction under a per-user advisory lock, like the song budget in
// ./presets.js, so two uploads can't both take the last slot.
import { and, asc, eq, ne, sql } from 'drizzle-orm'
import { del, head, issueSignedToken, presignUrl } from '@vercel/blob'
import { db } from '../db/index.js'
import { presets, referenceLoops } from '../db/schema.js'
import {
  REFERENCE_CLOUD_MAX_BYTES, isOwnLoopPathname, loopContentType, loopLimitMessage, validateLoopMeta,
} from '../referenceLoops.js'
import { DAY_MS } from '../rateWindow.js'
import { consumeBudget } from './rateCounter.js'
import { StorageLimitError } from './presets.js'

// Upload tokens a user may request per day, whether or not the upload lands.
const UPLOAD_TOKENS_PER_DAY = 40
const DOWNLOAD_URL_TTL_MS = 5 * 60 * 1000

// The loops live in their own store when REFERENCE_BLOB_READ_WRITE_TOKEN is
// set, otherwise in the app's default store. Connecting a store in the Vercel
// dashboard with the prefix REFERENCE_BLOB_READ_WRITE_TOKEN names the variable
// REFERENCE_BLOB_READ_WRITE_TOKEN_READ_WRITE_TOKEN, so that is accepted too. A store is either public or
// private as a whole; REFERENCE_BLOB_ACCESS must match it (default private).
export function loopBlobConfig() {
  const token = process.env.REFERENCE_BLOB_READ_WRITE_TOKEN
    || process.env.REFERENCE_BLOB_READ_WRITE_TOKEN_READ_WRITE_TOKEN
    || process.env.BLOB_READ_WRITE_TOKEN
    || null
  const access = process.env.REFERENCE_BLOB_ACCESS === 'public' ? 'public' : 'private'
  return { token, access, enabled: !!token }
}

function view(row) {
  return {
    id: row.id,
    name: row.name,
    bytes: row.bytes,
    durationSec: row.durationSec,
    createdAt: row.createdAt?.getTime?.() ?? row.createdAt,
  }
}

export async function listLoops(userId) {
  const rows = await db.select().from(referenceLoops)
    .where(eq(referenceLoops.userId, userId)).orderBy(asc(referenceLoops.createdAt))
  return rows.map(view)
}

export async function countLoops(userId) {
  const [row] = await db.select({ n: sql`count(*)::int` }).from(referenceLoops)
    .where(eq(referenceLoops.userId, userId))
  return row?.n ?? 0
}

async function findLoop(userId, id) {
  const [row] = await db.select().from(referenceLoops)
    .where(and(eq(referenceLoops.userId, userId), eq(referenceLoops.id, id))).limit(1)
  return row ?? null
}

// Before an upload token is issued: is there a slot, and is the user within
// the daily token budget? Throws StorageLimitError.
export async function admitLoopUpload(userId, id, { limit, plan }) {
  const used = await consumeBudget(`loop_upload:user:${userId}`, { limit: UPLOAD_TOKENS_PER_DAY, windowMs: DAY_MS })
  if (!used.allowed) throw new StorageLimitError('rate_limited', 'Too many uploads today; try again tomorrow.', 429)
  if (limit == null) return
  const [row] = await db.select({ n: sql`count(*)::int` }).from(referenceLoops)
    .where(and(eq(referenceLoops.userId, userId), ne(referenceLoops.id, id)))
  if ((row?.n ?? 0) >= limit) throw new StorageLimitError('loop_limit', loopLimitMessage(limit, plan), 403)
}

async function removeBlob(pathname) {
  const { token } = loopBlobConfig()
  if (!token || !pathname) return
  try { await del(pathname, { token }) } catch (err) { console.warn('[reference] blob delete failed', err?.message) }
}

// After the browser finished its upload: verify the blob really is this user's
// loop and within the size cap, then record it. A refused upload is deleted.
export async function registerLoop(userId, input, { limit, plan }) {
  const meta = validateLoopMeta(input)
  if (!meta.ok) throw new StorageLimitError('invalid_loop', meta.error, 400)
  const { id, name, durationSec } = meta.value
  const pathname = input?.pathname
  if (!isOwnLoopPathname(pathname, userId, id)) throw new StorageLimitError('invalid_loop', 'Invalid upload', 400)

  const { token } = loopBlobConfig()
  if (!token) throw new StorageLimitError('unavailable', 'Loop storage is not configured', 503)
  let blob
  try {
    blob = await head(pathname, { token })
  } catch {
    throw new StorageLimitError('invalid_loop', 'Upload not found', 400)
  }
  if (!(blob.size > 0) || blob.size > REFERENCE_CLOUD_MAX_BYTES) {
    await removeBlob(pathname)
    throw new StorageLimitError('invalid_loop', 'File is too large to store', 400)
  }

  let replaced = null
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`reference_loops:${userId}`}))`)
      const rows = await tx.select({ id: referenceLoops.id, pathname: referenceLoops.pathname })
        .from(referenceLoops).where(eq(referenceLoops.userId, userId))
      const existing = rows.find(r => r.id === id)
      if (limit != null && rows.length - (existing ? 1 : 0) >= limit) {
        throw new StorageLimitError('loop_limit', loopLimitMessage(limit, plan), 403)
      }
      const values = {
        userId, id, name, pathname, url: blob.url,
        contentType: loopContentType(pathname) ?? blob.contentType ?? 'application/octet-stream',
        bytes: blob.size, durationSec,
      }
      await tx.insert(referenceLoops).values(values).onConflictDoUpdate({
        target: [referenceLoops.userId, referenceLoops.id],
        set: { name, pathname, url: values.url, contentType: values.contentType, bytes: values.bytes, durationSec },
      })
      if (existing && existing.pathname !== pathname) replaced = existing.pathname
    })
  } catch (err) {
    // Drop the refused upload, unless that file is already a recorded loop
    // (a repeat of an earlier confirm), which must stay.
    const [kept] = await db.select({ id: referenceLoops.id }).from(referenceLoops)
      .where(and(eq(referenceLoops.userId, userId), eq(referenceLoops.pathname, pathname))).limit(1)
      .catch(() => [{ id }])
    if (!kept) await removeBlob(pathname)
    throw err
  }
  if (replaced) await removeBlob(replaced)
  return view(await findLoop(userId, id))
}

export async function deleteLoop(userId, id) {
  const [row] = await db.delete(referenceLoops)
    .where(and(eq(referenceLoops.userId, userId), eq(referenceLoops.id, id)))
    .returning({ pathname: referenceLoops.pathname })
  if (row) await removeBlob(row.pathname)
  return !!row
}

// The loop a public share link exposes: the one its song references, stored by
// the song's owner. Unsharing the song (share_id → null) ends access here too.
async function findSharedLoop(shareId, id) {
  const [row] = await db.select({ loop: referenceLoops }).from(presets)
    .innerJoin(referenceLoops, and(eq(referenceLoops.userId, presets.userId), eq(referenceLoops.id, id)))
    .where(and(eq(presets.shareId, shareId), sql`${presets.state} -> 'referenceTrack' ->> 'id' = ${id}`))
    .limit(1)
  return row?.loop ?? null
}

// Resolve a loop the caller may read: their own, or one behind a share link.
export async function findReadableLoop({ userId, shareId, id }) {
  if (userId) {
    const own = await findLoop(userId, id)
    if (own) return own
  }
  if (shareId) return findSharedLoop(shareId, id)
  return null
}

// A URL the browser can fetch the audio from. Private stores get a signed URL
// that expires in minutes; a public store's URL is already unguessable.
export async function loopDownloadUrl(row) {
  const { token, access } = loopBlobConfig()
  if (access === 'public') return row.url
  if (!token) throw new StorageLimitError('unavailable', 'Loop storage is not configured', 503)
  const validUntil = Date.now() + DOWNLOAD_URL_TTL_MS
  const signed = await issueSignedToken({ token, pathname: row.pathname, operations: ['get'], validUntil })
  const { presignedUrl } = await presignUrl(signed, { operation: 'get', pathname: row.pathname, access })
  return presignedUrl
}

export function loopErrorResponse(err) {
  if (!(err instanceof StorageLimitError)) return null
  return Response.json({ error: err.message, code: err.code }, { status: err.status })
}
