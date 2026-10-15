// TextureVoice's model-switch slot bookkeeping (lib/textureVoice.js), run on the
// real class source with Tone and the two loaders mocked. What it guards: every
// worklet node the voice builds is either the one carrying the lane or already
// retired, through reversed switches, superseded loads, load failures and
// disposal with a load still pending.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const SOURCE = readFileSync(new URL('../lib/textureVoice.js', import.meta.url), 'utf8')
  .replace(/import[\s\S]*?from ['"][^'"]+['"]\n/g, '')
  .replace('export class TextureVoice', 'class TextureVoice')

function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

// Fresh mocks per test: `ready` says which models load synchronously, `loads`
// collects each pending prepare() so a test can resolve/reject it.
function harness({ ready = { classic: true, mk2: false } } = {}) {
  const nodes = []
  const loads = { classic: [], mk2: [] }
  class Gain {
    constructor() {
      this.disposed = false
      this.gain = {
        setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {},
        getValueAtTime() { return 1 },
      }
    }
    connect() {}
    disconnect() {}
    dispose() { this.disposed = true }
  }
  const ctx = {
    createAudioWorkletNode(model) {
      const node = {
        model, disposed: false, messages: [],
        port: {
          postMessage(msg) { node.messages.push(msg); if (msg.type === 'dispose') node.disposed = true },
          close() {},
        },
        disconnect() {},
      }
      nodes.push(node)
      return node
    },
  }
  const prepare = model => () => {
    const d = deferred()
    loads[model].push(d)
    return d.promise
  }
  const env = {
    Tone: { Gain, getContext: () => ctx, now: () => 0, connect() {}, Time: () => ({ toSeconds: () => 0.5 }) },
    TEXTURE_DEFAULTS: {}, TEXTURE_MK2_DEFAULTS: {}, TEXTURE_MK2_MAKEUP_DB: 0,
    textureDspParams: () => ({}), beadsDspParams: () => ({}),
    textureModelOf: cfg => cfg.txModel ?? 'classic',
    CLOUDS_PROCESSOR: 'classic', cloudsProcessorOptions: () => ({}),
    isCloudsReady: () => ready.classic, prepareCloudsGranular: prepare('classic'),
    BEADS_PROCESSOR: 'mk2', beadsProcessorOptions: () => ({}),
    isBeadsReady: () => ready.mk2, prepareBeads: prepare('mk2'),
  }
  const TextureVoice = new Function(...Object.keys(env), `${SOURCE}\nreturn TextureVoice`)(...Object.values(env))
  const alive = () => nodes.filter(n => !n.disposed).map(n => n.model)
  return { TextureVoice, nodes, loads, ready, alive }
}

const settle = () => new Promise(resolve => setTimeout(resolve, 100))
const quiet = fn => async () => {
  const warn = console.warn
  console.warn = () => {}
  try { await fn() } finally { console.warn = warn }
}

test('a reversed switch while the new model loads keeps the original node', quiet(async () => {
  const h = harness()
  const voice = new h.TextureVoice()
  voice.set({ txModel: 'mk2' })
  voice.set({ txModel: 'classic' })
  h.loads.mk2[0].resolve()
  await settle()
  assert.deepEqual(h.alive(), ['classic'])
  assert.equal(h.nodes.length, 1, 'switching back must not build a second classic node')
  assert.equal(voice.model, 'classic')
  voice.dispose()
  await settle()
  assert.deepEqual(h.alive(), [])
}))

test('a completed switch retires the previous model', quiet(async () => {
  const h = harness()
  const voice = new h.TextureVoice()
  voice.set({ txModel: 'mk2' })
  h.loads.mk2[0].resolve()
  await settle()
  assert.deepEqual(h.alive(), ['mk2'])
  assert.equal(voice.model, 'mk2')
  assert.ok(voice.loaded)
  voice.dispose()
  await settle()
  assert.deepEqual(h.alive(), [])
}))

test('rapid switching with every load pending leaves one node per settled model', quiet(async () => {
  const h = harness({ ready: { classic: false, mk2: false } })
  const voice = new h.TextureVoice()            // classic pending
  for (let i = 0; i < 5; i++) {
    voice.set({ txModel: 'mk2' })
    voice.set({ txModel: 'classic' })
  }
  voice.set({ txModel: 'mk2' })
  for (const d of [...h.loads.classic, ...h.loads.mk2]) d.resolve()
  await settle()
  assert.deepEqual(h.alive(), ['mk2'])
  voice.dispose()
  await settle()
  assert.deepEqual(h.alive(), [])
}))

test('disposing with a load pending builds nothing afterwards', quiet(async () => {
  const h = harness()
  const voice = new h.TextureVoice()
  voice.set({ txModel: 'mk2' })
  voice.dispose()
  h.loads.mk2[0].resolve()
  await settle()
  assert.deepEqual(h.alive(), [])
  assert.deepEqual(h.nodes.map(n => n.model), ['classic'])
}))

test('a failed switch stays on the old model until retry()', quiet(async () => {
  const h = harness()
  const voice = new h.TextureVoice()
  voice.set({ txModel: 'mk2' })
  h.loads.mk2[0].reject(new Error('no wasm'))
  await settle()
  assert.deepEqual(h.alive(), ['classic'])
  assert.equal(voice.model, 'classic')
  assert.ok(voice.error)
  voice.set({ txSize: 0.3 })                    // knob turns don't re-attempt the load
  assert.equal(h.loads.mk2.length, 1)
  voice.retry()
  assert.equal(h.loads.mk2.length, 2)
  h.loads.mk2[1].resolve()
  await settle()
  assert.deepEqual(h.alive(), ['mk2'])
  assert.equal(voice.error, null)
  voice.dispose()
  await settle()
  assert.deepEqual(h.alive(), [])
}))

test('notes go to the model that is playing while a switch is pending', quiet(async () => {
  const h = harness()
  const voice = new h.TextureVoice()
  voice.set({ txModel: 'mk2' })
  voice.triggerAttackRelease('C4', '8n', 1)
  const [classic] = h.nodes
  assert.deepEqual(classic.messages.at(-1), { type: 'trig', time: 1, gen: 1 })
  voice.dispose()
}))
