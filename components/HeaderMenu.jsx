'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { AuthForm } from './AuthControl.jsx'
import { AccountSection, BillingSection, PresetsSection, SecuritySection } from './ProfilePanel.jsx'
import { useEntitlements } from '@/lib/shared/EntitlementsContext.jsx'
import { signOut, useSession } from '../lib/auth-client.js'
import './HeaderMenu.css'

const LEGAL_ITEMS = [
  { href: '/legal', label: 'Legal overview' },
  { href: '/terms', label: 'Terms of service' },
  { href: '/privacy', label: 'Privacy notice' },
  { href: '/licenses', label: 'Licences & credits' },
]

export default function HeaderMenu({ startTour }) {
  const { data: session, isPending } = useSession()
  const [open, setOpen] = useState(false)
  const [view, setView] = useState('home')
  const triggerRef = useRef(null)

  const close = () => {
    setOpen(false)
    setView('home')
    requestAnimationFrame(() => triggerRef.current?.focus())
  }

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  useEffect(() => {
    const showAuth = () => { setView('home'); setOpen(true) }
    window.addEventListener('leid:open-auth', showAuth)
    return () => window.removeEventListener('leid:open-auth', showAuth)
  }, [])

  const user = session?.user
  const title = view === 'profile'
    ? 'Profile'
    : view === 'presets'
      ? 'My presets'
      : view === 'billing'
        ? 'Plan & billing'
      : view === 'security'
        ? 'Change password'
        : 'Menu'

  return (
    <div className="header-menu auth-control">
      <button
        ref={triggerRef}
        type="button"
        className="header-menu-trigger"
        aria-label="Open menu"
        aria-expanded={open}
        aria-controls="app-menu-drawer"
        onClick={() => {
          setView('home')
          setOpen(value => !value)
        }}
      >
        <span className="header-menu-trigger-lines" aria-hidden="true"><i /><i /><i /></span>
      </button>

      {open && (
        <div className="header-menu-layer" onMouseDown={close}>
          <aside
            id="app-menu-drawer"
            className="header-menu-drawer"
            aria-label="Application menu"
            onMouseDown={event => event.stopPropagation()}
          >
            <header className="header-menu-drawer-header">
              {view !== 'home' ? (
                <button type="button" className="header-menu-back" onClick={() => setView('home')}>
                  ← Back
                </button>
              ) : <span className="header-menu-kicker">Leið control room</span>}
              <button type="button" className="header-menu-close" onClick={close} aria-label="Close menu">×</button>
            </header>

            <div className="header-menu-scroll">
              <h2>{title}</h2>
              {isPending ? <p className="header-menu-loading">Loading account…</p> : user ? (
                <AuthenticatedMenu
                  user={user}
                  view={view}
                  onNavigate={setView}
                  onClose={close}
                  onStartTour={() => { startTour(); close() }}
                />
              ) : (
                <GuestMenu onDone={close} onStartTour={() => { startTour(); close() }} />
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}

function GuestMenu({ onDone, onStartTour }) {
  return (
    <>
      <p className="header-menu-intro">Save your sets, return to a work in progress, and chain presets into a longer composition.</p>
      <AuthForm className="header-menu-auth-form" onDone={onDone} />
      <MenuDivider label="Explore" />
      <button type="button" className="header-menu-item" onClick={onStartTour}>
        <span>Take the tour</span><span aria-hidden="true">↗</span>
      </button>
      <LegalItems />
    </>
  )
}

function AuthenticatedMenu({ user, view, onNavigate, onClose, onStartTour }) {
  const { plan } = useEntitlements()
  if (view === 'profile') return <AccountSection user={user} />
  if (view === 'presets') return <PresetsSection />
  if (view === 'billing') return <BillingSection />
  if (view === 'security') return <SecuritySection />

  return (
    <>
      <section className="header-menu-user" aria-label="Signed-in profile">
        <span className="header-menu-avatar" aria-hidden="true">{initials(user)}</span>
        <div>
          <strong>{user.name || user.email}</strong>
          <span>{user.email}</span>
        </div>
      </section>

      <div className="header-menu-list">
        <MenuButton label="Profile" detail="Account information" onClick={() => onNavigate('profile')} />
        <MenuButton label="My presets" detail="Open, share, or delete saved songs" onClick={() => onNavigate('presets')} />
        <MenuButton label={`Plan · ${plan === 'pro' ? 'Pro' : 'Free'}`} detail="Usage, exports, and billing" onClick={() => onNavigate('billing')} />
        <MenuButton label="Change password" detail="Update your account security" onClick={() => onNavigate('security')} />
      </div>

      <MenuDivider label="Explore" />
      <button type="button" className="header-menu-item" onClick={onStartTour}>
        <span>Take the tour</span><span aria-hidden="true">↗</span>
      </button>
      <LegalItems />

      <button type="button" className="header-menu-signout" onClick={() => { signOut(); onClose() }}>
        Sign out
      </button>
    </>
  )
}

function MenuButton({ label, detail, onClick }) {
  return (
    <button type="button" className="header-menu-item header-menu-item--detail" onClick={onClick}>
      <span><strong>{label}</strong><small>{detail}</small></span>
      <span aria-hidden="true">→</span>
    </button>
  )
}

function MenuDivider({ label }) {
  return <p className="header-menu-section-label">{label}</p>
}

function LegalItems() {
  return (
    <>
      <MenuDivider label="Legal" />
      <nav className="header-menu-legal" aria-label="Legal documents">
        {LEGAL_ITEMS.map(item => (
          <Link key={item.href} href={item.href}>
            {item.label}<span aria-hidden="true">↗</span>
          </Link>
        ))}
      </nav>
    </>
  )
}

function initials(user) {
  const label = (user.name || user.email || '?').trim()
  return label.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase()
}
