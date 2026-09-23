'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { authClient } from '@/lib/auth-client.js'

export default function McpConsentPage() {
  const [access, setAccess] = useState('loading')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [request, setRequest] = useState({ clientId: '', scope: '' })

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_MCP_ENABLED !== 'true') return
    const params = new URLSearchParams(window.location.search)
    setRequest({
      clientId: params.get('client_id') || 'your AI client',
      scope: params.get('scope') || 'Access to your saved songs',
    })
    fetch('/api/entitlements', { cache: 'no-store' })
      .then(async (response) => {
        if (response.status === 401) return 'signed-out'
        if (!response.ok) throw new Error('Could not check your plan')
        return (await response.json()).isPro ? 'pro' : 'free'
      })
      .then(setAccess)
      .catch(() => setAccess('error'))
  }, [])

  if (process.env.NEXT_PUBLIC_MCP_ENABLED !== 'true') {
    return <main style={{ maxWidth: 480, margin: '8vh auto', padding: 24 }}><p>AI client connections are not available yet.</p><Link href="/">Return to Leið</Link></main>
  }

  const decide = async (accept) => {
    setWorking(true)
    setError('')
    try {
      const { data, error: consentError } = await authClient.oauth2.consent({ accept })
      if (consentError) throw new Error(consentError.message || 'Could not complete authorization')
      if (data?.url) window.location.assign(data.url)
      else setError('Return to your AI client to complete the connection.')
    } catch (cause) {
      setError(cause.message || 'Could not complete authorization')
    } finally {
      setWorking(false)
    }
  }

  return (
    <main style={{ maxWidth: 480, margin: '8vh auto', padding: 24 }}>
      <h1>Connect to Leið?</h1>
      {access === 'loading' && <p>Checking your account…</p>}
      {access === 'signed-out' && <p><Link href="/mcp/sign-in">Sign in</Link> to continue.</p>}
      {access === 'free' && <p>AI client connections require Leið Pro. <Link href="/">View plans in Leið</Link>.</p>}
      {access === 'error' && <p>Could not check your plan. Please try again.</p>}
      {access === 'pro' && <>
        <p><strong>{request.clientId}</strong> is requesting access to your Leið account.</p>
        <p>Requested access: {request.scope}</p>
        <p>This client can use MCP tools to work with your saved songs. You can disconnect it later.</p>
        <button type="button" disabled={working} onClick={() => decide(true)}>Allow access</button>{' '}
        <button type="button" disabled={working} onClick={() => decide(false)}>Deny</button>
      </>}
      {error && <p role="alert">{error}</p>}
    </main>
  )
}
