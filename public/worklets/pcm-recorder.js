// PCM capture sink for WAV export (lib/audioExport.js).
//
// Served as-is from /worklets/ and loaded with audioWorklet.addModule, so it can't
// import from lib/. No `export`/`import` here either: Tone's context is a
// standardized-audio-context, which re-evaluates worklet source wrapped inside a
// function body, where a top-level `export` is a syntax error.
//
// The node has no outputs, so it's a pure sink: the renderer still runs it while
// it's connected, and nothing it does can reach the speakers. Render quanta are
// batched into CHUNK_FRAMES-sized blocks before posting, so the main thread gets
// ~12 messages a second instead of ~375. A 'stop' message flushes the partial
// block and answers 'done', after which the processor lets itself be collected.

const CHUNK_FRAMES = 4096

class PcmRecorderProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    this._channels = options?.processorOptions?.channels ?? 2
    this._stopped = false
    this._alloc()
    this.port.onmessage = ({ data }) => {
      if (data !== 'stop' || this._stopped) return
      this._stopped = true
      this._flush()
      this.port.postMessage('done')
    }
  }

  _alloc() {
    this._buf = Array.from({ length: this._channels }, () => new Float32Array(CHUNK_FRAMES))
    this._fill = 0
  }

  _flush() {
    if (!this._fill) return
    const block = this._buf.map(ch => ch.slice(0, this._fill))
    this.port.postMessage(block, block.map(ch => ch.buffer))
    this._alloc()
  }

  process(inputs) {
    if (this._stopped) return false
    const input = inputs[0]
    // An input with no connections reports zero channels: record silence so the
    // file stays time-aligned with the other taps.
    const frames = input?.[0]?.length ?? 128
    let offset = 0
    while (offset < frames) {
      const n = Math.min(frames - offset, CHUNK_FRAMES - this._fill)
      for (let ch = 0; ch < this._channels; ch++) {
        const src = input?.[ch] ?? input?.[0]
        if (src) this._buf[ch].set(src.subarray(offset, offset + n), this._fill)
        else this._buf[ch].fill(0, this._fill, this._fill + n)
      }
      this._fill += n
      offset += n
      if (this._fill === CHUNK_FRAMES) this._flush()
    }
    return true
  }
}

registerProcessor('pcm-recorder', PcmRecorderProcessor)
