// Better Auth React client (browser). Used by sign-in UI and the persistence
// layer's session check.
'use client'

import { useEffect, useRef } from 'react'
import { createAuthClient } from 'better-auth/react'
import { magicLinkClient } from 'better-auth/client/plugins'
import { oauthProviderClient } from '@better-auth/oauth-provider/client'
import posthog from 'posthog-js'

export const authClient = createAuthClient({
  // Same-origin in the Next.js app; falls back to env for split deployments.
  baseURL: process.env.NEXT_PUBLIC_APP_URL || undefined,
  plugins: [magicLinkClient(), oauthProviderClient()],
})

export const { signIn, signUp, signOut, useSession, getSession } = authClient

const isPostHogConfigured = Boolean(
  process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN && process.env.NEXT_PUBLIC_POSTHOG_HOST,
)

export function PostHogIdentity() {
  const { data: session, isPending } = useSession()
  const identifiedUserId = useRef(null)

  useEffect(() => {
    if (isPending || !isPostHogConfigured) return

    const user = session?.user
    const currentUserId = identifiedUserId.current ?? posthog.get_property('$user_id')
    if (!user?.id) {
      if (currentUserId) posthog.reset()
      identifiedUserId.current = null
      return
    }

    if (currentUserId && currentUserId !== user.id) posthog.reset()

    const personProperties = {}
    if (user.email) personProperties.email = user.email
    if (user.name) personProperties.name = user.name
    posthog.identify(user.id, personProperties)
    identifiedUserId.current = user.id
  }, [isPending, session?.user?.id, session?.user?.email, session?.user?.name])

  return null
}
