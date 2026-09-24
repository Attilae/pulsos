import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { validatePlan } from '../lib/ai/planContract.js'
import { PLAN_INPUT_SCHEMA } from '../lib/ai/planSchema.js'
import { planAdvisories } from '../lib/ai/planAdvisories.js'

// The user-installable Agent Skill (skills/leid-composer) teaches an MCP client
// how to compose. It deliberately carries no vocabulary of its own — that comes
// from get_composer_guide — but its example plans still name instruments, FX and
// ranges, so every one is run through the real validator here. A vocabulary
// change that breaks a recipe fails this test instead of a user's first plan.

const SKILL_DIR = new URL('../skills/leid-composer/', import.meta.url).pathname
const TOOLS_SRC = readFileSync(new URL('../lib/server/mcpTools.js', import.meta.url), 'utf8')

const markdownFiles = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const path = join(dir, entry.name)
  if (entry.isDirectory()) return markdownFiles(path)
  return entry.name.endsWith('.md') ? [path] : []
})

const files = markdownFiles(SKILL_DIR).map(path => ({
  name: relative(SKILL_DIR, path),
  text: readFileSync(path, 'utf8'),
}))

const exampleSends = (plan) => (plan.fx ?? []).flatMap(fx => fx.sends ?? [])

// "<metro-1>" placeholders stand in for real ids from list_routes.
function withFakeRoutes(plan) {
  const ids = new Set()
  JSON.stringify(plan).replace(/"<([a-z]+)-(\d+)>"/g, (_, type, n) => ids.add(`${type}-${n}`))
  const json = JSON.stringify(plan).replace(/"<([a-z]+)-(\d+)>"/g, '"$1-$2"')
  return {
    plan: JSON.parse(json),
    routes: [...ids].map(id => ({ id, type: id.split('-')[0] })),
  }
}

const examples = files.flatMap(({ name, text }) =>
  [...text.matchAll(/```json\n([\s\S]*?)```/g)].map((match, i) => ({ label: `${name} #${i + 1}`, raw: match[1] })))

test('SKILL.md frontmatter is a valid Agent Skill header', () => {
  const skill = files.find(f => f.name === 'SKILL.md')
  assert.ok(skill, 'SKILL.md exists')
  const front = skill.text.match(/^---\n([\s\S]*?)\n---\n/)
  assert.ok(front, 'frontmatter block')
  const fields = Object.fromEntries(front[1].split('\n').map(line => {
    const at = line.indexOf(':')
    return [line.slice(0, at).trim(), line.slice(at + 1).trim()]
  }))
  assert.match(fields.name, /^[a-z0-9-]{1,64}$/)
  assert.equal(fields.name, 'leid-composer', 'name matches the folder')
  assert.ok(fields.description.length > 0 && fields.description.length <= 1024)
})

test('the skill ships example plans', () => {
  assert.ok(examples.length >= 3, `found ${examples.length} example plans`)
})

for (const { label, raw } of examples) {
  test(`example plan ${label} validates with nothing dropped or clamped`, () => {
    const { plan, routes } = withFakeRoutes(JSON.parse(raw))
    assert.equal(PLAN_INPUT_SCHEMA.safeParse(plan).success, true, 'matches the MCP plan input schema')

    const { plan: out, dropped } = validatePlan(plan, routes)
    assert.deepEqual(dropped, [])
    assert.equal(out.tracks.length, plan.tracks.length)

    // validatePlan drops some things silently (a bad arp style, an
    // out-of-range number is clamped), so check nothing was lost or changed.
    for (const [i, input] of plan.tracks.entries()) {
      const track = out.tracks[i]
      for (const [key, value] of Object.entries(input)) {
        if (value == null || key === 'label') continue
        assert.ok(key in track, `${input.routeId}.${key} survived validation`)
        if (typeof value === 'number') assert.equal(track[key], value, `${input.routeId}.${key} unclamped`)
        if (typeof value === 'object') {
          for (const [sub, subValue] of Object.entries(value)) {
            if (key === 'sidechain' && sub === 'source') continue // normalized to an internal id
            assert.deepEqual(track[key][sub], subValue, `${input.routeId}.${key}.${sub} unchanged`)
          }
        }
      }
    }

    for (const [i, fx] of (plan.fx ?? []).entries()) {
      const bus = out.fx[i]
      if (fx.wet != null) assert.equal(bus.wet, fx.wet, `${fx.busId}.wet unclamped`)
      for (const { paramId, value } of fx.params ?? []) {
        assert.equal(bus.params[paramId], value, `${fx.busId}.${paramId} unchanged`)
      }
    }
    assert.equal(out.fx.flatMap(fx => fx.sends).length, exampleSends(plan).length, 'every send kept')

    // The recipes teach by example, so each must follow the sound advice it
    // gives: nothing the preview would flag as not sounding as planned.
    assert.deepEqual(planAdvisories(out, { mode: 'new' }), [], 'no advisories')
  })
}

test('every MCP tool the skill names exists on the server', () => {
  const registered = new Set([...TOOLS_SRC.matchAll(/registerTool\('([a-z_]+)'/g)].map(m => m[1]))
  const mentioned = new Set(files.flatMap(({ text }) =>
    [...text.matchAll(/`([a-z]+(?:_[a-z]+)+)(?:\(|`)/g)].map(m => m[1])))
  const toolLike = [...mentioned].filter(name => /^(list|get|set|preview|create|apply)_/.test(name))
  assert.ok(toolLike.length >= 5, 'the skill names the tools it uses')
  for (const name of toolLike) assert.ok(registered.has(name), `tool "${name}" is registered`)
})
