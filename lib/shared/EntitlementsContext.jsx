'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useSession } from '@/lib/auth-client.js'
import { FREE_LIMITS } from '@/lib/billing/plans.js'
import UpgradeModal from '@/components/UpgradeModal.jsx'

const GUEST_ENTITLEMENTS = {
  plan: 'free',
  isPro: false,
  limits: FREE_LIMITS,
  usage: {
    export: { used: 0, limit: FREE_LIMITS.exports, remaining: FREE_LIMITS.exports, period: 'lifetime' },
    ai: { used: 0, limit: FREE_LIMITS.ai, remaining: FREE_LIMITS.ai, period: 'lifetime' },
  },
  subscription: null,
}

const EntitlementsContext = createContext(null)

export function EntitlementsProvider({ children }) {
  const { data: session, isPending: sessionPending } = useSession()
  const [entitlements, setEntitlements] = useState(GUEST_ENTITLEMENTS)
  const [loading, setLoading] = useState(false)
  const [upgradeReason, setUpgradeReason] = useState(null)
  const [billingBusy, setBillingBusy] = useState(false)

  const refresh = useCallback(async () => {
    if (!session?.user) {
      setEntitlements(GUEST_ENTITLEMENTS)
      return GUEST_ENTITLEMENTS
    }
    setLoading(true)
    try {
      const response = await fetch('/api/entitlements', { credentials: 'include', cache: 'no-store' })
      if (!response.ok) throw new Error(`entitlements ${response.status}`)
      const data = await response.json()
      setEntitlements(data)
      return data
    } catch (error) {
      console.warn('[entitlements] refresh failed', error)
      return null
    } finally {
      setLoading(false)
    }
  }, [session?.user?.id])

  useEffect(() => { refresh() }, [refresh])

  // A checkout redirect can beat the subscription webhook by a moment. Refresh
  // a few times without blocking the app so Pro appears as soon as sync lands.
  useEffect(() => {
    if (typeof window === 'undefined' || !session?.user) return
    const params = new URLSearchParams(window.location.search)
    if (params.get('billing') !== 'success') return
    const timers = [0, 1800, 5000].map(delay => setTimeout(refresh, delay))
    params.delete('billing')
    const query = params.toString()
    window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`)
    return () => timers.forEach(clearTimeout)
  }, [session?.user?.id, refresh])

  const openUpgrade = useCallback((reason = 'upgrade') => setUpgradeReason(reason), [])

  const claim = useCallback(async (metric, reason = metric) => {
    if (!session?.user) {
      setUpgradeReason('sign_in')
      return false
    }
    try {
      const response = await fetch('/api/entitlements/claim', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ metric }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data.allowed) {
        if (data.entitlements) setEntitlements(data.entitlements)
        setUpgradeReason(reason)
        return false
      }
      if (data.entitlements) setEntitlements(data.entitlements)
      return true
    } catch (error) {
      console.warn('[entitlements] claim failed', error)
      return false
    }
  }, [session?.user?.id])

  const startCheckout = useCallback(async period => {
    if (!session?.user) {
      setUpgradeReason('sign_in')
      return
    }
    setBillingBusy(true)
    try {
      const response = await fetch('/api/billing/checkout', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data.url) throw new Error(data.error || 'Checkout unavailable')
      window.location.assign(data.url)
    } catch (error) {
      console.warn('[billing] checkout failed', error)
      setUpgradeReason('billing_error')
    } finally {
      setBillingBusy(false)
    }
  }, [session?.user?.id])

  const openPortal = useCallback(async () => {
    setBillingBusy(true)
    try {
      const response = await fetch('/api/billing/portal', { method: 'POST', credentials: 'include' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data.url) throw new Error(data.error || 'Portal unavailable')
      window.location.assign(data.url)
    } catch (error) {
      console.warn('[billing] portal failed', error)
      setUpgradeReason('billing_error')
    } finally {
      setBillingBusy(false)
    }
  }, [])

  const value = useMemo(() => ({
    ...entitlements,
    signedIn: !!session?.user,
    loading: loading || sessionPending,
    billingBusy,
    refresh,
    claim,
    openUpgrade,
    startCheckout,
    openPortal,
  }), [entitlements, session?.user, sessionPending, loading, billingBusy, refresh, claim, openUpgrade, startCheckout, openPortal])

  return (
    <EntitlementsContext.Provider value={value}>
      {children}
      {upgradeReason ? (
        <UpgradeModal
          reason={upgradeReason}
          signedIn={!!session?.user}
          busy={billingBusy}
          onClose={() => setUpgradeReason(null)}
          onCheckout={startCheckout}
          onSignIn={() => {
            setUpgradeReason(null)
            window.dispatchEvent(new CustomEvent('leid:open-auth'))
          }}
        />
      ) : null}
    </EntitlementsContext.Provider>
  )
}

export function useEntitlements() {
  const value = useContext(EntitlementsContext)
  if (!value) throw new Error('useEntitlements must be used inside EntitlementsProvider')
  return value
}
