// Mounts every Better Auth endpoint under /api/auth/*.
import { toNextJsHandler } from 'better-auth/next-js'
import { auth } from '@/lib/auth.js'

export const { GET, POST } = toNextJsHandler(auth)
