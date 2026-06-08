// Transit DAW — feed service.
//
// The always-on half of the app: polls BKK GTFS-RT, diffs state, and fans
// arrival/vehicle/trip/alert events out to all WebSocket clients. Also serves
// /api/snapshot (current vehicle state) over HTTP, which the Next app proxies.
//
// This runs as a long-lived process (Railway/Fly/VPS) — it cannot live on
// Vercel serverless. /api/compose moved to the Next app (it's stateless).

import 'dotenv/config'
import express from 'express'
import http from 'http'
import { WebSocketServer } from 'ws'
import { loadGtfs } from './gtfsLoader.js'
import { GtfsRtFeed } from './bkkFeed.js'
import { getCity } from './cities/index.js'

const PORT = process.env.PORT || 3005
const CITY = process.env.CITY || 'budapest'
// Comma-separated allowlist; '*' (default) allows any origin.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim())

const cfg     = getCity(CITY)
const API_KEY = cfg.apiKeyEnv ? process.env[cfg.apiKeyEnv] : null

if (cfg.apiKeyEnv && !API_KEY) {
  console.error(`[feed] ${cfg.apiKeyEnv} missing from env (required for ${cfg.name})`)
  process.exit(1)
}

const app    = express()
const server = http.createServer(app)
const wss    = new WebSocketServer({ server })

app.use((req, res, next) => {
  const origin = req.headers.origin
  if (ALLOWED_ORIGINS.includes('*')) {
    res.setHeader('Access-Control-Allow-Origin', '*')
  } else if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

app.get('/health', (_req, res) => res.json({ ok: true }))

let feed = null
app.get('/api/snapshot', (_req, res) => {
  res.json({ vehicles: feed ? feed.getSnapshot() : [] })
})

app.get('/api/metro-debug', (_req, res) => {
  if (!feed) return res.json({ error: 'feed not started' })
  res.json(feed.getMetroDebug())
})

function broadcast(msg) {
  const text = JSON.stringify(msg)
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(text)
  }
}

async function main() {
  console.log(`[feed] City: ${cfg.name}`)
  console.log('[feed] Loading GTFS static data…')
  const gtfs = await loadGtfs(cfg)

  feed = new GtfsRtFeed(cfg, gtfs, API_KEY)
  feed.on('arrival',        (ev)     => broadcast({ type: 'arrival', ...ev }))
  feed.on('vehicle_update', (ev)     => broadcast({ type: 'vehicle_update', ...ev }))
  feed.on('trip_update',    (ev)     => broadcast({ type: 'trip_update', ...ev }))
  feed.on('alert_update',   (alerts) => broadcast({ type: 'alert_update', alerts }))
  feed.start()
  console.log(`[feed] ${cfg.name} polling every ${(cfg.pollMs ?? 5000) / 1000} s`)

  wss.on('connection', (ws, req) => {
    const ip = req.socket.remoteAddress
    console.log(`[ws] client connected (${ip})`)
    ws.send(JSON.stringify({ type: 'status', connected: true }))
    ws.on('close', () => console.log(`[ws] client disconnected (${ip})`))
  })

  server.listen(PORT, () => console.log(`[feed] http://localhost:${PORT}`))
}

main().catch((err) => { console.error(err); process.exit(1) })
