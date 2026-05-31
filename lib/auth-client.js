// Better Auth React client (browser). Used by sign-in UI and the persistence
// layer's session check.
'use client'

import { createAuthClient } from 'better-auth/react'
import { magicLinkClient } from 'better-auth/client/plugins'

export const authClient = createAuthClient({
  // Same-origin in the Next.js app; falls back to env for split deployments.
  baseURL: process.env.NEXT_PUBLIC_APP_URL || undefined,
  plugins: [magicLinkClient()],
})

export const { signIn, signUp, signOut, useSession, getSession } = authClient
