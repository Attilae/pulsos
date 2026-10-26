// The feed's WebSocket fan-out, with admission and backpressure. Split out of
// index.js so it can be load-tested without loading GTFS (test/feed-ws.test.js).
//
// Clients only listen, so inbound messages are tiny or absent; a socket that
// can't keep up with the broadcast is dropped rather than buffered without bound.
import { WebSocketServer } from 'ws'

export const WS_DEFAULTS = Object.freeze({
  allowedOrigins: ['*'],
  maxConnections: 1000,
  maxConnectionsPerIp: 10,
  maxBufferedBytes: 1024 * 1024,
  maxPayloadBytes: 1024,
  heartbeatMs: 30e3,
  // Behind a proxy (Railway/Fly/Render) the socket address is the proxy's; set
  // trustProxy there so per-IP limits key on the forwarded client address.
  trustProxy: false,
  log: console.log,
})

export function createFeedSocketServer(server, options = {}) {
  // Unset env values arrive as undefined and must not override a default.
  const set = Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined))
  const opts = { ...WS_DEFAULTS, ...set }
  const connectionsByIp = new Map()
  const stats = { dropped: 0, rejected: 0 }

  const clientAddress = (req) => {
    if (opts.trustProxy) {
      const forwarded = req.headers['x-forwarded-for']
      if (forwarded) return String(forwarded).split(',')[0].trim()
    }
    return req.socket.remoteAddress ?? 'unknown'
  }

  // Browsers always send Origin, so this keeps other sites' pages from opening
  // sockets; it doesn't stop non-browser clients, which the budgets below bound.
  const originAllowed = (origin) => {
    if (opts.allowedOrigins.includes('*')) return true
    return !!origin && opts.allowedOrigins.includes(origin)
  }

  const wss = new WebSocketServer({
    server,
    maxPayload: opts.maxPayloadBytes,
    perMessageDeflate: false,
    verifyClient: ({ origin, req }, done) => {
      const reject = (code, reason) => { stats.rejected += 1; done(false, code, reason) }
      if (!originAllowed(origin)) return reject(403, 'Forbidden')
      if (wss.clients.size >= opts.maxConnections) return reject(503, 'Too many connections')
      if ((connectionsByIp.get(clientAddress(req)) ?? 0) >= opts.maxConnectionsPerIp) {
        return reject(429, 'Too many connections')
      }
      done(true)
    },
  })

  wss.on('connection', (ws, req) => {
    const ip = clientAddress(req)
    connectionsByIp.set(ip, (connectionsByIp.get(ip) ?? 0) + 1)
    ws.isAlive = true
    ws.on('pong', () => { ws.isAlive = true })
    // The protocol is server → client only.
    ws.on('message', () => ws.close(1008, 'unexpected message'))
    ws.on('error', () => ws.terminate())
    opts.log(`[ws] client connected (${ip})`)
    ws.send(JSON.stringify({ type: 'status', connected: true }))
    ws.on('close', () => {
      const n = (connectionsByIp.get(ip) ?? 1) - 1
      if (n > 0) connectionsByIp.set(ip, n)
      else connectionsByIp.delete(ip)
      opts.log(`[ws] client disconnected (${ip})`)
    })
  })

  // Drop sockets that stop answering pings (half-open TCP, stalled readers).
  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      if (client.isAlive === false) { client.terminate(); continue }
      client.isAlive = false
      client.ping()
    }
  }, opts.heartbeatMs)
  wss.on('close', () => clearInterval(heartbeat))

  function broadcast(msg) {
    const text = JSON.stringify(msg)
    for (const client of wss.clients) {
      if (client.readyState !== 1) continue
      if (client.bufferedAmount > opts.maxBufferedBytes) {
        stats.dropped += 1
        client.terminate()
        continue
      }
      client.send(text)
    }
  }

  return { wss, broadcast, stats, connectionsByIp }
}
