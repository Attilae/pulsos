// Compare keyword recipe selection with Jev's on sample prompts (prototype eval
// for app/api/compose/recipe). Needs TYPESAFE_API_KEY; reads .env.local/.env.
//   node scripts/jev_recipe_eval.js ["another prompt" ...]
// With arguments, only those prompts run.

import { readFileSync, existsSync } from 'node:fs'
import { selectRecipe } from '../lib/ai/musicalPolicy.js'
import { JEV_ENDPOINT, DEFAULT_MIN_CONFIDENCE, buildRecipeRequest, interpretRecipeAnswer } from '../lib/ai/recipeClassifier.js'

for (const f of ['.env.local', '.env']) {
  if (!existsSync(f)) continue
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m && process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
  }
}

const key = process.env.TYPESAFE_API_KEY
if (!key) { console.error('TYPESAFE_API_KEY missing'); process.exit(1) }
const parsed = Number.parseFloat(process.env.JEV_RECIPE_MIN_CONFIDENCE)
const minConfidence = Number.isFinite(parsed) ? parsed : DEFAULT_MIN_CONFIDENCE

const PROMPTS = process.argv.length > 2 ? process.argv.slice(2) : [
  // named styles — keywords already handle these; Jev should agree
  'a warm deep house groove', 'dub techno, lots of echo', 'lofi beats to study to', 'fast liquid dnb',
  // implied styles — what the prototype is for
  'something for a rainy night drive', 'music for a 3am warehouse rave', 'calm sunrise over the harbour',
  'like Burial on the night bus', 'neon-lit chase scene from an 80s movie', 'Sunday morning coffee, jazzy keys',
  'euphoric hands-in-the-air festival moment', 'Aphex Twin selected ambient works vibe',
  // no style — Jev should say none or stay under the gate
  'make it louder', 'use the metro lines', 'something calm for the morning commute',
]

const rows = []
for (const prompt of PROMPTS) {
  const kw = selectRecipe(prompt)
  const t = Date.now()
  let jev = '—', conf = '', ms = ''
  try {
    const r = await fetch(JEV_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildRecipeRequest(prompt)),
    })
    ms = Date.now() - t
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
    const data = await r.json()
    const { recipeId, confidence } = interpretRecipeAnswer(data, { minConfidence })
    jev = `${data.answers?.recipe?.choice}${recipeId ? '' : ' (rejected)'}`
    conf = confidence?.toFixed(2) ?? ''
  } catch (e) {
    jev = `error: ${e.message}`
  }
  rows.push({ prompt, keyword: kw ? kw.recipe.id : '—', jev, confidence: conf, ms })
}
console.table(rows)
console.log(`min confidence: ${minConfidence}. In the app Jev is only consulted when "keyword" is —.`)
