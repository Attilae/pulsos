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

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})
app.use(express.json({ limit: '1mb' }))
app.get('/health', (_req, res) => res.json({ ok: true }))

// AI Composer: proxy prose → structured plan through OpenRouter, keeping the
// key server-side. The frontend builds the messages (system prompt + user
// prompt); we attach the key + model and force a JSON object response.
app.post('/api/compose', async (req, res) => {
  const key = process.env.OPENROUTER_API_KEY
  if (!key) return res.status(500).json({ error: 'OPENROUTER_API_KEY missing from .env' })

  const { messages } = req.body ?? {}
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages[] required' })
  }

  try {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${key}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost:3005',
        'X-Title':      'Transit DAW',
      },
      body: JSON.stringify({
        model:           process.env.OPENROUTER_MODEL || 'anthropic/claude-sonnet-4.5',
        messages,
        response_format: { type: 'json_object' },
        temperature:     0.7,
      }),
    })

    if (!r.ok) {
      const detail = await r.text()
      console.error('[compose] OpenRouter error', r.status, detail)
      return res.status(502).json({ error: `OpenRouter ${r.status}`, detail })
    }

    const data    = await r.json()
    const content = data?.choices?.[0]?.message?.content
    if (!content) return res.status(502).json({ error: 'No content returned from model' })

    let plan
    try { plan = JSON.parse(content) }
    catch { return res.status(502).json({ error: 'Model returned invalid JSON', raw: content }) }

    res.json(plan)
  } catch (err) {
    console.error('[compose] failed', err)
    res.status(502).json({ error: String(err?.message ?? err) })
  }
})

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
