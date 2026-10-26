// /api/presets/:id — read (GET), upsert (PUT), delete (DELETE), user-scoped.
import { auth } from '@/lib/auth.js'
import { deleteSong, getSong, upsertSong, StorageLimitError } from '@/lib/server/presets.js'
import { validateRecordId } from '@/lib/storageLimits.js'

async function requireUser(req) {
  const session = await auth.api.getSession({ headers: req.headers })
  return session?.user ?? null
}

export async function GET(req, { params }) {
  const user = await requireUser(req)
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  const song = await getSong(user.id, id)
  if (!song) return Response.json({ error: 'not found' }, { status: 404 })
  return Response.json(song)
}

export async function PUT(req, { params }) {
  const user = await requireUser(req)
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  const body = await req.json().catch(() => null)
  if (!body) return Response.json({ error: 'body required' }, { status: 400 })
  if (!validateRecordId(id)) return Response.json({ error: 'invalid id' }, { status: 400 })
  let song
  try {
    song = await upsertSong(user.id, id, body)
  } catch (err) {
    if (err instanceof StorageLimitError) {
      return Response.json({ error: err.message, code: err.code }, { status: err.status })
    }
    throw err
  }
  if (!song) return Response.json({ error: 'conflict' }, { status: 409 })
  return Response.json(song)
}

export async function DELETE(req, { params }) {
  const user = await requireUser(req)
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  await deleteSong(user.id, id)
  return Response.json({ ok: true })
}
