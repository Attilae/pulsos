// POST /api/compose/recipe — prototype: infer a genre recipe for a composer
// prompt with TypeSafe's Jev when the keyword matcher found none (see
// lib/ai/recipeClassifier.js). Server-side so TYPESAFE_API_KEY never ships.
//
// Every failure — flag off, no key, timeout, bad answer — returns
// { recipeId: null }, which the client treats exactly like "no keyword
// matched": composing never depends on this call. It is not metered against the
// `ai` allowance; the OpenRouter call that follows is.

import { auth } from '@/lib/auth.js'
import {
  JEV_ENDPOINT, DEFAULT_MIN_CONFIDENCE, buildRecipeRequest, interpretRecipeAnswer,
} from '@/lib/ai/recipeClassifier.js'

// Jev answers in 70–500 ms; past this the composer is better off without it.
const TIMEOUT_MS = 2000
const NONE = { recipeId: null, confidence: null }

export async function POST(req) {
  if (process.env.JEV_RECIPE_ENABLED !== 'true') return Response.json(NONE, { status: 404 })

  // Same gate as /api/compose: this spends a key.
  const session = await auth.api.getSession({ headers: req.headers })
  if (!session?.user) return Response.json({ error: 'Sign in to use the AI Composer.' }, { status: 401 })

  const key = process.env.TYPESAFE_API_KEY
  if (!key) {
    console.warn('[compose/recipe] JEV_RECIPE_ENABLED but TYPESAFE_API_KEY missing')
    return Response.json(NONE)
  }

  const { prompt } = (await req.json().catch(() => ({}))) ?? {}
  if (typeof prompt !== 'string' || !prompt.trim()) return Response.json(NONE)

  const parsed = Number.parseFloat(process.env.JEV_RECIPE_MIN_CONFIDENCE)
  const minConfidence = Number.isFinite(parsed) ? parsed : DEFAULT_MIN_CONFIDENCE

  const started = Date.now()
  try {
    const r = await fetch(JEV_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildRecipeRequest(prompt)),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!r.ok) {
      console.warn('[compose/recipe] Jev error', r.status, await r.text().catch(() => ''))
      return Response.json(NONE)
    }
    const data = await r.json()
    const { recipeId, confidence, probabilities } = interpretRecipeAnswer(data, { minConfidence })
    // Prototype telemetry: what Jev picked vs what we accepted, to tune the gate.
    console.info('[compose/recipe]', {
      model: data?.model, choice: data?.answers?.recipe?.choice ?? null, confidence,
      accepted: recipeId, ms: Date.now() - started, inputTokens: data?.usage?.input_tokens,
    })
    return Response.json({ recipeId, confidence, probabilities })
  } catch (err) {
    console.warn('[compose/recipe] Jev request failed', err?.name === 'TimeoutError' ? 'timeout' : String(err?.message ?? err))
    return Response.json(NONE)
  }
}
