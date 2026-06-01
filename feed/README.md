# Transit DAW — feed service

The always-on half of Transit DAW. It polls BKK GTFS-RT (VehiclePositions +
TripUpdates every 5 s, Alerts every 60 s), diffs state, and broadcasts
`arrival` / `vehicle_update` / `trip_update` / `alert_update` events to every
connected WebSocket client. It also serves the current vehicle state over HTTP.

This is a **long-lived process** — it can't run on Vercel serverless (ephemeral,
no shared state, no persistent WS). Deploy it to Railway / Fly.io / Render / a VPS.
The Next app talks to it via:

- `FEED_HTTP_URL` → server-side `/api/snapshot` proxy
- `NEXT_PUBLIC_FEED_WS_URL` → the browser connects to the WebSocket directly

## Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /health` | `{ ok: true }` health check |
| `GET /api/snapshot` | `{ vehicles: [...] }` current vehicle state |
| `GET /api/metro-debug` | metro position inference debug |
| `ws://…/` | event stream (arrival/vehicle/trip/alert) |

## Environment

See `.env.example`. `BKK_API_KEY` is required (the process exits without it).
`ALLOWED_ORIGINS` is a comma-separated CORS allowlist (`*` by default; set it to
your Vercel origin in production).

## Run locally

From the repo root (uses the root `node_modules`):

```bash
npm run feed        # → http://localhost:3005
```

Or standalone (its own deps):

```bash
cd feed
cp .env.example .env   # fill BKK_API_KEY
npm install
npm start
```

## Deploy

**Docker:**
```bash
docker build -t transit-daw-feed feed/
docker run -p 3005:3005 --env-file feed/.env transit-daw-feed
```

**Railway / Render / Fly:** point the service at the `feed/` directory (root
directory = `feed`), build `npm install`, start `npm start`. Set `BKK_API_KEY`
and `ALLOWED_ORIGINS`. The platform's `$PORT` is honored automatically.

> First boot downloads + caches the static GTFS to `feed/cache/gtfs_lookup.json`.
> The cache is ephemeral in containers (rebuilt on restart) — fine, it's quick.
> Bump `CACHE_VERSION` in `gtfsLoader.js` when changing the lookup schema.
