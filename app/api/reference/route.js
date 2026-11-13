// /api/reference — the signed-in user's stored reference loops ("Your loop").
//   GET  → { loops, limit, maxBytes, access, enabled }
//   POST → record a finished browser upload { id, name, bytes, durationSec, pathname }
import { auth } from '@/lib/auth.js'
import { getEntitlements } from '@/lib/billing/server.js'
import { REFERENCE_CLOUD_MAX_BYTES } from '@/lib/referenceLoops.js'
import { listLoops, loopBlobConfig, loopErrorResponse, registerLoop } from '@/lib/server/referenceLoops.js'

const NO_STORE = { 'Cache-Control': 'private, no-store' }

async function requireUser(req) {
  const session = await auth.api.getSession({ headers: req.headers })
  return session?.user ?? null
}

export async function GET(req) {
  const user = await requireUser(req)
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const [entitlements, loops] = await Promise.all([getEntitlements(user.id), listLoops(user.id)])
  const { access, enabled } = loopBlobConfig()
  return Response.json({
    userId: user.id,
    loops,
    limit: entitlements.limits.referenceLoops ?? null,
    plan: entitlements.plan,
    maxBytes: REFERENCE_CLOUD_MAX_BYTES,
    access,
    enabled,
  }, { headers: NO_STORE })
}

export async function POST(req) {
  const user = await requireUser(req)
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })
  let body
  try { body = await req.json() } catch { return Response.json({ error: 'invalid body' }, { status: 400 }) }
  try {
    const entitlements = await getEntitlements(user.id)
    const loop = await registerLoop(user.id, body, {
      limit: entitlements.limits.referenceLoops ?? null, plan: entitlements.plan,
    })
    return Response.json({ loop }, { status: 201, headers: NO_STORE })
  } catch (err) {
    const refused = loopErrorResponse(err)
    if (refused) return refused
    console.error('[reference] register failed', err)
    return Response.json({ error: 'Could not store the loop' }, { status: 500 })
  }
}
