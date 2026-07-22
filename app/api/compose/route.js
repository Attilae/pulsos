// POST /api/compose — proxy prose → structured plan through OpenRouter, keeping
// the key server-side. Ported from the standalone Express server. The frontend
// builds the messages (system + user prompt); we attach key + model and enforce
// the exact loop-plan schema.

import { auth } from '@/lib/auth.js'
import { claimUsage, releaseUsage } from '@/lib/billing/server.js'

const APP_URL = process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

const nullableNumber = { type: ['number', 'null'] }
const nullableString = { type: ['string', 'null'] }
const nullableBoolean = { type: ['boolean', 'null'] }

const harmonySchema = {
  type: ['object', 'null'],
  additionalProperties: false,
  properties: { root: { type: 'string' }, scaleType: { type: 'string' } },
  required: ['root', 'scaleType'],
}

const COMPOSITION_RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'leid_loop_plan',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        summary: { type: 'string' },
        bpm: nullableNumber,
        harmony: harmonySchema,
        masterVolume: nullableNumber,
        tracks: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              routeId: { type: 'string' },
              synthType: nullableString,
              samplerPreset: nullableString,
              volume: nullableNumber,
              pan: nullableNumber,
              octave: nullableNumber,
              glide: nullableNumber,
              legato: nullableBoolean,
              scale: harmonySchema,
              drone: {
                type: ['object', 'null'], additionalProperties: false,
                properties: { enabled: { type: 'boolean' }, root: nullableString },
                required: ['enabled', 'root'],
              },
              arp: {
                type: ['object', 'null'], additionalProperties: false,
                properties: {
                  enabled: { type: 'boolean' }, style: { type: 'string' }, rate: { type: 'string' },
                  gate: { type: 'number' }, octaves: { type: 'number' }, steps: { type: 'number' }, distance: { type: 'number' },
                },
                required: ['enabled', 'style', 'rate', 'gate', 'octaves', 'steps', 'distance'],
              },
              granular: {
                type: ['object', 'null'], additionalProperties: false,
                properties: {
                  enabled: { type: 'boolean' }, mix: { type: 'number' }, grainSize: { type: 'number' },
                  overlap: { type: 'number' }, playbackRate: { type: 'number' }, loopStart: { type: 'number' },
                  loopEnd: { type: 'number' }, jitter: { type: 'number' }, reverse: { type: 'boolean' },
                  attack: { type: 'number' }, release: { type: 'number' },
                },
                required: ['enabled', 'mix', 'grainSize', 'overlap', 'playbackRate', 'loopStart', 'loopEnd', 'jitter', 'reverse', 'attack', 'release'],
              },
              speed: { type: ['number', 'null'], enum: [0.25, 0.5, 1, 1.5, 2, 3, 4, null] },
              loopRegion: {
                type: ['object', 'null'], additionalProperties: false,
                properties: { startCell: { type: 'integer' }, endCell: { type: 'integer' } },
                required: ['startCell', 'endCell'],
              },
              gridResolution: { type: ['string', 'null'], enum: ['4n', '8n', '8t', '16n', '16t', '32n', null] },
              pitchVariety: {
                type: ['object', 'null'], additionalProperties: false,
                properties: {
                  contour: { type: 'string', enum: ['geographic', 'randomWalk', 'arch'] },
                  variety: { type: 'number' },
                },
                required: ['contour', 'variety'],
              },
            },
            required: [
              'routeId', 'synthType', 'samplerPreset', 'volume', 'pan', 'octave', 'glide', 'legato',
              'scale', 'drone', 'arp', 'granular', 'speed', 'loopRegion', 'gridResolution', 'pitchVariety',
            ],
          },
        },
        fx: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false,
            properties: {
              busId: { type: 'string' },
              wet: nullableNumber,
              params: {
                type: 'array',
                items: {
                  type: 'object', additionalProperties: false,
                  properties: {
                    paramId: { type: 'string' },
                    value: { anyOf: [{ type: 'number' }, { type: 'string' }] },
                  },
                  required: ['paramId', 'value'],
                },
              },
              sends: {
                type: 'array',
                items: {
                  type: 'object', additionalProperties: false,
                  properties: { routeId: { type: 'string' }, level: { type: 'number' } },
                  required: ['routeId', 'level'],
                },
              },
            },
            required: ['busId', 'wet', 'params', 'sends'],
          },
        },
      },
      required: ['summary', 'bpm', 'harmony', 'masterVolume', 'tracks', 'fx'],
    },
  },
}

// Some models wrap JSON in a ```json … ``` markdown fence despite being asked
// not to (and despite response_format: json_object). Peel it off before parsing.
function stripJsonFence(text) {
  const t = text.trim()
  const fence = t.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i)
  return (fence ? fence[1] : t).trim()
}

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

  const claim = await claimUsage(session.user.id, 'ai')
  if (!claim.allowed) {
    return Response.json({
      error: 'AI Composer allowance reached. Upgrade to Pro for 50 compositions each month.',
      code: 'ai_limit_reached',
      entitlements: claim.entitlements,
    }, { status: 403 })
  }

  try {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
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
        max_completion_tokens: 3000,
      }),
    })

    if (!r.ok) {
      const detail = await r.text()
      console.error('[compose] OpenRouter error', r.status, detail)
      if (claim.metered) await releaseUsage(session.user.id, 'ai')
      return Response.json({ error: `OpenRouter ${r.status}`, detail }, { status: 502 })
    }

    const data = await r.json()
    const content = data?.choices?.[0]?.message?.content
    if (!content) {
      if (claim.metered) await releaseUsage(session.user.id, 'ai')
      return Response.json({ error: 'No content returned from model' }, { status: 502 })
    }

    let plan
    try { plan = JSON.parse(stripJsonFence(content)) }
    catch {
      if (claim.metered) await releaseUsage(session.user.id, 'ai')
      return Response.json({ error: 'Model returned invalid JSON', raw: content }, { status: 502 })
    }

    return Response.json(plan)
  } catch (err) {
    console.error('[compose] failed', err)
    if (claim.metered) await releaseUsage(session.user.id, 'ai').catch(() => {})
    return Response.json({ error: String(err?.message ?? err) }, { status: 502 })
  }
}
