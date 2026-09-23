import { requireMcpAuth } from '@better-auth/mcp'
import { createMcpHandler } from '@modelcontextprotocol/server'
import { auth, MCP_ENABLED, MCP_RESOURCE } from '@/lib/auth.js'
import { getEntitlements } from '@/lib/billing/server.js'
import { createLeidMcpServer } from '@/lib/server/mcpTools.js'
import { hasActiveMcpConsent } from '@/lib/server/mcpAccess.js'

export const runtime = 'nodejs'

const protectedPost = requireMcpAuth(auth, async (request, claims) => {
  const userId = claims?.sub
  if (!userId) return new Response('Invalid account', { status: 401 })

  const entitlement = await getEntitlements(userId)
  if (!entitlement.isPro) return new Response('Leið Pro is required', { status: 403 })
  if (!await hasActiveMcpConsent(userId, claims.azp ?? claims.client_id)) {
    return new Response('MCP client authorization has been revoked', { status: 403 })
  }

  const handler = createMcpHandler(() => createLeidMcpServer(userId), { legacy: 'reject' })

  return handler.fetch(request)
}, { resource: MCP_RESOURCE })

export async function POST(request) {
  if (!MCP_ENABLED) return new Response('MCP is not enabled', { status: 503 })
  const allowedOrigin = new URL(MCP_RESOURCE).origin
  const requestOrigin = new URL(request.url).origin
  const callerOrigin = request.headers.get('origin')
  if (requestOrigin !== allowedOrigin || (callerOrigin && callerOrigin !== allowedOrigin)) {
    return new Response('Forbidden origin', { status: 403 })
  }
  if (Number(request.headers.get('content-length')) > 1_000_000) {
    return new Response('Request too large', { status: 413 })
  }
  return protectedPost(request)
}
