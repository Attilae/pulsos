// /api/presets/:id/share — toggle a public share link for a preset (owner only).
//   POST   → ensure a share token exists, return { shareId } (idempotent)
//   DELETE → remove the share token (unshare)
import { and, eq } from 'drizzle-orm'
import { auth } from '@/lib/auth.js'
import { db } from '@/lib/db/index.js'
import { presets } from '@/lib/db/schema.js'

async function requireUser(req) {
  const session = await auth.api.getSession({ headers: req.headers })
  return session?.user ?? null
}

export async function POST(req, { params }) {
  const u = await requireUser(req)
  if (!u) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params

  const [existing] = await db
    .select({ shareId: presets.shareId })
    .from(presets)
    .where(and(eq(presets.id, id), eq(presets.userId, u.id)))
    .limit(1)

  if (!existing) return Response.json({ error: 'not found' }, { status: 404 })
  if (existing.shareId) return Response.json({ shareId: existing.shareId })

  const shareId = `shr_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`
  await db
    .update(presets)
    .set({ shareId })
    .where(and(eq(presets.id, id), eq(presets.userId, u.id)))

  return Response.json({ shareId })
}

export async function DELETE(req, { params }) {
  const u = await requireUser(req)
  if (!u) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params

  await db
    .update(presets)
    .set({ shareId: null })
    .where(and(eq(presets.id, id), eq(presets.userId, u.id)))

  return Response.json({ ok: true })
}
