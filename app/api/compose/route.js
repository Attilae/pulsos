// POST /api/compose — proxy prose → structured plan through OpenRouter, keeping
// the key server-side. Ported from the standalone Express server. The frontend
// sends structured fields (prompt, city, lanes, recipe, mode, current song); we
// validate them, build the system prompt here (lib/ai/composeRequest.js), attach
// key + model and enforce the exact loop-plan schema.
//
// Two meters: the `ai` allowance (what the user sees, refunded when generation
// fails) and an attempt budget per provider call (never refunded), so a failure
// that was still billed can't be repeated at no cost.

import { auth } from '@/lib/auth.js'
import { claimUsage, releaseUsage } from '@/lib/billing/server.js'
import { aiAttemptBudget } from '@/lib/billing/plans.js'
import { consumeBudget } from '@/lib/server/rateCounter.js'
import { DAY_MS } from '@/lib/rateWindow.js'
import { COMPOSE_MAX_BODY_BYTES, buildComposeMessages, validateComposeRequest } from '@/lib/ai/composeRequest.js'
import { CITIES } from '@/lib/shared/cities.js'
import { getRouteIndex } from '@/lib/server/routeIndex.js'
// The strict loop-plan schema is derived from the one Zod definition the MCP
// tools also validate against (lib/ai/planSchema.js), so the two can't drift.
import { COMPOSITION_RESPONSE_FORMAT } from '@/lib/ai/planSchema.js'

const APP_URL = process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
// Every provider call across all users, per UTC day: the backstop for many
// accounts each spending their own attempt budget.
const GLOBAL_DAILY_ATTEMPTS = Number(process.env.AI_GLOBAL_DAILY_ATTEMPTS) || 1000
const PROVIDER_TIMEOUT_MS = 90e3

// Spends one provider call from the user's and the global attempt budgets. These
// are never refunded, unlike the `ai` allowance: a failed generation is billed too.
async function claimAttempt(userId, accessSource) {
  const budget = aiAttemptBudget(accessSource)
  const own = await consumeBudget(`ai_attempt:user:${userId}`, budget)
  if (!own.allowed) return false
  const global = await consumeBudget('ai_attempt:global', { limit: GLOBAL_DAILY_ATTEMPTS, windowMs: DAY_MS })
  return global.allowed
}

function attemptLimitResponse() {
  return Response.json({
    error: 'The AI Composer is busy or you have reached today\'s generation limit. Please try again later.',
    code: 'ai_attempt_limit',
  }, { status: 429 })
}

// Some models wrap JSON in a ```json … ``` markdown fence despite being asked
// not to (and despite response_format: json_object). Peel it off before parsing.
function stripJsonFence(text) {
  const t = text.trim()
  const fence = t.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i)
  return (fence ? fence[1] : t).trim()
}

function contentText(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map(part => typeof part === 'string' ? part : part?.text ?? '').join('')
  }
  return ''
}

function parseModelJson(content) {
  const text = stripJsonFence(contentText(content))
  if (!text) throw new SyntaxError('empty model response')
  try { return JSON.parse(text) } catch {}

  // Some providers occasionally wrap an otherwise valid structured response in
  // a sentence even with response_format enabled. Recover the outermost object;
  // truncated JSON still fails here and is retried below.
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1))
  throw new SyntaxError('model response did not contain a complete JSON object')
}

export async function POST(req) {
  // Gated: the AI Composer spends the OpenRouter key, so require a signed-in user.
  const session = await auth.api.getSession({ headers: req.headers })
  if (!session?.user) {
    return Response.json({ error: 'Sign in to use the AI Composer.' }, { status: 401 })
  }

  const key = process.env.OPENROUTER_API_KEY
  if (!key) return Response.json({ error: 'OPENROUTER_API_KEY missing' }, { status: 500 })

  const raw = await req.text().catch(() => '')
  if (Buffer.byteLength(raw) > COMPOSE_MAX_BODY_BYTES) {
    return Response.json({ error: 'request too large' }, { status: 413 })
  }
  let body = null
  try { body = JSON.parse(raw) } catch {}
  const checked = validateComposeRequest(body, CITIES.map(city => city.id))
  if (!checked.ok) return Response.json({ error: checked.error }, { status: 400 })
  const { request } = checked

  const claim = await claimUsage(session.user.id, 'ai')
  if (!claim.allowed) {
    return Response.json({
      error: 'AI Composer allowance reached. Upgrade to Pro for 50 compositions each month.',
      code: 'ai_limit_reached',
      entitlements: claim.entitlements,
    }, { status: 403 })
  }

  const accessSource = claim.entitlements?.accessSource
  const messages = buildComposeMessages(request, {
    cityName: CITIES.find(city => city.id === request.cityId)?.name,
    routeIndex: await getRouteIndex(request.cityId).catch(() => null),
    activeLaneLimit: claim.entitlements?.limits?.activeLanes ?? null,
  })
  try {
    let lastParseError = null
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!await claimAttempt(session.user.id, accessSource)) {
        if (attempt > 0) break
        if (claim.metered) await releaseUsage(session.user.id, 'ai')
        return attemptLimitResponse()
      }
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': APP_URL,
          'X-Title': 'Leid',
        },
        body: JSON.stringify({
          model: process.env.OPENROUTER_MODEL || 'openai/gpt-5-mini',
          messages,
          response_format: COMPOSITION_RESPONSE_FORMAT,
          provider: { require_parameters: true },
          reasoning: { effort: 'low', exclude: true },
          // The expanded plan can contain several fully-specified tracks plus
          // drum steps. 3000 tokens intermittently cut the JSON off mid-object.
          max_completion_tokens: attempt === 0 ? 8000 : 10000,
        }),
      })

      if (!r.ok) {
        const detail = await r.text()
        console.error('[compose] OpenRouter error', r.status, detail)
        if (claim.metered) await releaseUsage(session.user.id, 'ai')
        return Response.json({ error: `OpenRouter ${r.status}`, detail }, { status: 502 })
      }

      const data = await r.json()
      if (data?.error) {
        console.error('[compose] OpenRouter response error', data.error)
        if (claim.metered) await releaseUsage(session.user.id, 'ai')
        return Response.json({ error: data.error.message || 'OpenRouter returned an error' }, { status: 502 })
      }
      const choice = data?.choices?.[0]
      const content = choice?.message?.content
      try {
        return Response.json(parseModelJson(content))
      } catch (error) {
        lastParseError = error
        console.warn('[compose] invalid structured response', {
          attempt: attempt + 1,
          finishReason: choice?.finish_reason ?? null,
          contentLength: contentText(content).length,
        })
      }
    }

    if (claim.metered) await releaseUsage(session.user.id, 'ai')
    return Response.json({
      error: 'The model could not finish a valid composition. Please try again.',
      detail: String(lastParseError?.message ?? 'invalid JSON'),
    }, { status: 502 })
  } catch (err) {
    console.error('[compose] failed', err)
    if (claim.metered) await releaseUsage(session.user.id, 'ai').catch(() => {})
    return Response.json({ error: String(err?.message ?? err) }, { status: 502 })
  }
}
