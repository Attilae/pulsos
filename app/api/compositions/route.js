// /api/compositions — list (GET) and create (POST), scoped to the signed-in user.
import { eq, desc } from 'drizzle-orm'
import { auth } from '@/lib/auth.js'
import { db } from '@/lib/db/index.js'
import { compositions } from '@/lib/db/schema.js'

async function requireUser(req) {
  const session = await auth.api.getSession({ headers: req.headers })
  return session?.user ?? null
}

// GET → [{ id, name, cityId, bpm, updatedAt }] — the composition index.
export async function GET(req) {
  const u = await requireUser(req)
  if (!u) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const rows = await db
    .select({
      id: compositions.id,
      name: compositions.name,
      cityId: compositions.cityId,
      bpm: compositions.bpm,
      updatedAt: compositions.updatedAt,
    })
    .from(compositions)
    .where(eq(compositions.userId, u.id))
    .orderBy(desc(compositions.updatedAt))

  return Response.json(rows.map((r) => ({
    id: r.id,
    name: r.name,
    cityId: r.cityId ?? null,
    bpm: r.bpm,
    updatedAt: r.updatedAt?.getTime?.() ?? r.updatedAt,
  })))
}

// POST { id, name, items, bpm, cityId, schemaVersion } → full saved composition.
export async function POST(req) {
  const u = await requireUser(req)
  if (!u) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (!body?.id || !body?.name || body?.items == null) {
    return Response.json({ error: 'id, name, items required' }, { status: 400 })
  }

  const now = new Date()
  const [row] = await db
    .insert(compositions)
    .values({
      id: body.id,
      userId: u.id,
      name: body.name,
      schemaVersion: body.schemaVersion ?? 1,
      cityId: body.cityId ?? null,
      bpm: body.bpm ?? 120,
      items: body.items,
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
    cityId: row.cityId ?? null,
    bpm: row.bpm,
    items: row.items,
    createdAt: row.createdAt?.getTime?.() ?? row.createdAt,
    updatedAt: row.updatedAt?.getTime?.() ?? row.updatedAt,
  }
}
