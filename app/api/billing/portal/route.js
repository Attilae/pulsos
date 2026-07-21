import { auth } from '@/lib/auth.js'
import { getLatestSubscription } from '@/lib/billing/server.js'

const LEMON_API = 'https://api.lemonsqueezy.com/v1'

export async function POST(req) {
  const session = await auth.api.getSession({ headers: req.headers })
  if (!session?.user) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const subscription = await getLatestSubscription(session.user.id)
  if (!subscription) return Response.json({ error: 'subscription_not_found' }, { status: 404 })
  const apiKey = process.env.LEMONSQUEEZY_API_KEY
  if (!apiKey) return Response.json({ error: 'billing_not_configured' }, { status: 503 })

  const response = await fetch(`${LEMON_API}/subscriptions/${encodeURIComponent(subscription.id)}`, {
    headers: { Accept: 'application/vnd.api+json', Authorization: `Bearer ${apiKey}` },
  })
  const data = await response.json().catch(() => null)
  const url = data?.data?.attributes?.urls?.customer_portal
  if (!response.ok || !url) return Response.json({ error: 'portal_unavailable' }, { status: 502 })
  return Response.json({ url })
}
