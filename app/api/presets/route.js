// /api/presets — list (GET) and create (POST), scoped to the signed-in user.
import { auth } from '@/lib/auth.js'
import { createSong, listSongs, StorageLimitError } from '@/lib/server/presets.js'
import { validateRecordId } from '@/lib/storageLimits.js'

async function requireUser(req) {
  const session = await auth.api.getSession({ headers: req.headers })
  return session?.user ?? null
}

export async function GET(req) {
  const user = await requireUser(req)
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })
  return Response.json(await listSongs(user.id))
}

export async function POST(req) {
  const user = await requireUser(req)
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (!validateRecordId(body?.id) || !body?.name || body?.state == null) {
    return Response.json({ error: 'id, name, state required' }, { status: 400 })
  }
  try {
    return Response.json(await createSong(user.id, body), { status: 201 })
  } catch (err) {
    if (err instanceof StorageLimitError) {
      return Response.json({ error: err.message, code: err.code }, { status: err.status })
    }
    throw err
  }
}
