'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { AuthForm } from '@/components/AuthControl.jsx'
import { authClient } from '@/lib/auth-client.js'

export default function McpSignInPage() {
  const { data: session } = authClient.useSession()
  const callbackURL = typeof window === 'undefined'
    ? '/mcp/sign-in'
    : `${window.location.pathname}${window.location.search}`

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_MCP_ENABLED !== 'true' || !session?.user) return
    const query = window.location.search
    if (new URLSearchParams(query).has('sig')) {
      window.location.assign(`/api/auth/oauth2/authorize${query}`)
    }
  }, [session?.user])

  if (process.env.NEXT_PUBLIC_MCP_ENABLED !== 'true') {
    return <main style={{ maxWidth: 440, margin: '8vh auto', padding: 24 }}><p>AI client connections are not available yet.</p><Link href="/">Return to Leið</Link></main>
  }

  return (
    <main style={{ maxWidth: 440, margin: '8vh auto', padding: 24 }}>
      <h1>Connect an AI client to Leið</h1>
      <p>Sign in to your Leið account to continue the connection.</p>
      {session?.user
        ? <p>Continuing authorization…</p>
        : <AuthForm onDone={() => window.location.assign(`/api/auth/oauth2/authorize${window.location.search}`)} callbackURL={callbackURL} />}
      <p><Link href="/">Return to Leið</Link></p>
    </main>
  )
}
