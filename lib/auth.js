// Better Auth server config.
//   - email + password
//   - magic link (passwordless email)
// Sessions/users/accounts/verification persist to Postgres via the Drizzle adapter.
//
// Env: BETTER_AUTH_SECRET (>=32 chars), BETTER_AUTH_URL, DATABASE_URL.
// After changing plugins, re-generate the schema (see lib/db/schema.js).

import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { jwt, magicLink } from 'better-auth/plugins'
import { cimd } from '@better-auth/cimd'
import { fetchClientMetadataResource } from '@better-auth/cimd/node'
import { mcp } from '@better-auth/mcp'
import { db } from './db/index.js'
import { sendEmail } from './email.js'
import { pairedOrigins } from './authOrigins.js'

const APP_URL = process.env.BETTER_AUTH_URL || 'http://localhost:3000'
export const MCP_RESOURCE = new URL('/mcp', APP_URL).toString()
export const MCP_ENABLED = process.env.MCP_ENABLED === 'true'

export const auth = betterAuth({
  appName: 'Transit DAW',

  database: drizzleAdapter(db, {
    provider: 'pg',
    // Our table exports are already singular and match Better Auth model names
    // (user/session/account/verification), so no name remapping is needed.
  }),

  emailAndPassword: {
    enabled: true,
    // Set to true once email verification UX is in place.
    requireEmailVerification: false,
  },

  user: {
    additionalFields: {
      role: {
        type: 'string',
        required: false,
        defaultValue: 'user',
        input: false,
      },
    },
  },

  plugins: [
    ...(MCP_ENABLED ? [
      jwt(),
      mcp({
        loginPage: '/mcp/sign-in',
        consentPage: '/mcp/consent',
        resource: MCP_RESOURCE,
        // Claude currently registers an OAuth client dynamically. Keep CIMD
        // for newer clients while allowing the standard public-client flow.
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
      }),
      cimd({
        fetchClientMetadataResource,
        metadataProfile: 'mcp-2026-07-28',
      }),
    ] : []),
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        await sendEmail({
          to: email,
          subject: 'Your Transit DAW sign-in link',
          text: `Click to sign in: ${url}\n\nThis link expires shortly.`,
        })
      },
    }),
  ],

  // CSRF whitelist. Apex and www are paired (see lib/authOrigins.js) — trusting
  // only APP_URL rejected every sign-in made from the other half.
  trustedOrigins: pairedOrigins([APP_URL, process.env.NEXT_PUBLIC_APP_URL]),
})

// Convenience type-infer hooks (JS no-op, but documents the shape):
//   typeof auth.$Infer.Session
