import { auth, MCP_ENABLED } from '@/lib/auth.js'
import { disconnectMcpClient, listMcpConnections } from '@/lib/server/mcpAccess.js'

export const runtime = 'nodejs'

async function requireUser(req) {
  const session = await auth.api.getSession({ headers: req.headers })
  return session?.user ?? null
}

export async function GET(req) {
  if (!MCP_ENABLED) return Response.json({ error: 'not enabled' }, { status: 404 })
  const user = await requireUser(req)
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const rows = await listMcpConnections(user.id)
  const byClient = new Map()
  for (const row of rows) {
    if (byClient.has(row.clientId)) continue
    byClient.set(row.clientId, {
      id: row.id,
      clientId: row.clientId,
      name: row.name || row.clientId,
      scopes: row.scopes,
      createdAt: row.createdAt?.getTime?.() ?? row.createdAt,
    })
  }
  return Response.json([...byClient.values()], { headers: { 'Cache-Control': 'private, no-store' } })
}

export async function DELETE(req) {
  if (!MCP_ENABLED) return Response.json({ error: 'not enabled' }, { status: 404 })
  if (req.headers.get('origin') !== new URL(req.url).origin) {
    return Response.json({ error: 'forbidden origin' }, { status: 403 })
  }
  const user = await requireUser(req)
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => null)
  if (typeof body?.id !== 'string' || !body.id || body.id.length > 128) {
    return Response.json({ error: 'connection id required' }, { status: 400 })
  }
  if (!await disconnectMcpClient(user.id, body.id)) {
    return Response.json({ error: 'connection not found' }, { status: 404 })
  }
  return Response.json({ ok: true })
}
