// /api/presets/:id — read (GET), upsert (PUT), delete (DELETE), user-scoped.
import { and, eq } from 'drizzle-orm'
import { auth } from '@/lib/auth.js'
import { db } from '@/lib/db/index.js'
import { presets } from '@/lib/db/schema.js'
import { serialize } from '../route.js'

async function requireUser(req) {
  const session = await auth.api.getSession({ headers: req.headers })
  return session?.user ?? null
}

export async function GET(req, { params }) {
  const u = await requireUser(req)
  if (!u) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params

  const [row] = await db
    .select()
    .from(presets)
    .where(and(eq(presets.id, id), eq(presets.userId, u.id)))
    .limit(1)

  if (!row) return Response.json({ error: 'not found' }, { status: 404 })
  return Response.json(serialize(row))
}

// PUT { name, state, schemaVersion } — update; creates if absent (upsert) so the
// client's saveSong() works whether the song is new or existing.
export async function PUT(req, { params }) {
  const u = await requireUser(req)
  if (!u) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params

  const body = await req.json().catch(() => null)
  if (!body) return Response.json({ error: 'body required' }, { status: 400 })

  const now = new Date()
  const [row] = await db
    .insert(presets)
    .values({
      id,
      userId: u.id,
      name: body.name ?? 'Untitled',
      schemaVersion: body.schemaVersion ?? 1,
      state: body.state ?? {},
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: presets.id,
      set: {
        name: body.name ?? 'Untitled',
        schemaVersion: body.schemaVersion ?? 1,
        state: body.state ?? {},
        updatedAt: now,
      },
      // Don't let a user overwrite another user's row of the same id.
      where: eq(presets.userId, u.id),
    })
    .returning()

  if (!row) return Response.json({ error: 'conflict' }, { status: 409 })
  return Response.json(serialize(row))
}

export async function DELETE(req, { params }) {
  const u = await requireUser(req)
  if (!u) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params

  await db.delete(presets).where(and(eq(presets.id, id), eq(presets.userId, u.id)))
  return Response.json({ ok: true })
}
