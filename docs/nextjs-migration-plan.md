# Next.js Migration Plan

Migrate the Vite + standalone-Node app to **Next.js (App Router) on Vercel**, add
**auth**, and move preset/song persistence from `localStorage` to **Postgres** — while
keeping the realtime BKK feed as a separate always-on service (Vercel serverless cannot
host a 5 s polling WebSocket broadcaster).

## 1. Target topology

```
┌─────────────────────────────────────────────┐        ┌────────────────────────┐
│  Next.js app  (Vercel)                        │        │  feed service          │
│                                               │  WS    │  (Railway / Fly / VPS) │
│  • React + Tone.js UI  (client components)    │◀──────▶│  • BkkFeed (EventEmitter)
│  • route handlers:                            │        │  • polls GTFS-RT 5 s    │
│      /api/compose      (OpenRouter proxy)     │        │  • broadcasts to WS     │
│      /api/snapshot     (proxy → feed svc)     │        │  • /api/snapshot HTTP   │
│      /api/auth/*       (Better Auth)          │        └────────────────────────┘
│      /api/presets/*    (CRUD → Postgres)      │
│  • Postgres (Vercel Postgres / Neon)          │◀── presets, users, sessions
│  • Blob (optional: lines.json)                │
└─────────────────────────────────────────────┘
```

**Why the split:** the feed is one shared, stateful poller fanning out to all clients.
Serverless functions are ephemeral and per-request; edge functions add nothing here (no
Node runtime for protobuf, still short-lived); Vercel Cron's floor is 1 min, not 5 s. So
the feed stays a long-running process. Everything else is a clean Vercel fit.

## 2. Directory layout (App Router)

```
transport/
  app/
    layout.jsx
    page.jsx                      # the 5-tab shell (was App.jsx)
    globals.css                   # was app.css
    api/
      auth/[...all]/route.js      # Better Auth handler
      compose/route.js            # ← server/index.js POST /api/compose
      snapshot/route.js           # ← thin proxy to feed service /api/snapshot
      presets/route.js            # GET (list) + POST (create)
      presets/[id]/route.js       # GET / PUT / DELETE
  components/                     # was src/*.jsx (DawView, MapView, AIComposer, SongMenu…)
  lib/
    engine.js                     # unchanged (client-only)
    mappings.js  mockData.js  vehicleVoice.js  fxTrack.js …   # unchanged
    liveClient.js                 # WS_URL ← env
    songState.js                  # unchanged
    persistence.js                # REWRITTEN: localStorage → fetch('/api/presets')
    useSongPersistence.js         # made async-aware
    auth.js                       # Better Auth server config
    auth-client.js                # Better Auth React client
    db/
      index.js                    # Postgres client (drizzle or pg)
      schema.js                   # tables
  feed/                           # the always-on service (deploy separately)
    index.js                      # ← server/index.js minus /api/compose
    bkkFeed.js  gtfsLoader.js     # moved as-is from server/
  scripts/preprocess_lines.js     # unchanged
  public/data/lines.json          # (or move to Blob — see §6)
  next.config.js                  # was vite.config.js
  drizzle.config.js
```

## 3. File-by-file mapping

| Today | Becomes | Notes |
|---|---|---|
| `src/App.jsx` | `app/page.jsx` + `app/layout.jsx` | Add `"use client"` to tabs that use Tone.js/Leaflet. Lazy-load the engine so SSR never imports it. |
| `src/*.jsx` (tabs, views) | `components/*` | Mostly copy. Anything touching `window`/`Tone`/`WebSocket` → client component. |
| `src/engine.js` + audio modules | `lib/*` | No change; only imported from client components. |
| `server/index.js` → `/api/compose` | `app/api/compose/route.js` | Drop Express; read body via `await req.json()`, return `Response.json()`. Key stays server-side via `process.env`. |
| `server/index.js` → `/api/snapshot` | `app/api/snapshot/route.js` | Now a **proxy**: `fetch(FEED_URL + '/api/snapshot')`. State lives in the feed service. |
| `server/index.js` WS + `feed.start()` | `feed/index.js` | Stays a long-running Node process; deploy to Railway/Fly. |
| `server/bkkFeed.js`, `gtfsLoader.js` | `feed/bkkFeed.js`, `feed/gtfsLoader.js` | Unchanged. |
| `src/liveClient.js` | `lib/liveClient.js` | `WS_URL = process.env.NEXT_PUBLIC_FEED_WS_URL` (was hardcoded `ws://localhost:3005`). |
| `src/persistence.js` | `lib/persistence.js` | Rewritten to call `/api/presets` (see §5). Same exported function names → callers unchanged. |
| `src/useSongPersistence.js` | `lib/useSongPersistence.js` | `loadSong`/`saveSong`/`listSongs` become `async`; hydrate + autosave awaited. Logic otherwise identical. |
| `vite.config.js` | `next.config.js` | |

The hardcoded `http://localhost:3005` in `MixerTab.jsx` also moves to
`NEXT_PUBLIC_FEED_HTTP_URL`.

## 4. Auth — Better Auth + Postgres

- Server config in `lib/auth.js`, mounted at `app/api/auth/[...all]/route.js`.
- React client in `lib/auth-client.js` (`useSession`, `signIn`, `signOut`).
- Start with email/password; OAuth (Google/GitHub) is a later plugin toggle.
- Sessions + users live in the same Postgres as presets (Better Auth generates its tables).
- Gate preset routes: read `session.user.id` server-side; presets are scoped per user.

## 5. Preset persistence — DB schema + API

Your snapshot is already JSON-safe (`buildSnapshot` in `songState.js`), so one `jsonb`
column holds an entire song. The current `localStorage` keys map directly:

| localStorage today | Postgres |
|---|---|
| `transit-daw:song:<id>` (full song object) | `presets` row, `state jsonb` |
| `transit-daw:songIndex` | `SELECT id, name, updated_at` (no separate index needed) |
| `transit-daw:lastSongId` | `users.last_preset_id` (or a `user_prefs` row) |

```sql
CREATE TABLE presets (
  id             text PRIMARY KEY,            -- keep newSongId() format
  user_id        text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  name           text NOT NULL,
  schema_version integer NOT NULL DEFAULT 1,
  state          jsonb NOT NULL,              -- buildSnapshot() output
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX presets_user_updated_idx ON presets (user_id, updated_at DESC);
```

Route handlers (all scoped to `session.user.id`):

| Method + path | Replaces |
|---|---|
| `GET /api/presets` | `listSongs()` → `{id,name,updatedAt}[]` |
| `POST /api/presets` | `saveSong()` for new |
| `GET /api/presets/:id` | `loadSong(id)` |
| `PUT /api/presets/:id` | `saveSong()` for existing |
| `DELETE /api/presets/:id` | `deleteSong(id)` |

`lib/persistence.js` keeps the **same exported function names** but each becomes an async
`fetch` to the above. `useSongPersistence.js` is the only consumer; making its three call
sites `await` is the whole client-side change. The 800 ms autosave debounce already
batches writes nicely for a network round-trip.

**Migration nicety:** on first login, offer a one-time "import local songs" that reads any
existing `localStorage` songs and POSTs them — so nobody loses presets.

## 6. Env + deploy

`.env` today: `BKK_API_KEY`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `PORT`.

| Var | Where |
|---|---|
| `BKK_API_KEY` | feed service only |
| `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` | Vercel (server-only) |
| `DATABASE_URL` | Vercel (Postgres) |
| `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` | Vercel |
| `FEED_HTTP_URL`, `NEXT_PUBLIC_FEED_WS_URL`, `NEXT_PUBLIC_FEED_HTTP_URL` | Vercel |

- **`lines.json` is ~23 MB.** Static files in `public/` count against deploy size and slow
  builds. Options: keep in `public/` (simplest, probably fine), or move to **Vercel Blob**
  and fetch by URL, or split per-line on demand. Decide before first deploy.
- Feed service: tiny Dockerfile or `node feed/index.js`; enable CORS for the Vercel origin
  (already `*` today) and ideally lock it to the app origin.

## 7. Suggested order

1. **DB + auth slice first** (lowest risk, highest new value): stand up Postgres, Better
   Auth, `presets` schema, the `/api/presets` routes, and rewrite `persistence.js`. This
   works *inside the current Vite app too* if pointed at a small API — but cleanest to do
   as the first Next.js piece.
2. **Shell port**: `App.jsx` → `app/`, move `src/*` → `components/`/`lib/`, client-ify
   audio components, swap Vite for Next.
3. **API routes**: `/api/compose`, `/api/snapshot` proxy.
4. **Extract feed service**: `server/` → `feed/`, deploy, wire env URLs.
5. **Polish**: Blob for `lines.json`, OAuth, per-user sharing, etc.

Each step is independently shippable; the app keeps working between them.

## 8. Slice 1 status (built on branch `next-migration`)

Done and verified (`npx next build` passes; `drizzle-kit generate` produced
`drizzle/0000_*.sql` with all 5 tables):

- `lib/db/schema.js` + `lib/db/index.js` — Drizzle schema (auth tables + `presets`) and pooled pg client
- `lib/auth.js` + `lib/auth-client.js` — Better Auth (email+password, magic link) via Drizzle adapter
- `lib/email.js` — Resend sender with dev console fallback
- `app/api/auth/[...all]/route.js` — auth endpoints
- `app/api/presets/route.js` + `app/api/presets/[id]/route.js` — user-scoped CRUD (PUT = upsert)
- `lib/persistence.js` — rewritten to call `/api/presets` (same export names, now async)
- `lib/songState.js` (copied from `src/`), `lib/useSongPersistence.js` — async + session-gated
- `app/page.jsx` — **temporary** verification harness (sign in / sign up / magic link + presets CRUD)

> Note: `lib/songState.js` temporarily duplicates `src/songState.js` so the Vite
> app keeps running on this branch. Slice 2 deletes the `src/` copies.

**To run it locally:**

1. Copy `.env.example` → `.env` and fill `DATABASE_URL` (a free Neon DB works),
   plus `BETTER_AUTH_SECRET` (`openssl rand -base64 32`). `RESEND_API_KEY` is
   optional — without it, magic links print to the server console.
2. `npm run db:migrate` (or `npm run db:push`) to create the tables.
3. `npm run next:dev` → open http://localhost:3000 → sign up, then add/delete a
   test preset to confirm the DB round-trip.

The existing Vite app (`npm run dev` + `npm run server`) is untouched.

## 9. Slice 2 status (shell port — done, verified)

The DAW now runs as a Next.js app. Verified: `next build` passes, `next dev`
serves `/` (200), `/api/auth/ok` → `{ok:true}`, `/api/presets` → 401 unauth, and
a real browser load renders the full DAW (tracks, pitch maps, transport, Sign-in
control) with **no console errors** and Tone.js initialized client-side.

Approach + deviations from the original sketch:

- **`src/` was kept in place** rather than moved to `components/`/`lib/`. Moving
  ~25 files would have rewritten dozens of correct relative imports for zero
  functional gain; Next doesn't care where components live. So: `app/` = routes,
  `lib/` = auth/DB/persistence (slice 1), `src/` = the existing UI + engine,
  `server/` = the (still-to-be-extracted) feed. The "move to components/lib"
  reshuffle is now optional cosmetic cleanup, not a blocker.
- **Whole DAW is client-only.** `app/page.jsx` (`'use client'`) loads
  `src/App.jsx` via `next/dynamic` with `ssr: false`, so Tone.js/Leaflet never
  execute on the server — no need to audit every file for `window` access.
- **Persistence wired to the DB.** `src/tabs/MixerTab.jsx` now imports the async
  `lib/useSongPersistence.js`; the three `src/` duplicates were deleted. Saving is
  gated on a signed-in session (header `AuthControl`).
- **Hardcoded `localhost:3005`** in `liveClient.js`, `ai/composer.js`, and the
  MixerTab snapshot fetch are now `process.env.NEXT_PUBLIC_FEED_*` with localhost
  fallbacks.
- **Vite retired:** deleted `index.html`, `vite.config.js`, `src/main.jsx`;
  dropped `vite` + `@vitejs/plugin-react`; `npm run dev/build/start` are now Next.
- **next.config.js** pins `outputFileTracingRoot` (a stray `~/package-lock.json`
  otherwise makes Next guess the wrong workspace root).

**Next (slice 3):** move `/api/compose` to a same-origin Next route handler (logic
already exists in `server/index.js`) and add the `/api/snapshot` proxy, then point
`ai/composer.js` at same-origin instead of the feed service. **Slice 4:** extract
`server/` → `feed/` and deploy it as the always-on service.
```
