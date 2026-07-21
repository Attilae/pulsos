import { auth } from '@/lib/auth.js'
import { claimUsage } from '@/lib/billing/server.js'

export async function POST(req) {
  const session = await auth.api.getSession({ headers: req.headers })
  if (!session?.user) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { metric } = await req.json().catch(() => ({}))
  const result = await claimUsage(session.user.id, metric)
  if (!result.allowed) {
    return Response.json(result, { status: result.reason === 'unknown_metric' ? 400 : 403 })
  }
  return Response.json(result)
}
