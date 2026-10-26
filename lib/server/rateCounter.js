// Atomic fixed-window counters (table `rate_counters`). consumeBudget adds
// `amount` only if the window stays within `limit`, in one statement, so it is
// the admission check and the record at once.
import { lt, sql } from 'drizzle-orm'
import { db } from '../db/index.js'
import { rateCounters } from '../db/schema.js'
import { rateWindow } from '../rateWindow.js'

const SWEEP_PROBABILITY = 0.01

export async function consumeBudget(key, { limit, windowMs = null, amount = 1, now = new Date() }) {
  if (limit == null) return { allowed: true, count: null }
  if (amount > limit) return { allowed: false, count: null }
  const { id, expiresAt } = rateWindow(key, windowMs, now)
  const [row] = await db
    .insert(rateCounters)
    .values({ id, count: amount, expiresAt })
    .onConflictDoUpdate({
      target: rateCounters.id,
      set: { count: sql`${rateCounters.count} + ${amount}` },
      where: sql`${rateCounters.count} + ${amount} <= ${limit}`,
    })
    .returning({ count: rateCounters.count })
  if (Math.random() < SWEEP_PROBABILITY) {
    db.delete(rateCounters).where(lt(rateCounters.expiresAt, now)).catch(() => {})
  }
  return row ? { allowed: true, count: row.count } : { allowed: false, count: null }
}
