import { config } from 'dotenv'

// drizzle-kit only auto-loads `.env`, but Next.js keeps DATABASE_URL in
// `.env.local`. Load that first (then `.env`) so the db:* scripts work with a
// bare `npm run` — no need to export DATABASE_URL manually.
config({ path: '.env.local' })
config({ path: '.env' })

/** @type {import('drizzle-kit').Config} */
export default {
  schema: './lib/db/schema.js',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL },
}
