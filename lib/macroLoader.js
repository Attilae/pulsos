// Loads the Macro DSP for an audio context: fetches + compiles the wasm once
// per asset version, registers the worklet once per context, and warms the
// worklet's own compiled-module cache so the first lane's node never compiles on
// the audio thread mid-song. Browser-only (engine side); the pure vocabulary is
// lib/macroSpecs.js.
//
// Failures are cached as nothing: a rejected load clears its promise, so the
// next prepare retries instead of replaying the old error forever.

import * as Tone from 'tone'
import { MACRO_WASM_URL, MACRO_WASM_SHA256 } from './macroAsset.js'

export const MACRO_PROCESSOR = 'leid-macro'
export const MACRO_WORKLET_URL = `/worklets/macro-processor.js?v=${MACRO_WASM_SHA256.slice(0, 8)}`

// A user-facing error: `message` says what to do, never what the compiler did.
export class MacroUnavailableError extends Error {
  constructor(message, cause) {
    super(message)
    this.name = 'MacroUnavailableError'
    this.cause = cause
  }
}

// 'idle' | 'loading' | 'ready' | 'error' for Tone's context — what the lane
// editors show (MacroControls).
let status = 'idle'
const listeners = new Set()
function setStatus(next) {
  if (next === status) return
  status = next
  for (const fn of listeners) fn()
}
export function getMacroStatus() { return status }
export function subscribeMacroStatus(fn) {
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
      if (typeof WebAssembly !== 'object') {
        throw new MacroUnavailableError('This browser cannot run the Macro instrument.')
      }
      let res
      try {
        res = await fetch(MACRO_WASM_URL)
      } catch (err) {
        throw new MacroUnavailableError('The Macro instrument could not be downloaded. Check your connection and try again.', err)
      }
      if (!res.ok) {
        throw new MacroUnavailableError('The Macro instrument could not be downloaded. Try again in a moment.', new Error(`HTTP ${res.status}`))
      }
      const bytes = await res.arrayBuffer()
      let module
      try {
        module = await WebAssembly.compile(bytes)
      } catch (err) {
        throw new MacroUnavailableError('This browser cannot run the Macro instrument.', err)
      }
      asset = { bytes, module }
      return asset
    })().catch((err) => { assetPromise = null; throw err })
  }
  return assetPromise
}

// Start the download/compile without an audio context (e.g. when a song that
// uses Macro is opened). Errors are left for prepareMacro to report.
export function warmMacroAsset() {
  return loadAsset().then(() => true, () => false)
}

function rawContextOf(context) {
  return (context ?? Tone.getContext()).rawContext ?? context
}

// Options every node needs to build its processor. Bytes rather than the
// compiled Module: not every browser can structured-clone a WebAssembly.Module
// into the audio thread, and the worklet caches its compile per context anyway.
export function macroProcessorOptions() {
  if (!asset) throw new MacroUnavailableError('The Macro instrument is still loading.')
  return { bytes: asset.bytes, sha256: MACRO_WASM_SHA256 }
}

export function isMacroReady(context) {
  return !!asset && readyContexts.has(rawContextOf(context))
}

// Resolve once lanes on `context` (a Tone context; default: Tone's) can build
// Macro voices synchronously. Safe to call repeatedly and concurrently.
export function prepareMacro(context) {
  const toneCtx = context ?? Tone.getContext()
  const raw = rawContextOf(toneCtx)
  if (readyContexts.has(raw) && asset) return Promise.resolve()
  let p = contexts.get(raw)
  if (!p) {
    setStatus('loading')
    p = (async () => {
      const worklet = raw.audioWorklet
      if (!worklet) throw new MacroUnavailableError('This browser cannot run the Macro instrument (no AudioWorklet support).')
      const [, loaded] = await Promise.all([
        // Not Tone's addAudioWorkletModule: it caches the first module it's
        // handed per context and returns that promise for every later URL.
        worklet.addModule(MACRO_WORKLET_URL).catch((err) => {
          throw new MacroUnavailableError('The Macro instrument could not be loaded. Try again in a moment.', err)
        }),
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

// Build one silent throwaway node so the worklet compiles and caches the module
// now, then wait for its handshake. Also proves instantiation works before any
// lane depends on it.
function warmWorklet(toneCtx, loaded) {
  return new Promise((resolve, reject) => {
    let node
    try {
      node = toneCtx.createAudioWorkletNode(MACRO_PROCESSOR, {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions: { bytes: loaded.bytes, sha256: MACRO_WASM_SHA256 },
      })
    } catch (err) {
      reject(new MacroUnavailableError('The Macro instrument could not start.', err))
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
    const timer = setTimeout(() => done(), raw(toneCtx).state === 'running' ? 4000 : 0)
    node.port.onmessage = ({ data }) => {
      if (data?.type === 'ready') done()
      else if (data?.type === 'error') done(new MacroUnavailableError('The Macro instrument could not start.', new Error(data.message)))
    }
    node.onprocessorerror = () => done(new MacroUnavailableError('The Macro instrument could not start.'))
  })
}

function raw(toneCtx) {
  return toneCtx.rawContext ?? toneCtx
}
