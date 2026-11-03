import test from 'node:test'
import assert from 'node:assert/strict'
import { decodeAiff, isAiff, readExtended, aiffToAudioBuffer } from '../lib/aiff.js'

// 80-bit IEEE extended, big-endian.
function extended(value) {
  const out = new Uint8Array(10)
  const exp = Math.floor(Math.log2(value))
  const mant = value / 2 ** exp * 2 ** 63
  const view = new DataView(out.buffer)
  view.setUint16(0, exp + 16383)
  view.setUint32(2, Math.floor(mant / 2 ** 32))
  view.setUint32(6, mant % 2 ** 32)
  return out
}

const ascii = (s) => Array.from(s, c => c.charCodeAt(0))
const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
const u16 = (n) => [(n >> 8) & 255, n & 255]

// frames: array of per-frame arrays of floats in -1..1
function buildAiff({ frames, bits = 16, rate = 44100, aifc = false, compression = 'NONE', littleEndian = false, prefixChunk = false }) {
  const channels = frames[0].length
  const bytes = Math.ceil(bits / 8)
  const data = []
  for (const frame of frames) {
    for (const v of frame) {
      const full = 2 ** (bytes * 8 - 1)
      let n = Math.round(v * (full - 1))
      if (n < 0) n += full * 2
      const be = []
      for (let b = bytes - 1; b >= 0; b--) be.push(Math.floor(n / 2 ** (8 * b)) & 255)
      data.push(...(littleEndian ? be.reverse() : be))
    }
  }
  const comm = [
    ...u16(channels), ...u32(frames.length), ...u16(bits), ...extended(rate),
    ...(aifc ? [...ascii(compression), 0, 0] : []),
  ]
  const ssnd = [...u32(0), ...u32(0), ...data]
  const chunk = (id, body) => [...ascii(id), ...u32(body.length), ...body, ...(body.length & 1 ? [0] : [])]
  const pre = prefixChunk ? chunk('NAME', ascii('odd')) : []
  const body = [...ascii(aifc ? 'AIFC' : 'AIFF'), ...pre, ...chunk('COMM', comm), ...chunk('SSND', ssnd)]
  return new Uint8Array([...ascii('FORM'), ...u32(body.length), ...body]).buffer
}

const close = (a, b, eps = 1e-3) => Math.abs(a - b) < eps

test('readExtended decodes common sample rates', () => {
  for (const rate of [44100, 48000, 96000, 22050]) {
    assert.equal(readExtended(new DataView(extended(rate).buffer), 0), rate)
  }
})

test('16-bit stereo AIFF', () => {
  const frames = [[0, 0], [0.5, -0.5], [-1, 1], [0.25, 0]]
  const buf = buildAiff({ frames })
  assert.ok(isAiff(buf))
  const { sampleRate, channels } = decodeAiff(buf)
  assert.equal(sampleRate, 44100)
  assert.equal(channels.length, 2)
  assert.equal(channels[0].length, 4)
  frames.forEach(([l, r], i) => {
    assert.ok(close(channels[0][i], l), `L${i}`)
    assert.ok(close(channels[1][i], r), `R${i}`)
  })
})

test('24-bit mono AIFF after an odd-sized chunk (padding)', () => {
  const frames = [[0.1], [-0.7], [0.999]]
  const { sampleRate, channels } = decodeAiff(buildAiff({ frames, bits: 24, rate: 48000, prefixChunk: true }))
  assert.equal(sampleRate, 48000)
  frames.forEach(([v], i) => assert.ok(close(channels[0][i], v, 1e-5)))
})

test('AIFF-C sowt (little-endian) and NONE', () => {
  const frames = [[0.3, -0.3], [-0.6, 0.6]]
  for (const [compression, littleEndian] of [['sowt', true], ['NONE', false]]) {
    const { channels } = decodeAiff(buildAiff({ frames, aifc: true, compression, littleEndian }))
    frames.forEach(([l, r], i) => {
      assert.ok(close(channels[0][i], l), `${compression} L${i}`)
      assert.ok(close(channels[1][i], r), `${compression} R${i}`)
    })
  }
})

test('compressed AIFF-C and non-AIFF input are rejected with a readable message', () => {
  assert.throws(() => decodeAiff(buildAiff({ frames: [[0]], aifc: true, compression: 'ima4' })), /Compressed AIFF \(ima4\)/)
  assert.throws(() => decodeAiff(new ArrayBuffer(16)), /Not an AIFF file/)
  assert.equal(isAiff(new Uint8Array(ascii('RIFF....WAVE')).buffer), false)
})

test('aiffToAudioBuffer copies channels into the context buffer', () => {
  const created = []
  const ctx = {
    createBuffer(n, len, rate) {
      const data = Array.from({ length: n }, () => new Float32Array(len))
      const buf = { numberOfChannels: n, length: len, sampleRate: rate, duration: len / rate, data, copyToChannel: (src, c) => data[c].set(src) }
      created.push(buf)
      return buf
    },
  }
  const buf = aiffToAudioBuffer(buildAiff({ frames: [[0.5, -0.5], [0, 0]] }), ctx)
  assert.equal(buf.numberOfChannels, 2)
  assert.equal(buf.length, 2)
  assert.ok(close(buf.data[1][0], -0.5))
})
