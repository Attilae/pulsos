import 'dotenv/config'
import express from 'express'
import http from 'http'
import { WebSocketServer } from 'ws'
import { loadGtfs } from './gtfsLoader.js'
import { BkkFeed } from './bkkFeed.js'

const PORT    = process.env.PORT    || 3005
const API_KEY = process.env.BKK_API_KEY

if (!API_KEY) {
  console.error('[server] BKK_API_KEY missing from .env')
  process.exit(1)
}

const app    = express()
const server = http.createServer(app)
const wss    = new WebSocketServer({ server })

app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  next()
})
app.get('/health', (_req, res) => res.json({ ok: true }))

let feed = null
app.get('/api/snapshot', (_req, res) => {
  res.json({ vehicles: feed ? feed.getSnapshot() : [] })
})

function broadcast(msg) {
  const text = JSON.stringify(msg)
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(text)
  }
}

async function main() {
  console.log('[server] Loading GTFS static data…')
  const gtfs = await loadGtfs()

  feed = new BkkFeed(API_KEY, gtfs)
  feed.on('arrival',        (ev)     => broadcast({ type: 'arrival', ...ev }))
  feed.on('vehicle_update', (ev)     => broadcast({ type: 'vehicle_update', ...ev }))
  feed.on('trip_update',    (ev)     => broadcast({ type: 'trip_update', ...ev }))
  feed.on('alert_update',   (alerts) => broadcast({ type: 'alert_update', alerts }))
  feed.start()
  console.log('[server] BKK feed polling every 5 s')

  wss.on('connection', (ws, req) => {
    const ip = req.socket.remoteAddress
    console.log(`[ws] client connected (${ip})`)
    ws.send(JSON.stringify({ type: 'status', connected: true }))
    ws.on('close', () => console.log(`[ws] client disconnected (${ip})`))
  })

  server.listen(PORT, () => console.log(`[server] http://localhost:${PORT}`))
}

main().catch((err) => { console.error(err); process.exit(1) })
