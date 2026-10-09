// Loads the Analog lane filter's DSP (DaisySP LadderFilter) for an audio context:
// fetches + compiles the wasm once per asset version, registers the worklet once
// per context, and warms the worklet's compiled-module cache so a lane's node
// never compiles mid-song. Same shape as lib/cloudsGranularLoader.js.
// Browser-only.
//
// A rejected load clears its promise, so the next prepare (or retryLadder) tries
// again instead of replaying the old error forever. LaneFilter (lib/laneFilter.js)
// keeps a lane on its Classic filter until this resolves, and stays there if it
// fails; it subscribes to the status so a successful retry upgrades waiting lanes.

import * as Tone from 'tone'
import { LADDER_WASM_URL, LADDER_WASM_SHA256 } from './ladderAsset.js'

export const LADDER_PROCESSOR = 'leid-ladder-filter'
export const LADDER_WORKLET_URL = `/worklets/ladder-processor.js?v=${LADDER_WASM_SHA256.slice(0, 8)}`

// 'idle' | 'loading' | 'ready' | 'error' for Tone's context: what the filter
// panels show (lib/shared/useLadderStatus.js).
let status = 'idle'
let lastError = null
const listeners = new Set()
function setStatus(next) {
  if (next === status) return
  status = next
  for (const fn of [...listeners]) { try { fn(next) } catch {} }
}
export function getLadderStatus() { return status }
export function getLadderError() { return lastError }
export function subscribeLadderStatus(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

let assetPromise = null            // { bytes: ArrayBuffer }
let asset = null
const contexts = new WeakMap()     // rawContext → Promise<void>
const readyContexts = new WeakSet()

function loadAsset() {
  if (asset) return Promise.resolve(asset)
  if (!assetPromise) {
    assetPromise = (async () => {
      if (typeof WebAssembly !== 'object') throw new Error('WebAssembly unavailable')
      const res = await fetch(LADDER_WASM_URL)
      if (!res.ok) throw new Error(`ladder wasm HTTP ${res.status}`)
      const bytes = await res.arrayBuffer()
      await WebAssembly.compile(bytes)   // prove it compiles before any lane relies on it
      asset = { bytes }
      return asset
    })().catch((err) => { assetPromise = null; throw err })
  }
  return assetPromise
}

function rawContextOf(context) {
  return (context ?? Tone.getContext()).rawContext ?? context
}

// Bytes rather than a compiled Module: not every browser can structured-clone a
// WebAssembly.Module into the audio thread, and the worklet caches its compile
// per context anyway.
export function ladderProcessorOptions() {
  if (!asset) throw new Error('Analog filter DSP is still loading')
  return { bytes: asset.bytes, sha256: LADDER_WASM_SHA256 }
}

export function isLadderReady(context) {
  return !!asset && readyContexts.has(rawContextOf(context))
}

// Resolve once lanes on `context` (a Tone context; default: Tone's) can build
// Analog nodes synchronously. Safe to call repeatedly and concurrently.
export function prepareLadder(context) {
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
        worklet.addModule(LADDER_WORKLET_URL),
        loadAsset(),
      ])
      await warmWorklet(toneCtx, loaded)
      readyContexts.add(raw)
      lastError = null
      setStatus('ready')
    })().catch((err) => {
      contexts.delete(raw)
      lastError = err
      console.warn('[analog filter] unavailable, lanes use Classic:', err?.message ?? err)
      setStatus('error')
      throw err
    })
    contexts.set(raw, p)
  }
  return p
}

// The UI's "Retry": never rejects (the status carries the outcome).
export function retryLadder(context) {
  return prepareLadder(context).catch(() => {})
}

// One silent throwaway node so the worklet compiles and caches the module now,
// and so instantiation is proven before any lane depends on it.
function warmWorklet(toneCtx, loaded) {
  return new Promise((resolve, reject) => {
    let node
    try {
      node = toneCtx.createAudioWorkletNode(LADDER_PROCESSOR, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions: { bytes: loaded.bytes, sha256: LADDER_WASM_SHA256, suspended: true },
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
    node.onprocessorerror = () => done(new Error('ladder processor error'))
  })
}
