// Pure window maths for lib/server/rateCounter.js, split out so it can be tested
// without a database. A null windowMs is a lifetime budget.

const LIFETIME_EXPIRY = new Date('9999-12-31T00:00:00Z')

export const MINUTE_MS = 60e3
export const HOUR_MS = 3600e3
export const DAY_MS = 86400e3

export function rateWindow(key, windowMs, now = new Date()) {
  if (!windowMs) return { id: `${key}:lifetime`, expiresAt: LIFETIME_EXPIRY }
  const bucket = Math.floor(now.getTime() / windowMs)
  return { id: `${key}:${bucket}`, expiresAt: new Date((bucket + 1) * windowMs) }
}
