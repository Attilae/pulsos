// Better Auth server config.
//   - email + password
//   - magic link (passwordless email)
// Sessions/users/accounts/verification persist to Postgres via the Drizzle adapter.
//
// Env: BETTER_AUTH_SECRET (>=32 chars), BETTER_AUTH_URL, DATABASE_URL.
// After changing plugins, re-generate the schema (see lib/db/schema.js).

import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { magicLink } from 'better-auth/plugins'
import { db } from './db/index.js'
import { sendEmail } from './email.js'

const APP_URL = process.env.BETTER_AUTH_URL || 'http://localhost:3000'

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

  plugins: [
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

  // CSRF whitelist — add the deployed origin(s) here.
  trustedOrigins: [APP_URL],
})

// Convenience type-infer hooks (JS no-op, but documents the shape):
//   typeof auth.$Infer.Session
