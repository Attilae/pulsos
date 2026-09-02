'use client'

// Cloudflare Turnstile widget, driven imperatively so it works in **invisible**
// mode, where there is nothing on screen for a person to interact with.
//
// Two render options carry that:
//   execution: 'execute'      — the challenge does not run on page load; it runs
//                               when we call getToken() at submit time.
//   appearance: 'interaction-only' — nothing is drawn unless Cloudflare actually
//                               needs a human, so the form has no dead widget box.
//
// Running the challenge at submit rather than on load is what makes invisible
// mode workable here. A token minted on load expires (~300 s) while someone
// writes a long bug report, and in invisible mode there is no widget to show
// that it lapsed — the Send button would simply stop working with nothing on
// screen to explain why. Minting on demand means the token is always fresh, and
// visitors who never submit are never challenged at all.
//
// The widget mode itself (Managed / Non-interactive / Invisible) is a property
// of the sitekey set in the Cloudflare dashboard, not something the page picks.
// This component works under all three: under Managed, execute() surfaces an
// interactive challenge; under Invisible it resolves silently.
//
// With no NEXT_PUBLIC_TURNSTILE_SITE_KEY, getToken() resolves to '' and the
// server skips verification too (see lib/turnstile.js) — dev needs no account.

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
const SCRIPT_ID = 'cf-turnstile-script'

// Generous: under a Managed sitekey this window has to cover a person solving
// an interactive challenge, not just a background check.
const EXECUTE_TIMEOUT_MS = 120_000

let scriptPromise = null

function loadScript() {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'))
  if (window.turnstile) return Promise.resolve(window.turnstile)
  if (scriptPromise) return scriptPromise

  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID)
    const el = existing || document.createElement('script')
    const onLoad = () => resolve(window.turnstile)
    if (!existing) {
      el.id = SCRIPT_ID
      el.src = SCRIPT_SRC
      el.async = true
      el.defer = true
      document.head.appendChild(el)
    }
    el.addEventListener('load', onLoad)
    el.addEventListener('error', () => reject(new Error('turnstile script failed to load')))
    if (window.turnstile) onLoad()
  })
  return scriptPromise
}

const Turnstile = forwardRef(function Turnstile({ action, className = '' }, ref) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
  const hostRef = useRef(null)
  const widgetRef = useRef(null)
  // Resolved once turnstile.render() has returned a widget id, so getToken()
  // can be called before the script has finished loading.
  const readyRef = useRef(null)
  // The in-flight getToken() call, settled by Turnstile's own callbacks.
  const pendingRef = useRef(null)

  const settle = (fn, value) => {
    const pending = pendingRef.current
    if (!pending) return
    pendingRef.current = null
    clearTimeout(pending.timer)
    pending[fn](value)
  }

  useEffect(() => {
    if (!siteKey || !hostRef.current) return
    let cancelled = false

    readyRef.current = loadScript().then((turnstile) => {
      if (cancelled || !hostRef.current) throw new Error('unmounted')
      if (widgetRef.current != null) return widgetRef.current
      widgetRef.current = turnstile.render(hostRef.current, {
        sitekey: siteKey,
        theme: 'auto',
        // Stamped into the token and checked server-side, so a token minted by
        // this sitekey on some other form can't be replayed against ours.
        action,
        execution: 'execute',
        appearance: 'interaction-only',
        callback: (token) => settle('resolve', token),
        'expired-callback': () => settle('reject', new Error('expired')),
        'timeout-callback': () => settle('reject', new Error('timeout')),
        'error-callback': () => settle('reject', new Error('challenge-failed')),
      })
      return widgetRef.current
    })
    readyRef.current.catch(() => { /* surfaced through getToken() */ })

    return () => {
      cancelled = true
      settle('reject', new Error('unmounted'))
      if (widgetRef.current != null && window.turnstile) {
        try { window.turnstile.remove(widgetRef.current) } catch { /* already gone */ }
      }
      widgetRef.current = null
      readyRef.current = null
    }
  }, [siteKey, action])

  useImperativeHandle(ref, () => ({
    // Runs the challenge and resolves with a single-use token. Always mints a
    // fresh one: reset() clears any token already spent by a previous submit,
    // which is the failure that makes a second attempt fail forever otherwise.
    async getToken() {
      if (!siteKey) return ''
      const widgetId = await readyRef.current
      if (widgetId == null) throw new Error('captcha not ready')

      settle('reject', new Error('superseded'))
      try { window.turnstile.reset(widgetId) } catch { /* never executed yet */ }

      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => settle('reject', new Error('timeout')),
          EXECUTE_TIMEOUT_MS,
        )
        pendingRef.current = { resolve, reject, timer }
        try {
          window.turnstile.execute(widgetId)
        } catch (err) {
          settle('reject', err)
        }
      })
    },
  }), [siteKey])

  if (!siteKey) return null
  return <div ref={hostRef} className={className} />
})

export default Turnstile

// Lets the form show the Cloudflare disclosure only when a captcha is live.
export const turnstileEnabled = () => Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY)
