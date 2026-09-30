// Loads Texture's DSP (the Clouds-derived granular processor) for an audio context: fetches + compiles the wasm
// once per asset version, registers the worklet once per context, and warms the
// worklet's compiled-module cache so a lane's node never compiles mid-song.
// Same shape as lib/resonatorLoader.js. Browser-only.
//
// A rejected load clears its promise, so the next prepare retries instead of
// replaying the old error forever. TextureVoice (lib/textureVoice.js) passes the
// lane through dry when this fails; it never leaves a lane silent.

import * as Tone from 'tone'
import { CLOUDS_WASM_URL, CLOUDS_WASM_SHA256 } from './cloudsGranularAsset.js'

export const CLOUDS_PROCESSOR = 'leid-clouds-granular'
export const CLOUDS_WORKLET_URL = `/worklets/clouds-granular-processor.js?v=${CLOUDS_WASM_SHA256.slice(0, 8)}`

// 'idle' | 'loading' | 'ready' | 'error' for Tone's context: what the Texture
// panel shows (components/TextureControls.jsx).
let status = 'idle'
const listeners = new Set()
function setStatus(next) {
  if (next === status) return
  status = next
  for (const fn of listeners) fn()
}
export function getCloudsStatus() { return status }
export function subscribeCloudsStatus(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

let assetPromise = null            // { bytes: ArrayBuffer, module: WebAssembly.Module }
let asset = null
const contexts = new WeakMap()     // rawContext → Promise<void>
const readyContexts = new WeakSet()

function loadAsset() {
  if (asset) return Promise.resolve(asset)
  if (!assetPromise) {
    assetPromise = (async () => {
      if (typeof WebAssembly !== 'object') throw new Error('WebAssembly unavailable')
      const res = await fetch(CLOUDS_WASM_URL)
      if (!res.ok) throw new Error(`clouds wasm HTTP ${res.status}`)
      const bytes = await res.arrayBuffer()
      const module = await WebAssembly.compile(bytes)
      asset = { bytes, module }
      return asset
    })().catch((err) => { assetPromise = null; throw err })
  }
  return assetPromise
}

function rawContextOf(context) {
  return (context ?? Tone.getContext()).rawContext ?? context
}

// Bytes rather than the compiled Module: not every browser can structured-clone
// a WebAssembly.Module into the audio thread, and the worklet caches its compile
// per context anyway.
export function cloudsProcessorOptions() {
  if (!asset) throw new Error('Clouds granular DSP is still loading')
  return { bytes: asset.bytes, sha256: CLOUDS_WASM_SHA256 }
}

export function isCloudsReady(context) {
  return !!asset && readyContexts.has(rawContextOf(context))
}

// Resolve once granular layers on `context` (a Tone context; default: Tone's)
// can build Clouds nodes synchronously. Safe to call repeatedly and concurrently.
export function prepareCloudsGranular(context) {
  const toneCtx = context ?? Tone.getContext()
  const raw = rawContextOf(toneCtx)
  if (readyContexts.has(raw) && asset) return Promise.resolve()
  let p = contexts.get(raw)
  if (!p) {
    setStatus('loading')
    p = (async () => {
      const worklet = raw.audioWorklet
      if (!worklet) throw new Error('AudioWorklet unavailable')
      const [, loaded] = await Promise.all([
        // Not Tone's addAudioWorkletModule: it caches the first module it's
        // handed per context and returns that promise for every later URL.
        worklet.addModule(CLOUDS_WORKLET_URL),
        loadAsset(),
      ])
      await warmWorklet(toneCtx, loaded)
      readyContexts.add(raw)
      setStatus('ready')
    })().catch((err) => { contexts.delete(raw); setStatus('error'); throw err })
    contexts.set(raw, p)
  }
  return p
}

// One silent throwaway node so the worklet compiles and caches the module now,
// and so instantiation is proven before any lane depends on it.
function warmWorklet(toneCtx, loaded) {
  return new Promise((resolve, reject) => {
    let node
    try {
      node = toneCtx.createAudioWorkletNode(CLOUDS_PROCESSOR, {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions: { bytes: loaded.bytes, sha256: CLOUDS_WASM_SHA256 },
      })
    } catch (err) {
      reject(err)
      return
    }
    const done = (err) => {
      clearTimeout(timer)
      try { node.port.postMessage({ type: 'dispose' }) } catch {}
      try { node.port.close() } catch {}
      err ? reject(err) : resolve()
    }
    // A suspended context never runs the processor constructor; that isn't a
    // failure, the node will instantiate on resume. Only a real error rejects.
    const running = (toneCtx.rawContext ?? toneCtx).state === 'running'
    const timer = setTimeout(() => done(), running ? 4000 : 0)
    node.port.onmessage = ({ data }) => {
      if (data?.type === 'ready') done()
      else if (data?.type === 'error') done(new Error(data.message))
    }
    node.onprocessorerror = () => done(new Error('clouds processor error'))
  })
}
