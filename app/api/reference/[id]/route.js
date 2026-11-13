// /api/reference/:id
//   GET    → { url, name, bytes } — a short-lived URL to fetch the audio from.
//            The owner reads their own loop; anyone holding a share link reads
//            the loop of that shared song (?shared=<shareId>), signed in or not.
//   DELETE → the owner removes the loop (row + stored file).
import { auth } from '@/lib/auth.js'
import { REFERENCE_LOOP_ID_RE } from '@/lib/referenceLoops.js'
import { HOUR_MS } from '@/lib/rateWindow.js'
import { consumeBudget } from '@/lib/server/rateCounter.js'
import { deleteLoop, findReadableLoop, loopDownloadUrl, loopErrorResponse } from '@/lib/server/referenceLoops.js'

const SHARE_ID_RE = /^shr_[a-f0-9]{8,32}$/
// Download URLs one share link hands out per hour, across all visitors.
const SHARED_DOWNLOADS_PER_HOUR = 600

export async function GET(req, { params }) {
  const { id } = await params
  if (!REFERENCE_LOOP_ID_RE.test(id)) return Response.json({ error: 'not found' }, { status: 404 })
  const shared = new URL(req.url).searchParams.get('shared')
  const shareId = shared && SHARE_ID_RE.test(shared) ? shared : null
  const session = await auth.api.getSession({ headers: req.headers })
  const userId = session?.user?.id ?? null
  if (!userId && !shareId) return Response.json({ error: 'unauthorized' }, { status: 401 })

  try {
    const row = await findReadableLoop({ userId, shareId, id })
    if (!row) return Response.json({ error: 'not found' }, { status: 404 })
    if (row.userId !== userId) {
      const budget = await consumeBudget(`loop_download:share:${shareId}`, { limit: SHARED_DOWNLOADS_PER_HOUR, windowMs: HOUR_MS })
      if (!budget.allowed) return Response.json({ error: 'This loop is busy; try again later.' }, { status: 429 })
    }
    const url = await loopDownloadUrl(row)
    return Response.json({ url, name: row.name, bytes: row.bytes }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (err) {
    const refused = loopErrorResponse(err)
    if (refused) return refused
    console.error('[reference] download failed', err)
    return Response.json({ error: 'Could not load the loop' }, { status: 500 })
  }
}

export async function DELETE(req, { params }) {
  const { id } = await params
  const session = await auth.api.getSession({ headers: req.headers })
  if (!session?.user) return Response.json({ error: 'unauthorized' }, { status: 401 })
  if (!REFERENCE_LOOP_ID_RE.test(id)) return Response.json({ error: 'not found' }, { status: 404 })
  await deleteLoop(session.user.id, id)
  return Response.json({ ok: true })
}
