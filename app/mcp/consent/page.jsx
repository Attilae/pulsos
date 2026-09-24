'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { authClient } from '@/lib/auth-client.js'
import { McpShell as Shell, ClientChip, styles } from '../McpCard.jsx'

// OAuth scopes in plain language. Unknown scopes are still listed, verbatim, so
// the screen never hides part of what is being granted.
const SCOPE_TEXT = {
  openid: 'Confirm who you are',
  profile: 'See your name',
  email: 'See your email address',
  offline_access: 'Stay connected until you disconnect it',
}

export default function McpConsentPage() {
  const [access, setAccess] = useState('loading')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [request, setRequest] = useState({ clientId: '', scope: '' })

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_MCP_ENABLED !== 'true') return
    const params = new URLSearchParams(window.location.search)
    setRequest({
      clientId: params.get('client_id') || '',
      scope: params.get('scope') || '',
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
    return <Shell><p className={styles.status}>AI client connections are not available yet. <Link href="/">Return to Leið</Link></p></Shell>
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

  const scopes = request.scope.split(/\s+/).filter(Boolean)

  return (
    <Shell>
      <h1 className={styles.title}>Connect to Leið?</h1>
      {access === 'loading' && <p className={styles.status}>Checking your account…</p>}
      {access === 'signed-out' && <p className={styles.status}><Link href="/mcp/sign-in">Sign in</Link> to continue.</p>}
      {access === 'free' && <p className={styles.status}>AI client connections require Leið Pro. <Link href="/">View plans in Leið</Link>.</p>}
      {access === 'error' && <p className={styles.status}>Could not check your plan. Please try again.</p>}
      {access === 'pro' && <>
        <p className={styles.lede}>An AI client wants to work with your Leið account.</p>

        <ClientChip clientId={request.clientId} />

        <p className={styles.sectionLabel}>It will be able to</p>
        <ul className={styles.scopes}>
          <li>Read, create and edit your saved songs</li>
          {scopes.map(scope => <li key={scope}>{SCOPE_TEXT[scope] ?? scope}</li>)}
        </ul>

        <div className={styles.actions}>
          <button type="button" className={styles.button} disabled={working} onClick={() => decide(false)}>Deny</button>
          <button type="button" className={`${styles.button} ${styles.primary}`} disabled={working} onClick={() => decide(true)}>
            {working ? 'Connecting…' : 'Allow access'}
          </button>
        </div>
        <p className={styles.note}>You can disconnect it any time from your Leið account menu.</p>
      </>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
    </Shell>
  )
}
