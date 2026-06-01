// /api/shared/:shareId — public, read-only view of a shared preset. No auth:
// anyone with the link can read the song (and import a copy client-side).
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/index.js'
import { presets } from '@/lib/db/schema.js'

export async function GET(_req, { params }) {
  const { shareId } = await params

  const [row] = await db
    .select({ name: presets.name, state: presets.state, schemaVersion: presets.schemaVersion })
    .from(presets)
    .where(eq(presets.shareId, shareId))
    .limit(1)

  if (!row) return Response.json({ error: 'not found' }, { status: 404 })

  // Only the song payload — never the owner id or share token.
  return Response.json({
    name: row.name,
    state: row.state,
    schemaVersion: row.schemaVersion,
  })
}
