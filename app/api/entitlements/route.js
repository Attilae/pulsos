import { auth } from '@/lib/auth.js'
import { getEntitlements } from '@/lib/billing/server.js'

export async function GET(req) {
  const session = await auth.api.getSession({ headers: req.headers })
  if (!session?.user) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const entitlements = await getEntitlements(session.user.id)
  return Response.json(entitlements, { headers: { 'Cache-Control': 'private, no-store' } })
}
