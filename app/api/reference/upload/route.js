// /api/reference/upload — issues the short-lived token a browser needs to send
// a loop straight to Vercel Blob (function bodies are capped at 4.5 MB, so the
// audio can't pass through here). Signed-in users only; the token is bound to
// the caller's own pathname, an audio content type and the size cap. The
// upload is recorded afterwards by POST /api/reference, which re-checks it.
import { handleUpload } from '@vercel/blob/client'
import { auth } from '@/lib/auth.js'
import { getEntitlements } from '@/lib/billing/server.js'
import {
  REFERENCE_CLOUD_MAX_BYTES, REFERENCE_CONTENT_TYPES, loopPathname, validateLoopMeta,
} from '@/lib/referenceLoops.js'
import { admitLoopUpload, loopBlobConfig, loopErrorResponse } from '@/lib/server/referenceLoops.js'
import { StorageLimitError } from '@/lib/server/presets.js'

export async function POST(req) {
  const session = await auth.api.getSession({ headers: req.headers })
  const user = session?.user
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { token, enabled } = loopBlobConfig()
  if (!enabled) return Response.json({ error: 'Loop storage is not configured', code: 'unavailable' }, { status: 503 })

  let body
  try { body = await req.json() } catch { return Response.json({ error: 'invalid body' }, { status: 400 }) }
  // Only token requests are served: completion is confirmed by POST /api/reference.
  if (body?.type !== 'blob.generate-client-token') return Response.json({ error: 'unsupported' }, { status: 400 })

  try {
    const result = await handleUpload({
      token,
      request: req,
      body,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        let payload = null
        try { payload = JSON.parse(clientPayload ?? '') } catch { /* refused below */ }
        const meta = validateLoopMeta(payload)
        if (!meta.ok) throw new StorageLimitError(meta.code ?? 'invalid_loop', meta.error, 400)
        if (pathname !== loopPathname(user.id, meta.value.id, meta.value.name)) {
          throw new StorageLimitError('invalid_loop', 'Invalid upload path', 400)
        }
        const entitlements = await getEntitlements(user.id)
        await admitLoopUpload(user.id, meta.value.id, {
          limit: entitlements.limits.referenceLoops ?? null, plan: entitlements.plan,
        })
        return {
          allowedContentTypes: REFERENCE_CONTENT_TYPES,
          maximumSizeInBytes: REFERENCE_CLOUD_MAX_BYTES,
          addRandomSuffix: true,
          validUntil: Date.now() + 10 * 60 * 1000,
        }
      },
    })
    return Response.json(result)
  } catch (err) {
    const refused = loopErrorResponse(err)
    if (refused) return refused
    console.error('[reference] upload token failed', err)
    return Response.json({ error: 'Could not start the upload' }, { status: 400 })
  }
}
