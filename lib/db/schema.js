// Drizzle schema (Postgres). Auth tables follow Better Auth's default column
// layout (user/session/account/verification); `presets` is app-owned.
//
// After changing this file:
//   npx drizzle-kit generate   # write SQL migration
//   npx drizzle-kit migrate    # apply to DATABASE_URL
// (Better Auth's own CLI `generate` produces an equivalent schema if you'd
//  rather it own the auth tables — kept hand-written here to live beside presets.)

import {
  pgTable, text, timestamp, boolean, jsonb, integer, index,
} from 'drizzle-orm/pg-core'

export const user = pgTable('user', {
  id:            text('id').primaryKey(),
  name:          text('name').notNull(),
  email:         text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image:         text('image'),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
})

export const session = pgTable('session', {
  id:        text('id').primaryKey(),
  expiresAt: timestamp('expires_at').notNull(),
  token:     text('token').notNull().unique(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId:    text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
})

export const account = pgTable('account', {
  id:                    text('id').primaryKey(),
  accountId:             text('account_id').notNull(),
  providerId:            text('provider_id').notNull(),
  userId:                text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accessToken:           text('access_token'),
  refreshToken:          text('refresh_token'),
  idToken:               text('id_token'),
  accessTokenExpiresAt:  timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope:                 text('scope'),
  password:              text('password'),
  createdAt:             timestamp('created_at').notNull().defaultNow(),
  updatedAt:             timestamp('updated_at').notNull().defaultNow(),
})

export const verification = pgTable('verification', {
  id:         text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value:      text('value').notNull(),
  expiresAt:  timestamp('expires_at').notNull(),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
})

// ── App: saved songs / presets ───────────────────────────────────────────────
// One row = one full song. `state` is the JSON-safe output of buildSnapshot().
export const presets = pgTable('presets', {
  id:            text('id').primaryKey(),               // keep newSongId() format
  userId:        text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  name:          text('name').notNull(),
  schemaVersion: integer('schema_version').notNull().default(1),
  state:         jsonb('state').notNull(),
  // Public share token — null when not shared. Anyone with the link can read
  // (and import a copy of) this preset via /api/shared/:shareId.
  shareId:       text('share_id').unique(),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  userUpdatedIdx: index('presets_user_updated_idx').on(t.userId, t.updatedAt),
}))
