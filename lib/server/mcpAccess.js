import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../db/index.js'
import { oauthAccessToken, oauthClient, oauthConsent, oauthRefreshToken } from '../db/schema.js'

export async function hasActiveMcpConsent(userId, clientId) {
  if (!userId || !clientId) return false
  const [row] = await db.select({ id: oauthConsent.id })
    .from(oauthConsent)
    .where(and(eq(oauthConsent.userId, userId), eq(oauthConsent.clientId, clientId)))
    .limit(1)
  return Boolean(row)
}

export async function listMcpConnections(userId) {
  return db.select({
    id: oauthConsent.id,
    clientId: oauthConsent.clientId,
    name: oauthClient.name,
    scopes: oauthConsent.scopes,
    createdAt: oauthConsent.createdAt,
  }).from(oauthConsent)
    .leftJoin(oauthClient, eq(oauthConsent.clientId, oauthClient.clientId))
    .where(eq(oauthConsent.userId, userId))
}

export async function disconnectMcpClient(userId, consentId) {
  return db.transaction(async (tx) => {
    const [consent] = await tx.delete(oauthConsent)
      .where(and(eq(oauthConsent.id, consentId), eq(oauthConsent.userId, userId)))
      .returning({ clientId: oauthConsent.clientId })
    if (!consent) return false

    await tx.delete(oauthConsent).where(and(
      eq(oauthConsent.userId, userId),
      eq(oauthConsent.clientId, consent.clientId),
    ))

    const now = new Date()
    await tx.update(oauthRefreshToken).set({ revoked: now })
      .where(and(
        eq(oauthRefreshToken.userId, userId),
        eq(oauthRefreshToken.clientId, consent.clientId),
        isNull(oauthRefreshToken.revoked),
      ))
    await tx.update(oauthAccessToken).set({ revoked: now })
      .where(and(
        eq(oauthAccessToken.userId, userId),
        eq(oauthAccessToken.clientId, consent.clientId),
        isNull(oauthAccessToken.revoked),
      ))
    return true
  })
}
