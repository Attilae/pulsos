// GET /api/snapshot — proxy to the always-on feed service. The live vehicle
// state lives there (a long-running poller), not in this serverless app. If the
// feed is unreachable, degrade to an empty snapshot so the UI doesn't break.

const FEED_HTTP = process.env.FEED_HTTP_URL || 'http://localhost:3005'

export async function GET() {
  try {
    const r = await fetch(`${FEED_HTTP}/api/snapshot`, { cache: 'no-store' })
    if (!r.ok) throw new Error(`feed ${r.status}`)
    return Response.json(await r.json())
  } catch (err) {
    console.warn('[snapshot] feed unreachable:', err?.message ?? err)
    return Response.json({ vehicles: [] })
  }
}
