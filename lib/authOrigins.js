// Origins Better Auth accepts on state-changing requests (its CSRF check
// compares the browser's Origin header against this list).
//
// A site reachable on both the apex and `www.` sends whichever one the visitor
// is on. Trusting only BETTER_AUTH_URL rejected every sign-in in production
// ("Invalid origin") because it was the apex while the site served on
// www.layth.space — same failure lib/turnstile.js pairs hostnames for.
//
// Pure (no DB/env reads) so it can be tested without booting auth.

export function pairedOrigins(urls) {
  const origins = new Set()
  for (const raw of urls) {
    if (!raw) continue
    let url
    try { url = new URL(raw.trim()) } catch { continue }
    origins.add(url.origin)
    const host = url.hostname
    // Skip bare IPs and single-label hosts — `www.localhost` is not a thing.
    if (!host.includes('.') || /^[\d.]+$/.test(host)) continue
    const twin = new URL(url.origin)
    twin.hostname = host.startsWith('www.') ? host.slice(4) : `www.${host}`
    origins.add(twin.origin)
  }
  return [...origins]
}
