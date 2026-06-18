// Real-time audio export (WAV stems + mixdown).
//
// Unlike lib/midiExport.js (which reconstructs note data), this captures the
// *actual sound* by tapping live engine nodes during one real-time playback
// pass: each route's output node for a dry stem, and the master output for the
// full mix. All taps run simultaneously so stems and mix stay phase-aligned.
//
// Capture uses a ScriptProcessorNode (deprecated but universally supported and
// needs no worklet-module bundling). Each capture node is connected to the
// destination with an untouched (silent) output buffer so onaudioprocess fires
// without doubling the audible signal. We accumulate Float32 chunks and encode
// interleaved 16-bit PCM WAV on stop.
import { isRouteExportable, isRouteAudible } from './midiExport.js'
import { GRID_TOTAL_CELLS } from './mappings.js'

const LOOP_BEATS = 16
const BUFFER_SIZE = 4096

// Records raw PCM from a single source node into per-channel Float32 chunks.
export class PcmRecorder {
  constructor(ctx, sourceNode) {
    this.ctx = ctx
    this.source = sourceNode
    this.sampleRate = ctx.sampleRate
    this._chunks = []          // Array<Float32Array[]>  (per process block, per channel)
    this._channels = 2
    this._processor = null
  }

  start() {
    const processor = this.ctx.createScriptProcessor(BUFFER_SIZE, this._channels, this._channels)
    processor.onaudioprocess = (e) => {
      const input = e.inputBuffer
      const block = []
      for (let ch = 0; ch < input.numberOfChannels; ch++) {
        // copy — the underlying buffer is reused across callbacks
        block.push(new Float32Array(input.getChannelData(ch)))
      }
      this._chunks.push(block)
    }
    // tap source → processor → destination (silent output keeps it processing)
    this.source.connect(processor)
    processor.connect(this.ctx.destination)
    this._processor = processor
  }

  stop() {
    if (this._processor) {
      try { this.source.disconnect(this._processor) } catch {}
      this._processor.disconnect()
      this._processor.onaudioprocess = null
      this._processor = null
    }
    const numCh = this._chunks[0]?.length ?? this._channels
    const total = this._chunks.reduce((n, b) => n + (b[0]?.length ?? 0), 0)
    const channels = []
    for (let ch = 0; ch < numCh; ch++) {
      const out = new Float32Array(total)
      let offset = 0
      for (const block of this._chunks) {
        const data = block[ch] ?? block[0]
        out.set(data, offset)
        offset += data.length
      }
      channels.push(out)
    }
    this._chunks = []
    return { channels, sampleRate: this.sampleRate }
  }
}

// Encode per-channel Float32 PCM into a 16-bit WAV blob.
export function encodeWav({ channels, sampleRate }) {
  const numCh = channels.length || 1
  const numFrames = channels[0]?.length ?? 0
  const bytesPerSample = 2
  const blockAlign = numCh * bytesPerSample
  const dataSize = numFrames * blockAlign
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)) }

  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)            // PCM chunk size
  view.setUint16(20, 1, true)             // audio format = PCM
  view.setUint16(22, numCh, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 8 * bytesPerSample, true)
  writeStr(36, 'data')
  view.setUint32(40, dataSize, true)

  let off = 44
  for (let i = 0; i < numFrames; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      let s = channels[ch][i]
      s = Math.max(-1, Math.min(1, s))
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true)
      off += 2
    }
  }
  return new Blob([buffer], { type: 'audio/wav' })
}

export function downloadWavBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

const sanitize = (s) => String(s ?? '').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '')

// The render length for a single route's loop, mirroring buildLoopMidiEvents.
function routeLoopSec(route, ctx) {
  const bpm = ctx.bpm ?? 120
  const speed = ctx.trackSpeeds?.[route.id] ?? 1
  const region = ctx.trackLoopRegions?.[route.id]
  const startCell = Math.max(0, Math.min(GRID_TOTAL_CELLS - 1, region?.startCell ?? 0))
  const endCell = Math.max(startCell + 1, Math.min(GRID_TOTAL_CELLS, region?.endCell ?? GRID_TOTAL_CELLS))
  const regionLen = endCell - startCell
  const loopSec = (LOOP_BEATS / bpm) * 60
  return (regionLen / GRID_TOTAL_CELLS) * loopSec / speed
}

// Longest audible track loop across the mix (default capture window).
export function defaultCaptureDuration(routes, ctx, { loops = 1, min = 2 } = {}) {
  let max = 0
  for (const route of routes ?? []) {
    if (!isRouteExportable(route, route.id, ctx)) continue
    max = Math.max(max, routeLoopSec(route, ctx))
  }
  return Math.max(min, max * loops)
}

const wait = (ms) => new Promise(r => setTimeout(r, ms))

// Capture audio in one real-time pass. Returns the number of files downloaded.
// engine must expose getRouteOutputNode / getMasterOutputNode / getAudioContext.
export async function captureAudio(engine, routes, ctx, {
  durationSec,
  stems = false,
  mixdown = true,
  loops = 1,
  onProgress,
} = {}) {
  const audioCtx = engine.getAudioContext?.()
  if (!audioCtx) return 0
  const dur = durationSec ?? defaultCaptureDuration(routes, ctx, { loops })

  const taps = []   // { recorder, filename, isMix }

  if (mixdown) {
    const node = engine.getMasterOutputNode?.()
    if (node) {
      taps.push({
        recorder: new PcmRecorder(audioCtx, node),
        filename: `transit-mix-${ctx.bpm ?? 120}bpm-${Date.now()}.wav`,
        isMix: true,
      })
    }
  }

  if (stems) {
    for (const route of routes ?? []) {
      if (!isRouteExportable(route, route.id, ctx)) continue
      const node = engine.getRouteOutputNode?.(route.id)
      if (!node) continue
      taps.push({
        recorder: new PcmRecorder(audioCtx, node),
        filename: `transit-${sanitize(route.type)}-${sanitize(route.name)}.wav`,
        isMix: false,
      })
    }
  }

  if (!taps.length) return 0

  for (const t of taps) t.recorder.start()

  // progress loop
  const startedAt = (typeof performance !== 'undefined' ? performance.now() : Date.now())
  const totalMs = dur * 1000
  while (true) {
    const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt
    onProgress?.(Math.min(1, elapsed / totalMs))
    if (elapsed >= totalMs) break
    await wait(Math.min(100, totalMs - elapsed))
  }

  let count = 0
  for (const t of taps) {
    const pcm = t.recorder.stop()
    if (!pcm.channels[0]?.length) continue
    downloadWavBlob(encodeWav(pcm), t.filename)
    count++
    await wait(150)   // stagger downloads so browsers don't suppress them
  }
  onProgress?.(1)
  return count
}

// Parallels exportRouteMidi / exportMixMidi (lib/midiExport.js).
export function exportRouteAudio(engine, route, ctx, opts = {}) {
  if (!isRouteExportable(route, route.id, ctx)) return Promise.resolve(0)
  return captureAudio(engine, [route], ctx, { ...opts, stems: true, mixdown: false })
}

export function exportMixAudio(engine, routes, ctx, opts = {}) {
  return captureAudio(engine, routes ?? [], ctx, { ...opts, stems: false, mixdown: true })
}
