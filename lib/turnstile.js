// Cloudflare Turnstile server-side verification for the feedback form — the
// first bot protection in the app.
//
// Follows Cloudflare's canonical siteverify pattern: a token is only accepted
// when `success` is true AND it was minted for the action we expect AND on a
// hostname we own. The last two matter because a sitekey is public — without
// them, anyone can embed our widget on their own page and replay the tokens it
// produces against this endpoint.
//
// Verification is skipped entirely when no secret is configured, deliberately
// mirroring lib/email.js's no-RESEND_API_KEY fallback so `npm run dev` needs no
// Cloudflare account. Production sets the secret.
//
// Cloudflare's test keys for local work:
//   always passes → site 1x00000000000000000000AA
//                   secret 1x0000000000000000000000000000000AA
//   always fails  → secret 2x0000000000000000000000000000000AA

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

// Cloudflare rejects anything longer; checking here avoids a pointless round
// trip on an obviously forged token.
const MAX_TOKEN_LENGTH = 2048
const TIMEOUT_MS = 10_000

let warned = false

// Named `TURNSTILE_SECRET_KEY` to pair with NEXT_PUBLIC_TURNSTILE_SITE_KEY, but
// `TURNSTILE_SECRET` is the name Cloudflare's own tooling writes — accept both
// so a secret placed by either route works.
function secretKey() {
  return process.env.TURNSTILE_SECRET_KEY || process.env.TURNSTILE_SECRET || ''
}

// Hostnames a token may legitimately come from. `TURNSTILE_HOSTNAMES` (comma
// separated) overrides; otherwise we derive it from the app's own URL and allow
// loopback for dev. Never falls back to "accept anything" — an empty allowlist
// rejects, which is the whole point of checking.
export function allowedHostnames() {
  const configured = (process.env.TURNSTILE_HOSTNAMES || '')
    .split(',').map(h => h.trim().toLowerCase()).filter(Boolean)
  if (configured.length) return new Set(configured)

  const out = new Set(['localhost', '127.0.0.1'])
  for (const url of [process.env.NEXT_PUBLIC_APP_URL, process.env.BETTER_AUTH_URL]) {
    if (!url) continue
    try { out.add(new URL(url).hostname.toLowerCase()) } catch { /* not a URL */ }
  }
  return out
}

// Returns { ok, dev, errorCodes }. Never throws — a Cloudflare outage should
// surface as a failed verification the caller can report, not a 500.
export async function verifyTurnstile(token, ip, { action = null } = {}) {
  const secret = secretKey()
  if (!secret) {
    if (!warned) {
      warned = true
      console.warn('[turnstile] no TURNSTILE_SECRET_KEY — captcha verification skipped')
    }
    return { ok: true, dev: true, errorCodes: [] }
  }

  if (!token || typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH) {
    return { ok: false, dev: false, errorCodes: ['missing-input-response'] }
  }

  const hostnames = allowedHostnames()
  if (hostnames.size === 0) {
    console.error('[turnstile] no allowed hostnames resolved — rejecting')
    return { ok: false, dev: false, errorCodes: ['no-allowed-hostnames'] }
  }

  const body = new URLSearchParams({ secret, response: token })
  if (ip) body.set('remoteip', ip)

  let data
  try {
    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body,
    })
    if (!res.ok) {
      console.error(`[turnstile] siteverify ${res.status}`)
      return { ok: false, dev: false, errorCodes: [`http-${res.status}`] }
    }
    data = await res.json()
  } catch (err) {
    console.error('[turnstile] siteverify failed', err)
    return { ok: false, dev: false, errorCodes: ['network-error'] }
  }

  if (data.success !== true) {
    return { ok: false, dev: false, errorCodes: data['error-codes'] || [] }
  }

  // A public sitekey embedded elsewhere still yields success:true — these two
  // checks are what tie the token back to our form on our domain.
  if (action && data.action !== action) {
    console.warn(`[turnstile] action mismatch: expected ${action}, got ${data.action}`)
    return { ok: false, dev: false, errorCodes: ['action-mismatch'] }
  }
  if (data.hostname && !hostnames.has(String(data.hostname).toLowerCase())) {
    console.warn(`[turnstile] hostname not allowed: ${data.hostname}`)
    return { ok: false, dev: false, errorCodes: ['hostname-mismatch'] }
  }

  return { ok: true, dev: false, errorCodes: [] }
}

// Best-effort client IP from the proxy headers Vercel sets. Only ever used
// hashed (see app/api/feedback/route.js) — the raw value is not stored.
export function clientIp(headers) {
  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  return headers.get('x-real-ip') || null
}
