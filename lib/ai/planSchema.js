// The AI plan's wire shape, defined once in Zod. Two consumers need it:
//   • POST /api/compose hands it to OpenRouter as a strict JSON schema, where
//     every property must be listed in `required` and "unset" is spelled null;
//   • the MCP server uses it as the tools' `plan` input, where a client should be
//     able to simply omit what it doesn't want to change.
// `makePlanSchema({ strict })` builds either from the same field list, so the two
// can't drift. This is only the *shape*: value ranges, vocabulary and cross-field
// rules are enforced by validatePlan (./planContract.js), which reports what it
// drops instead of rejecting the plan. Kept separate from planContract.js so the
// browser bundle (AI Composer panel) doesn't pull in Zod.

import { z } from 'zod'
import { FILTER_TYPES, GRID_RESOLUTIONS, TRACK_SPEEDS, PITCH_CONTOURS, LABEL_NAMES, DRUM_PAD_IDS, MAX_FX_BUSES } from './planContract.js'
import { STEP_LEVELS, STEPS } from '../drumSpecs.js'
import { OSC_TYPES } from '../soundSpecs.js'

export function makePlanSchema({ strict = false } = {}) {
  // strict: key required, null allowed. lenient: key may also be omitted.
  const opt = (schema) => strict ? schema.nullable() : schema.nullish()
  // Lenient mode caps list sizes so a runaway client can't post a huge plan; the
  // strict schema stays free of maxItems, which strict structured output rejects.
  const list = (schema, max) => strict ? z.array(schema) : z.array(schema).max(max)

  const harmony = z.object({ root: z.string(), scaleType: z.string() })
  const filter = z.object({
    type: z.enum(FILTER_TYPES),
    frequency: z.number(),
    Q: z.number(),
  })

  const track = z.object({
    routeId: z.string(),
    synthType: opt(z.string()),
    samplerPreset: opt(z.string()),
    drumVoice: opt(z.string()),
    volume: opt(z.number()),
    pan: opt(z.number()),
    octave: opt(z.number()),
    glide: opt(z.number()),
    legato: opt(z.boolean()),
    envelope: opt(z.object({
      attack: z.number(), decay: z.number(), sustain: z.number(), release: z.number(),
    })),
    // Synthesis params beyond the amp envelope; which keys apply depends on the
    // synthType (soundSpecs.TONE_SUPPORT), enforced by validatePlan.
    tone: opt(z.object({
      oscillator: opt(z.enum(OSC_TYPES)),
      harmonicity: opt(z.number()),
      modulationIndex: opt(z.number()),
      modEnvelope: opt(z.object({
        attack: z.number(), decay: z.number(), sustain: z.number(), release: z.number(),
      })),
    })),
    filter: opt(filter),
    scale: opt(harmony),
    drone: opt(z.object({ enabled: z.boolean(), root: opt(z.string()) })),
    arp: opt(z.object({
      enabled: z.boolean(), style: z.string(), rate: z.string(),
      gate: z.number(), octaves: z.number(), steps: z.number(), distance: z.number(),
    })),
    granular: opt(z.object({
      enabled: z.boolean(), mix: z.number(), grainSize: z.number(),
      overlap: z.number(), playbackRate: z.number(), loopStart: z.number(),
      loopEnd: z.number(), jitter: z.number(), reverse: z.boolean(),
      attack: z.number(), release: z.number(),
    })),
    speed: opt(z.literal(TRACK_SPEEDS)),
    loopRegion: opt(z.object({ startCell: z.int(), endCell: z.int() })),
    gridResolution: opt(z.enum(GRID_RESOLUTIONS)),
    pitchVariety: opt(z.object({ contour: z.enum(PITCH_CONTOURS), variety: z.number() })),
    noteChance: opt(z.number()),
    loopPattern: opt(z.object({ play: z.int(), rest: z.int(), offset: z.int() })),
    label: opt(z.enum(LABEL_NAMES)),
    sidechain: opt(z.object({
      enabled: z.boolean(), source: z.string(),
      amountDb: z.number(), attack: z.number(), release: z.number(),
    })),
  })

  const drums = z.object({
    enabled: z.boolean(),
    volume: opt(z.number()),
    filter: opt(filter),
    patterns: list(z.object({
      padId: z.enum(DRUM_PAD_IDS),
      steps: strict ? z.array(z.literal(STEP_LEVELS)) : z.array(z.number()).length(STEPS),
    }), DRUM_PAD_IDS.length),
  })

  const fx = z.object({
    busId: z.string(),
    wet: opt(z.number()),
    params: list(z.object({
      paramId: z.string(),
      value: z.union([z.number(), z.string()]),
    }), 16),
    sends: list(z.object({ routeId: z.string(), level: z.number() }), 64),
  })

  return z.object({
    summary: strict ? z.string() : z.string().max(500).optional(),
    bpm: opt(z.number()),
    harmony: opt(harmony),
    masterVolume: opt(z.number()),
    tracks: list(track, 64),
    drums: opt(drums),
    fx: strict ? z.array(fx) : z.array(fx).max(MAX_FX_BUSES * 2).optional(),
  })
}

// OpenRouter `response_format` for POST /api/compose.
export const COMPOSITION_RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'leid_loop_plan',
    strict: true,
    schema: (({ $schema, ...schema }) => schema)(z.toJSONSchema(makePlanSchema({ strict: true }))),
  },
}

// MCP tool input (see lib/server/mcpTools.js).
export const PLAN_INPUT_SCHEMA = makePlanSchema({ strict: false })
