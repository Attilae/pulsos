// Drizzle schema (Postgres). Auth tables follow Better Auth's default column
// layout (user/session/account/verification); `presets` is app-owned.
//
// After changing this file:
//   npx drizzle-kit generate   # write SQL migration
//   npx drizzle-kit migrate    # apply to DATABASE_URL
// (Better Auth's own CLI `generate` produces an equivalent schema if you'd
//  rather it own the auth tables — kept hand-written here to live beside presets.)

import {
  pgTable, text, timestamp, boolean, jsonb, integer, index, uniqueIndex, check,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const user = pgTable('user', {
  id:            text('id').primaryKey(),
  name:          text('name').notNull(),
  email:         text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image:         text('image'),
  // Authorization is deliberately independent from billing. Better Auth is
  // configured with this as a non-input additional field so clients cannot
  // promote themselves through updateUser/sign-up payloads.
  role:          text('role').notNull().default('user'),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  roleCheck: check('user_role_check', sql`${t.role} in ('user', 'superadmin')`),
}))

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
  // The city this song was authored in, mirroring `state.cityId` (derived
  // server-side so a stale client can't desync them). A song's route ids are
  // city-specific, so loading one switches the active city. Nullable: rows saved
  // before cities were recorded genuinely don't know, and null must keep meaning
  // "assume the currently-loaded city". Denormalized out of `state` so the song
  // list can label/filter by city without reading each row's large jsonb.
  cityId:        text('city_id'),
  state:         jsonb('state').notNull(),
  // Public share token — null when not shared. Anyone with the link can read
  // (and import a copy of) this preset via /api/shared/:shareId.
  shareId:       text('share_id').unique(),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  userUpdatedIdx: index('presets_user_updated_idx').on(t.userId, t.updatedAt),
}))

// ── App: song compositions (chained presets) ─────────────────────────────────
// One row = one song built by chaining saved presets in order. `items` is the
// ordered chain ([{ presetId, presetName, bars, transition, crossfadeBars? }]);
// each preset is re-fetched live by id at play time. `cityId` records the active
// city when authored — presets reference city-specific route ids, so a
// composition is implicitly tied to one city.
export const compositions = pgTable('compositions', {
  id:            text('id').primaryKey(),
  userId:        text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  name:          text('name').notNull(),
  schemaVersion: integer('schema_version').notNull().default(1),
  cityId:        text('city_id'),
  bpm:           integer('bpm').notNull().default(120),
  items:         jsonb('items').notNull(),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  userUpdatedIdx: index('compositions_user_updated_idx').on(t.userId, t.updatedAt),
}))

// ── Billing: Lemon Squeezy subscription mirror ─────────────────────────────
// Webhooks are the source of truth. We keep subscription history instead of a
// plan flag on `user`, so cancellation/resubscription and audit trails remain
// explicit and entitlement resolution can choose the newest valid record.
export const billingSubscriptions = pgTable('billing_subscriptions', {
  id:                text('id').primaryKey(), // Lemon Squeezy subscription id
  userId:            text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  customerId:        text('customer_id').notNull(),
  storeId:           text('store_id').notNull(),
  productId:         text('product_id').notNull(),
  variantId:         text('variant_id').notNull(),
  status:            text('status').notNull(),
  trialEndsAt:       timestamp('trial_ends_at'),
  renewsAt:          timestamp('renews_at'),
  endsAt:            timestamp('ends_at'),
  providerUpdatedAt: timestamp('provider_updated_at').notNull(),
  testMode:          boolean('test_mode').notNull().default(false),
  createdAt:         timestamp('created_at').notNull().defaultNow(),
  updatedAt:         timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  userUpdatedIdx: index('billing_subscriptions_user_updated_idx').on(t.userId, t.providerUpdatedAt),
  customerIdx: index('billing_subscriptions_customer_idx').on(t.customerId),
}))

// One row per exact webhook payload. The SHA-256 id makes Lemon Squeezy retries
// idempotent even though webhook requests do not include a standalone event id.
export const billingWebhookEvents = pgTable('billing_webhook_events', {
  id:        text('id').primaryKey(),
  eventName: text('event_name').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// Generic usage meter. `period` is "lifetime" for Free sample credits and a
// YYYY-MM key for recurring Pro allowances.
export const entitlementUsage = pgTable('entitlement_usage', {
  id:        text('id').primaryKey(),
  userId:    text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  metric:    text('metric').notNull(),
  period:    text('period').notNull(),
  count:     integer('count').notNull().default(0),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  userMetricPeriodUnique: uniqueIndex('entitlement_usage_user_metric_period_unique')
    .on(t.userId, t.metric, t.period),
}))

// Complimentary Pro access is separate from both user authorization and
// Lemon Squeezy subscriptions. One row per user makes grants easy to audit,
// expire, and revoke without fabricating provider-owned subscription records.
export const entitlementOverrides = pgTable('entitlement_overrides', {
  userId:    text('user_id').primaryKey().references(() => user.id, { onDelete: 'cascade' }),
  plan:      text('plan').notNull().default('pro'),
  expiresAt: timestamp('expires_at'),
  reason:    text('reason'),
  grantedBy: text('granted_by').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  planCheck: check('entitlement_overrides_plan_check', sql`${t.plan} = 'pro'`),
  grantedByIdx: index('entitlement_overrides_granted_by_idx').on(t.grantedBy),
}))

// User-submitted feedback and bug reports. Stored rather than only emailed so a
// Resend outage can't lose a report and so triage has a queryable record.
// `user_id` is nullable + `set null` — the form is open to signed-out visitors,
// and deleting an account must not delete the bug it reported. `ip_hash` is a
// salted SHA-256 of the client IP, never the address itself: it exists only to
// key the per-hour rate limit, and hashing keeps the published privacy notice
// honest.
export const feedback = pgTable('feedback', {
  id:        text('id').primaryKey(),
  userId:    text('user_id').references(() => user.id, { onDelete: 'set null' }),
  kind:      text('kind').notNull(),
  email:     text('email').notNull(),
  message:   text('message').notNull(),
  context:   jsonb('context'),
  ipHash:    text('ip_hash'),
  status:    text('status').notNull().default('new'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  createdIdx: index('feedback_created_idx').on(t.createdAt),
  ipRateIdx:  index('feedback_ip_created_idx').on(t.ipHash, t.createdAt),
  kindCheck:  check('feedback_kind_check', sql`${t.kind} in ('bug','idea','other')`),
}))
