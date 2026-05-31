// Postgres client for Vercel Postgres / Neon, wired into Drizzle.
// Uses the standard node-postgres Pool so it works with any Postgres URL
// (Neon, Vercel Postgres, local). On serverless, the pool is reused across
// invocations via a global to avoid connection storms.

import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema.js'

const globalForDb = globalThis

const pool =
  globalForDb._pgPool ??
  new Pool({ connectionString: process.env.DATABASE_URL })

if (!globalForDb._pgPool) globalForDb._pgPool = pool

export const db = drizzle(pool, { schema })
export { schema }
