import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { eq, lte } from 'drizzle-orm'
import { db } from '@/lib/db/index.js'
import { billingSubscriptions, billingWebhookEvents } from '@/lib/db/schema.js'

const SUBSCRIPTION_EVENTS = new Set([
  'subscription_created', 'subscription_updated', 'subscription_cancelled',
  'subscription_resumed', 'subscription_expired', 'subscription_paused',
  'subscription_unpaused', 'subscription_plan_changed',
  'subscription_payment_failed', 'subscription_payment_success',
  'subscription_payment_recovered',
])

export async function POST(req) {
  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET
  if (!secret) return Response.json({ error: 'webhook_not_configured' }, { status: 503 })
  const raw = await req.text()
  const signature = req.headers.get('x-signature') ?? ''
  if (!validSignature(raw, signature, secret)) {
    return Response.json({ error: 'invalid_signature' }, { status: 401 })
  }

  const payload = JSON.parse(raw)
  const eventName = payload?.meta?.event_name || req.headers.get('x-event-name') || 'unknown'
  const eventId = createHash('sha256').update(`${eventName}:${raw}`).digest('hex')
  const expectedStoreId = process.env.LEMONSQUEEZY_STORE_ID
  const allowedVariants = new Set([
    process.env.LEMONSQUEEZY_VARIANT_ID_MONTHLY,
    process.env.LEMONSQUEEZY_VARIANT_ID_ANNUAL,
  ].filter(Boolean).map(String))

  await db.transaction(async tx => {
    const [claimedEvent] = await tx
      .insert(billingWebhookEvents)
      .values({ id: eventId, eventName })
      .onConflictDoNothing()
      .returning({ id: billingWebhookEvents.id })
    if (!claimedEvent || !SUBSCRIPTION_EVENTS.has(eventName) || payload?.data?.type !== 'subscriptions') return

    const attrs = payload.data.attributes ?? {}
    const subscriptionId = String(payload.data.id)
    if (expectedStoreId && String(attrs.store_id) !== String(expectedStoreId)) return
    if (allowedVariants.size && !allowedVariants.has(String(attrs.variant_id))) return

    const [existing] = await tx
      .select()
      .from(billingSubscriptions)
      .where(eq(billingSubscriptions.id, subscriptionId))
      .limit(1)
    const userId = payload?.meta?.custom_data?.user_id ?? existing?.userId
    if (!userId) throw new Error(`Subscription ${subscriptionId} has no user_id custom data`)

    const providerUpdatedAt = parseDate(attrs.updated_at) ?? new Date()
    const values = {
      id: subscriptionId,
      userId: String(userId),
      customerId: String(attrs.customer_id),
      storeId: String(attrs.store_id),
      productId: String(attrs.product_id),
      variantId: String(attrs.variant_id),
      status: String(attrs.status),
      trialEndsAt: parseDate(attrs.trial_ends_at),
      renewsAt: parseDate(attrs.renews_at),
      endsAt: parseDate(attrs.ends_at),
      providerUpdatedAt,
      testMode: !!attrs.test_mode,
      updatedAt: new Date(),
    }
    await tx
      .insert(billingSubscriptions)
      .values(values)
      .onConflictDoUpdate({
        target: billingSubscriptions.id,
        set: values,
        where: lte(billingSubscriptions.providerUpdatedAt, providerUpdatedAt),
      })
  })

  return Response.json({ ok: true })
}

function validSignature(raw, signature, secret) {
  if (!/^[a-f0-9]{64}$/i.test(signature)) return false
  const expected = createHmac('sha256', secret).update(raw).digest('hex')
  return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'))
}

function parseDate(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}
