// POST /api/compose — proxy prose → structured plan through OpenRouter, keeping
// the key server-side. Ported from the standalone Express server. The frontend
// builds the messages (system + user prompt); we attach key + model and force a
// JSON object response.

import { auth } from '@/lib/auth.js'

const APP_URL = process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

export async function POST(req) {
  // Gated: the AI Composer spends the OpenRouter key, so require a signed-in user.
  const session = await auth.api.getSession({ headers: req.headers })
  if (!session?.user) {
    return Response.json({ error: 'Sign in to use the AI Composer.' }, { status: 401 })
  }

  const key = process.env.OPENROUTER_API_KEY
  if (!key) return Response.json({ error: 'OPENROUTER_API_KEY missing' }, { status: 500 })

  const { messages } = (await req.json().catch(() => ({}))) ?? {}
  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: 'messages[] required' }, { status: 400 })
  }

  try {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': APP_URL,
        'X-Title': 'Transit DAW',
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL || 'anthropic/claude-sonnet-4.5',
        messages,
        response_format: { type: 'json_object' },
        temperature: 0.7,
      }),
    })

    if (!r.ok) {
      const detail = await r.text()
      console.error('[compose] OpenRouter error', r.status, detail)
      return Response.json({ error: `OpenRouter ${r.status}`, detail }, { status: 502 })
    }

    const data = await r.json()
    const content = data?.choices?.[0]?.message?.content
    if (!content) return Response.json({ error: 'No content returned from model' }, { status: 502 })

    let plan
    try { plan = JSON.parse(content) }
    catch { return Response.json({ error: 'Model returned invalid JSON', raw: content }, { status: 502 }) }

    return Response.json(plan)
  } catch (err) {
    console.error('[compose] failed', err)
    return Response.json({ error: String(err?.message ?? err) }, { status: 502 })
  }
}
