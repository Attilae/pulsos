// Load-tests the feed's WebSocket fan-out (feed/wsServer.js) on loopback:
// admission budgets, the server → client-only protocol, a slow reader under a
// sustained broadcast, and heartbeat eviction. No GTFS, no network beyond
// 127.0.0.1.
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import WebSocket from 'ws'
import { createFeedSocketServer } from '../feed/wsServer.js'

async function startServer(options) {
  const server = http.createServer()
  const feed = createFeedSocketServer(server, { log: () => {}, ...options })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const url = `ws://127.0.0.1:${server.address().port}`
  const close = async () => {
    for (const client of feed.wss.clients) client.terminate()
    feed.wss.close()
    server.close()
    await once(server, 'close')
  }
  return { ...feed, url, close }
}

// Resolves to 'open' or the HTTP status the upgrade was refused with.
function connect(url, options = {}) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, options)
    ws.once('open', () => resolve({ ws, status: 'open' }))
    ws.once('unexpected-response', (_req, res) => resolve({ ws, status: res.statusCode }))
    ws.once('error', () => {})
  })
}

const until = async (check, ms = 5000) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (check()) return true
    await new Promise(r => setTimeout(r, 20))
  }
  return check()
}

test('per-IP and global connection budgets refuse the upgrade', async () => {
  const srv = await startServer({ maxConnectionsPerIp: 3, maxConnections: 100 })
  try {
    const opened = await Promise.all([1, 2, 3].map(() => connect(srv.url)))
    assert.deepEqual(opened.map(c => c.status), ['open', 'open', 'open'])
    assert.equal((await connect(srv.url)).status, 429)
    // Closing one frees its slot.
    opened[0].ws.close()
    await until(() => srv.connectionsByIp.get('127.0.0.1') === 2)
    assert.equal((await connect(srv.url)).status, 'open')
  } finally { await srv.close() }

  const capped = await startServer({ maxConnectionsPerIp: 50, maxConnections: 2 })
  try {
    await connect(capped.url); await connect(capped.url)
    assert.equal((await connect(capped.url)).status, 503)
  } finally { await capped.close() }
})

test('only allowed browser origins may upgrade', async () => {
  const srv = await startServer({ allowedOrigins: ['https://leid.app'] })
  try {
    assert.equal((await connect(srv.url, { origin: 'https://evil.example' })).status, 403)
    assert.equal((await connect(srv.url)).status, 403)
    assert.equal((await connect(srv.url, { origin: 'https://leid.app' })).status, 'open')
  } finally { await srv.close() }
})

test('clients may not send: any message closes 1008, oversized 1009', async () => {
  const srv = await startServer({ maxPayloadBytes: 1024 })
  try {
    const a = (await connect(srv.url)).ws
    a.send('hello')
    const [codeA] = await once(a, 'close')
    assert.equal(codeA, 1008)

    const b = (await connect(srv.url)).ws
    b.send('x'.repeat(4096))
    const [codeB] = await once(b, 'close')
    assert.equal(codeB, 1009)
  } finally { await srv.close() }
})

test('a slow reader is dropped while a fast one keeps receiving', { timeout: 60_000 }, async () => {
  const srv = await startServer({ maxBufferedBytes: 256 * 1024, heartbeatMs: 60_000 })
  try {
    const fast = (await connect(srv.url)).ws
    const slow = (await connect(srv.url)).ws
    let fastCount = 0
    // Counts broadcasts only; the welcome status message may land before this.
    fast.on('message', (data) => { if (JSON.parse(data).type !== 'status') fastCount += 1 })
    // Stop reading: the kernel buffers fill, then the server's send buffer grows.
    slow._socket.pause()
    const slowClosed = new Promise(resolve => slow._socket.once('close', resolve))

    const payload = { type: 'vehicle_update', blob: 'x'.repeat(32 * 1024) }
    const ROUNDS = 1000 // ~32 MB per client
    // Paced like the real feed: the next batch goes out once the fast reader has
    // the previous one. The slow reader
    // never reads, so it falls further behind each batch.
    let peakBuffered = 0
    for (let i = 0; i < ROUNDS; i++) {
      srv.broadcast(payload)
      for (const client of srv.wss.clients) peakBuffered = Math.max(peakBuffered, client.bufferedAmount)
      if (i % 10 === 9) {
        const sent = i + 1
        assert.ok(await until(() => fastCount >= sent, 10_000), `fast reader stalled at ${fastCount}`)
      }
    }

    assert.ok(srv.stats.dropped >= 1, 'slow reader was never dropped')
    assert.equal(srv.stats.dropped, 1, 'the fast reader was dropped too')
    assert.ok(await until(() => srv.wss.clients.size === 1), 'only the fast reader remains')
    // Server-side buffering per socket never grew past the cap plus one message.
    assert.ok(peakBuffered <= 256 * 1024 + 33 * 1024, `peak buffered ${peakBuffered}`)
    assert.ok(await until(() => fastCount === ROUNDS, 30_000), `fast reader got ${fastCount}`)
    slow._socket.resume()
    await slowClosed
  } finally { await srv.close() }
})

test('a socket that stops answering pings is terminated', { timeout: 10_000 }, async () => {
  const srv = await startServer({ heartbeatMs: 100 })
  try {
    const stalled = (await connect(srv.url)).ws
    const healthy = (await connect(srv.url)).ws
    stalled._socket.pause() // no pongs come back
    assert.ok(await until(() => srv.wss.clients.size === 1, 3000), 'stalled socket survived')
    assert.equal(healthy.readyState, WebSocket.OPEN)
    stalled._socket.destroy()
  } finally { await srv.close() }
})
