import path from 'node:path'
import { withPostHogConfig } from '@posthog/nextjs-config'

// The browser SDK lazy-loads replay and exception modules from this asset host.
const posthogAssetOrigin = process.env.NEXT_PUBLIC_POSTHOG_HOST
  ? new URL(process.env.NEXT_PUBLIC_POSTHOG_HOST).origin.replace(/\.i\.posthog\.com$/, '-assets.i.posthog.com')
  : ''

// Baseline response headers for every route. The enforced CSP only carries
// directives that can't break a page (framing, <base>, plugins); the full policy
// runs report-only until violations in production (Next inline scripts, the
// theme bootstrap, map tiles, wasm + audio worklets, Turnstile, analytics) have
// been checked against it — then move it into Content-Security-Policy.
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://challenges.cloudflare.com https://va.vercel-scripts.com ${posthogAssetOrigin}`.trim(),
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https: wss:",
  "media-src 'self' data: blob: https:",
  "worker-src 'self' blob:",
  "frame-src https://challenges.cloudflare.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ')

const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
  { key: 'Content-Security-Policy-Report-Only', value: CSP_REPORT_ONLY },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()' },
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // A stray ~/package-lock.json makes Next guess the wrong monorepo root; pin
  // file tracing to this project so standalone/Vercel builds trace correctly.
  outputFileTracingRoot: path.join(import.meta.dirname, '.'),
  async headers() {
    return [
      { source: '/:path*', headers: SECURITY_HEADERS },
      {
        // The Resonator, Clouds granular, Macro and Texture Mk II DSP modules (scripts/build_resonator.js,
        // scripts/build_clouds.js, scripts/build_macro.js, scripts/build_beads.js) are content-addressed — <name>-<sha8>.wasm — so
        // a given URL never changes and can be cached for good. The explicit type
        // keeps WebAssembly.compileStreaming-style loaders happy on hosts that
        // don't map .wasm themselves.
        source: '/wasm/:file(resonator-[0-9a-f]{8}\\.wasm)',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
          { key: 'Content-Type', value: 'application/wasm' },
        ],
      },
      {
        source: '/wasm/:file(clouds-granular-[0-9a-f]{8}\\.wasm)',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
          { key: 'Content-Type', value: 'application/wasm' },
        ],
      },
      {
        source: '/wasm/:file(macro-[0-9a-f]{8}\\.wasm)',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
          { key: 'Content-Type', value: 'application/wasm' },
        ],
      },
      {
        source: '/wasm/:file(beads-[0-9a-f]{8}\\.wasm)',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
          { key: 'Content-Type', value: 'application/wasm' },
        ],
      },
    ]
  },
}

// Build credentials are server-only. Ordinary local builds need no upload token.
const uploadSourceMaps = Boolean(process.env.POSTHOG_API_KEY && process.env.POSTHOG_PROJECT_ID)
if (process.env.VERCEL && process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN && !uploadSourceMaps) {
  console.warn('[PostHog] Source-map upload is disabled: set POSTHOG_API_KEY and POSTHOG_PROJECT_ID in Vercel.')
}

export default uploadSourceMaps ? withPostHogConfig(nextConfig, {
  personalApiKey: process.env.POSTHOG_API_KEY,
  projectId: process.env.POSTHOG_PROJECT_ID,
  host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
  sourcemaps: { enabled: true, deleteAfterUpload: true, failOnError: true },
}) : nextConfig
