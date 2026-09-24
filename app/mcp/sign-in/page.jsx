'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AuthForm } from '@/components/AuthControl.jsx'
import { authClient } from '@/lib/auth-client.js'
import { McpShell, ClientChip, styles } from '../McpCard.jsx'

export default function McpSignInPage() {
  const { data: session } = authClient.useSession()
  const [clientId, setClientId] = useState('')
  const callbackURL = typeof window === 'undefined'
    ? '/mcp/sign-in'
    : `${window.location.pathname}${window.location.search}`

  // Better Auth sends the original authorize query here, so the requesting
  // client is known before the user signs in.
  useEffect(() => {
    setClientId(new URLSearchParams(window.location.search).get('client_id') || '')
  }, [])

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_MCP_ENABLED !== 'true' || !session?.user) return
    const query = window.location.search
    if (new URLSearchParams(query).has('sig')) {
      window.location.assign(`/api/auth/oauth2/authorize${query}`)
    }
  }, [session?.user])

  if (process.env.NEXT_PUBLIC_MCP_ENABLED !== 'true') {
    return <McpShell><p className={styles.status}>AI client connections are not available yet. <Link href="/">Return to Leið</Link></p></McpShell>
  }

  return (
    <McpShell>
      <h1 className={styles.title}>Sign in to connect</h1>
      <p className={styles.lede}>Sign in to your Leið account to continue connecting your AI client.</p>
      <ClientChip clientId={clientId} />
      {session?.user
        ? <p className={styles.status}>Signed in — continuing authorization…</p>
        : <AuthForm
            className={styles.authForm}
            onDone={() => window.location.assign(`/api/auth/oauth2/authorize${window.location.search}`)}
            callbackURL={callbackURL}
          />}
      <p className={styles.footer}><Link href="/">← Return to Leið</Link></p>
    </McpShell>
  )
}
