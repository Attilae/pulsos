import { auth } from '@/lib/auth.js'
import { getEntitlements } from '@/lib/billing/server.js'

const LEMON_API = 'https://api.lemonsqueezy.com/v1'

export async function POST(req) {
  const session = await auth.api.getSession({ headers: req.headers })
  if (!session?.user) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const { period } = await req.json().catch(() => ({}))
  const variantId = period === 'annual'
    ? process.env.LEMONSQUEEZY_VARIANT_ID_ANNUAL
    : period === 'monthly'
      ? process.env.LEMONSQUEEZY_VARIANT_ID_MONTHLY
      : null
  const storeId = process.env.LEMONSQUEEZY_STORE_ID
  const apiKey = process.env.LEMONSQUEEZY_API_KEY
  if (!variantId) return Response.json({ error: 'invalid_billing_period' }, { status: 400 })
  if (!storeId || !apiKey) return Response.json({ error: 'billing_not_configured' }, { status: 503 })
  const entitlements = await getEntitlements(session.user.id)
  if (entitlements.isPro) return Response.json({ error: 'already_subscribed' }, { status: 409 })

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.BETTER_AUTH_URL || req.nextUrl.origin
  const response = await fetch(`${LEMON_API}/checkouts`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.api+json',
      'Content-Type': 'application/vnd.api+json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      data: {
        type: 'checkouts',
        attributes: {
          product_options: {
            redirect_url: `${appUrl.replace(/\/$/, '')}/?billing=success`,
            receipt_button_text: 'Return to Leið',
            receipt_link_url: `${appUrl.replace(/\/$/, '')}/?billing=success`,
          },
          checkout_options: { embed: false },
          checkout_data: {
            email: session.user.email,
            name: session.user.name || undefined,
            custom: { user_id: session.user.id },
          },
        },
        relationships: {
          store: { data: { type: 'stores', id: String(storeId) } },
          variant: { data: { type: 'variants', id: String(variantId) } },
        },
      },
    }),
  })

  const data = await response.json().catch(() => null)
  if (!response.ok) {
    console.error('[billing] checkout failed', response.status, data)
    return Response.json({ error: 'checkout_failed' }, { status: 502 })
  }
  return Response.json({ url: data?.data?.attributes?.url })
}
