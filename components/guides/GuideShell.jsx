import { LegalShell } from '@/components/legal/LegalShell.jsx'

// Product guides for the Pro AI integration. Same chrome as the legal pages
// (LegalShell), with their own nav, meta row and footer prompt.
export const GUIDE_NAV = [
  { href: '/guides/mcp', label: 'Connect an AI client' },
  { href: '/guides/composer-skill', label: 'Composer skill' },
  { href: '/feedback', label: 'Feedback' },
]

export const MCP_GUIDES_ENABLED = process.env.NEXT_PUBLIC_MCP_ENABLED === 'true'

// The MCP resource URL, derived exactly as lib/auth.js does (without importing
// the auth server into a static page).
export const MCP_URL = new URL('/mcp', process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').toString()

export function GuideShell({ current, kicker, title, summary, meta, children }) {
  return (
    <LegalShell
      current={current}
      kicker={kicker}
      title={title}
      summary={summary}
      navItems={GUIDE_NAV}
      navLabel="AI guides"
      meta={meta}
      footerPrompt="Stuck, or something not working as described?"
    >
      {children}
    </LegalShell>
  )
}
