import { oauthProviderAuthServerMetadata } from '@better-auth/oauth-provider'
import { auth } from '@/lib/auth.js'

export const runtime = 'nodejs'
export const GET = oauthProviderAuthServerMetadata(auth)
