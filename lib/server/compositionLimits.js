// Storage policy for Song Chainer compositions, mirroring the song budget in
// ./presets.js: record bounds, the shared write throttle and a per-user row cap
// checked under an advisory lock inside the write's transaction.
import { and, eq, ne, sql } from 'drizzle-orm'
import { compositions } from '../db/schema.js'
import { LIBRARY_LIMITS, validateCompositionBody, validateRecordId } from '../storageLimits.js'
import { StorageLimitError, throttleLibraryWrites } from './presets.js'

export async function admitCompositionWrite(userId, id, body) {
  if (!validateRecordId(id)) throw new StorageLimitError('invalid_composition', 'invalid id', 400)
  const checked = validateCompositionBody(body)
  if (!checked.ok) throw new StorageLimitError('invalid_composition', checked.error, 400)
  await throttleLibraryWrites(userId)
}

export async function checkCompositionBudget(tx, userId, id) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`compositions:${userId}`}))`)
  const [row] = await tx.select({ n: sql`count(*)::int` }).from(compositions)
    .where(and(eq(compositions.userId, userId), ne(compositions.id, id)))
  if ((row?.n ?? 0) >= LIBRARY_LIMITS.maxCompositions) {
    throw new StorageLimitError('composition_limit', `You can keep up to ${LIBRARY_LIMITS.maxCompositions} compositions; delete some to save more.`, 403)
  }
}

export function storageErrorResponse(err) {
  if (!(err instanceof StorageLimitError)) return null
  return Response.json({ error: err.message, code: err.code }, { status: err.status })
}
