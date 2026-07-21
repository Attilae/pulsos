import { and, desc, eq, lt, sql } from 'drizzle-orm'
import { db } from '@/lib/db/index.js'
import {
  billingSubscriptions, entitlementOverrides, entitlementUsage, user,
} from '@/lib/db/schema.js'
import {
  isSubscriptionEntitled, resolveAccess, usagePeriod,
} from './plans.js'

function paidVariantIds() {
  return new Set([
    process.env.LEMONSQUEEZY_VARIANT_ID_MONTHLY,
    process.env.LEMONSQUEEZY_VARIANT_ID_ANNUAL,
  ].filter(Boolean).map(String))
}

export async function getLatestSubscription(userId) {
  const rows = await db
    .select()
    .from(billingSubscriptions)
    .where(eq(billingSubscriptions.userId, userId))
    .orderBy(desc(billingSubscriptions.providerUpdatedAt))
    .limit(10)
  const variants = paidVariantIds()
  return rows.find(row => variants.has(String(row.variantId))) ?? null
}

export async function getEntitlements(userId, now = new Date()) {
  const [subscription, accountRows, overrideRows] = await Promise.all([
    getLatestSubscription(userId),
    db.select({ role: user.role }).from(user).where(eq(user.id, userId)).limit(1),
    db.select().from(entitlementOverrides)
      .where(eq(entitlementOverrides.userId, userId)).limit(1),
  ])
  const account = accountRows[0]
  const override = overrideRows[0]
  const { plan, accessSource, limits } = resolveAccess({
    role: account?.role,
    override,
    subscription,
  }, now)
  const exportPeriod = usagePeriod(plan, 'export', now)
  const aiPeriod = usagePeriod(plan, 'ai', now)
  const ids = [usageId(userId, 'export', exportPeriod), usageId(userId, 'ai', aiPeriod)]
  const usageRows = await Promise.all(ids.map(async id => {
    const [row] = await db.select().from(entitlementUsage).where(eq(entitlementUsage.id, id)).limit(1)
    return row
  }))
  const used = {
    export: usageRows[0]?.count ?? 0,
    ai: usageRows[1]?.count ?? 0,
  }

  return {
    plan,
    isPro: plan === 'pro',
    accessSource,
    limits,
    usage: {
      export: usageView(used.export, limits.exports, exportPeriod),
      ai: usageView(used.ai, limits.ai, aiPeriod),
    },
    subscription: subscription ? {
      status: subscription.status,
      entitled: isSubscriptionEntitled(subscription, now),
      renewsAt: dateJson(subscription.renewsAt),
      trialEndsAt: dateJson(subscription.trialEndsAt),
      endsAt: dateJson(subscription.endsAt),
    } : null,
    override: accessSource === 'override' ? {
      expiresAt: dateJson(override.expiresAt),
    } : null,
  }
}

export async function claimUsage(userId, metric, now = new Date()) {
  if (!['export', 'ai'].includes(metric)) return { allowed: false, reason: 'unknown_metric' }
  const entitlements = await getEntitlements(userId, now)
  const limit = metric === 'export'
    ? entitlements.limits.exports
    : entitlements.limits.ai
  const period = usagePeriod(entitlements.plan, metric, now)
  if (limit == null) return { allowed: true, metered: false, entitlements }

  const id = usageId(userId, metric, period)
  const [row] = await db
    .insert(entitlementUsage)
    .values({ id, userId, metric, period, count: 1, updatedAt: now })
    .onConflictDoUpdate({
      target: entitlementUsage.id,
      set: { count: sql`${entitlementUsage.count} + 1`, updatedAt: now },
      where: lt(entitlementUsage.count, limit),
    })
    .returning()

  if (!row) return { allowed: false, reason: 'limit_reached', entitlements }
  return {
    allowed: true,
    metered: true,
    remaining: Math.max(0, limit - row.count),
    entitlements: await getEntitlements(userId, now),
  }
}

export async function releaseUsage(userId, metric, now = new Date()) {
  const entitlements = await getEntitlements(userId, now)
  const period = usagePeriod(entitlements.plan, metric, now)
  const id = usageId(userId, metric, period)
  await db
    .update(entitlementUsage)
    .set({ count: sql`GREATEST(${entitlementUsage.count} - 1, 0)`, updatedAt: now })
    .where(and(eq(entitlementUsage.id, id), eq(entitlementUsage.userId, userId)))
}

export function compositionLimitError(entitlements, items) {
  const limit = entitlements.limits.compositionItems
  if (limit == null || (Array.isArray(items) && items.length <= limit)) return null
  return {
    error: 'composition_item_limit',
    message: `Free compositions can contain up to ${limit} presets.`,
    limit,
  }
}

function usageId(userId, metric, period) {
  return `${userId}:${metric}:${period}`
}

function usageView(used, limit, period) {
  return { used, limit, remaining: limit == null ? null : Math.max(0, limit - used), period }
}

function dateJson(value) {
  return value ? new Date(value).toISOString() : null
}
