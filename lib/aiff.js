// Minimal AIFF / AIFF-C decoder. Chrome and Firefox's decodeAudioData reject
// AIFF, but it's what Logic and many sample packs export, so the reference-loop
// upload parses it here and builds the AudioBuffer itself. Covers uncompressed
// PCM only: AIFF, and AIFF-C with NONE/twos (big-endian), sowt (little-endian)
// and fl32/fl64 (big-endian float). Anything else gets a clear error rather than
// noise. Pure (no DOM), so it's testable in node.

const td = (view, off) => String.fromCharCode(
  view.getUint8(off), view.getUint8(off + 1), view.getUint8(off + 2), view.getUint8(off + 3),
)

export function isAiff(arrayBuffer) {
  if (!arrayBuffer || arrayBuffer.byteLength < 12) return false
  const view = new DataView(arrayBuffer)
  const form = td(view, 8)
  return td(view, 0) === 'FORM' && (form === 'AIFF' || form === 'AIFC')
}

// IEEE 754 80-bit extended (big-endian) → number. AIFF stores its sample rate so.
export function readExtended(view, off) {
  const signExp = view.getUint16(off)
  const hi = view.getUint32(off + 2)
  const lo = view.getUint32(off + 6)
  const sign = signExp & 0x8000 ? -1 : 1
  const exp = signExp & 0x7fff
  if (exp === 0 && hi === 0 && lo === 0) return 0
  if (exp === 0x7fff) return NaN
  const mantissa = hi * 2 ** 32 + lo
  return sign * mantissa * 2 ** (exp - 16383 - 63)
}

const PCM_BE = new Set(['NONE', 'twos'])
const PCM_LE = new Set(['sowt'])
const FLOAT_BE = { fl32: 32, FL32: 32, fl64: 64, FL64: 64 }

// → { sampleRate, channels: Float32Array[] }. Throws Error with a UI-ready message.
export function decodeAiff(arrayBuffer) {
  if (!isAiff(arrayBuffer)) throw new Error('Not an AIFF file')
  const view = new DataView(arrayBuffer)
  const isAifc = td(view, 8) === 'AIFC'
  let comm = null
  let ssnd = null
  let off = 12
  while (off + 8 <= view.byteLength) {
    const id = td(view, off)
    const size = view.getUint32(off + 4)
    const body = off + 8
    if (id === 'COMM') comm = { off: body, size }
    else if (id === 'SSND') ssnd = { off: body, size }
    off = body + size + (size & 1)
  }
  if (!comm) throw new Error('AIFF file has no format chunk')
  if (!ssnd) throw new Error('AIFF file has no audio')

  const numChannels = view.getInt16(comm.off)
  const numFrames = view.getUint32(comm.off + 2)
  const sampleSize = view.getInt16(comm.off + 6)
  const sampleRate = readExtended(view, comm.off + 8)
  let compression = 'NONE'
  if (isAifc && comm.size >= 22) compression = td(view, comm.off + 18)

  if (!(numChannels > 0)) throw new Error('AIFF file has no channels')
  if (!(sampleRate >= 3000 && sampleRate <= 768000)) throw new Error('Unsupported AIFF sample rate')

  let bytesPer
  let read
  if (FLOAT_BE[compression]) {
    const bits = FLOAT_BE[compression]
    bytesPer = bits / 8
    read = bits === 32 ? (p) => view.getFloat32(p) : (p) => view.getFloat64(p)
  } else if (PCM_BE.has(compression) || PCM_LE.has(compression)) {
    if (!(sampleSize >= 1 && sampleSize <= 32)) throw new Error('Unsupported AIFF bit depth')
    bytesPer = Math.ceil(sampleSize / 8)
    const le = PCM_LE.has(compression)
    const full = 2 ** (bytesPer * 8 - 1)
    read = (p) => {
      let v = 0
      for (let b = 0; b < bytesPer; b++) {
        v = v * 256 + view.getUint8(le ? p + bytesPer - 1 - b : p + b)
      }
      if (v >= full) v -= full * 2
      return v / full
    }
  } else {
    throw new Error(`Compressed AIFF (${compression.trim()}) isn't supported; export it as WAV or uncompressed AIFF`)
  }

  const dataOffset = view.getUint32(ssnd.off)
  const start = ssnd.off + 8 + dataOffset
  const frameBytes = bytesPer * numChannels
  const available = Math.max(0, Math.floor((Math.min(view.byteLength, ssnd.off + ssnd.size) - start) / frameBytes))
  const frames = Math.min(numFrames, available)
  if (!(frames > 0)) throw new Error('AIFF file has no audio')

  const channels = Array.from({ length: numChannels }, () => new Float32Array(frames))
  let p = start
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numChannels; c++) {
      channels[c][i] = read(p)
      p += bytesPer
    }
  }
  return { sampleRate, channels }
}

// Build an AudioBuffer on `ctx` (anything with createBuffer) from AIFF bytes.
export function aiffToAudioBuffer(arrayBuffer, ctx) {
  const { sampleRate, channels } = decodeAiff(arrayBuffer)
  const buf = ctx.createBuffer(channels.length, channels[0].length, sampleRate)
  channels.forEach((data, c) => buf.copyToChannel(data, c))
  return buf
}
