// /api/presets — list (GET) and create (POST), scoped to the signed-in user.
import { eq, desc } from 'drizzle-orm'
import { auth } from '@/lib/auth.js'
import { db } from '@/lib/db/index.js'
import { presets } from '@/lib/db/schema.js'

async function requireUser(req) {
  const session = await auth.api.getSession({ headers: req.headers })
  return session?.user ?? null
}

// GET → [{ id, name, updatedAt }] — the song index.
export async function GET(req) {
  const u = await requireUser(req)
  if (!u) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const rows = await db
    .select({ id: presets.id, name: presets.name, shareId: presets.shareId, updatedAt: presets.updatedAt })
    .from(presets)
    .where(eq(presets.userId, u.id))
    .orderBy(desc(presets.updatedAt))

  return Response.json(rows.map((r) => ({
    id: r.id,
    name: r.name,
    shareId: r.shareId,
    updatedAt: r.updatedAt?.getTime?.() ?? r.updatedAt,
  })))
}

// POST { id, name, state, schemaVersion } → full saved song.
export async function POST(req) {
  const u = await requireUser(req)
  if (!u) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (!body?.id || !body?.name || body?.state == null) {
    return Response.json({ error: 'id, name, state required' }, { status: 400 })
  }

  const now = new Date()
  const [row] = await db
    .insert(presets)
    .values({
      id: body.id,
      userId: u.id,
      name: body.name,
      schemaVersion: body.schemaVersion ?? 1,
      state: body.state,
      createdAt: now,
      updatedAt: now,
    })
    .returning()

  return Response.json(serialize(row), { status: 201 })
}

export function serialize(row) {
  return {
    schemaVersion: row.schemaVersion,
    id: row.id,
    name: row.name,
    state: row.state,
    shareId: row.shareId ?? null,
    createdAt: row.createdAt?.getTime?.() ?? row.createdAt,
    updatedAt: row.updatedAt?.getTime?.() ?? row.updatedAt,
  }
}
