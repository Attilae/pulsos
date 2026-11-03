import test from 'node:test'
import assert from 'node:assert/strict'
import { CUSTOM_AUDIO_LIMITS, checkAudioFile, checkDecodedAudio, decodeCustomAudio } from '../lib/customAudio.js'

const MB = 1024 * 1024
const file = (name, size, type = '') => ({ name, size, type, arrayBuffer: async () => new ArrayBuffer(8) })
const buffer = (duration, numberOfChannels = 2) => ({ duration, numberOfChannels, length: Math.round(duration * 48000) })

test('file checks: size, emptiness and type', () => {
  assert.equal(checkAudioFile(file('kick.wav', 1000, 'audio/wav'), 'sample'), null)
  assert.equal(checkAudioFile(file('pad.mp3', 1000, ''), 'sample'), null, 'extension alone is enough')
  assert.equal(checkAudioFile(file('noext', 1000, 'audio/ogg'), 'sample'), null, 'MIME alone is enough')
  assert.equal(checkAudioFile(null, 'sample'), 'No file chosen')
  assert.equal(checkAudioFile(file('a.wav', 0, 'audio/wav'), 'sample'), 'File is empty')
  assert.equal(checkAudioFile(file('a.wav', 51 * MB, 'audio/wav'), 'sample'), 'File is over 50 MB')
  assert.equal(checkAudioFile(file('notes.txt', 100, 'text/plain'), 'sample'), 'Not an audio file')
})

test('IRs must be WAV and stay under the IR size cap', () => {
  assert.equal(checkAudioFile(file('hall.wav', 1000, ''), 'ir'), null)
  assert.equal(checkAudioFile(file('hall', 1000, 'audio/x-wav'), 'ir'), null)
  assert.equal(checkAudioFile(file('hall.mp3', 1000, 'audio/mpeg'), 'ir'), 'Choose a WAV file')
  assert.equal(checkAudioFile(file('hall.wav', 21 * MB, 'audio/wav'), 'ir'), 'File is over 20 MB')
})

test('decoded checks: duration and IR channel counts', () => {
  assert.equal(checkDecodedAudio(buffer(2), 'sample'), null)
  assert.equal(checkDecodedAudio(buffer(0), 'sample'), 'File has no audio')
  assert.equal(checkDecodedAudio(buffer(CUSTOM_AUDIO_LIMITS.sample.maxSeconds + 1), 'sample'), 'Longer than 60 s')
  assert.equal(checkDecodedAudio(buffer(3, 6), 'sample'), null, 'samplers take any channel count')
  for (const ch of [1, 2, 4]) assert.equal(checkDecodedAudio(buffer(3, ch), 'ir'), null)
  assert.equal(checkDecodedAudio(buffer(3, 3), 'ir'), "3-channel IRs aren't supported")
  assert.equal(checkDecodedAudio(buffer(13), 'ir'), 'Longer than 12 s')
})

test('decodeCustomAudio never decodes a rejected file and reports decode failures', async () => {
  let decoded = 0
  const ok = async () => { decoded += 1; return buffer(2) }
  await assert.rejects(decodeCustomAudio(file('big.wav', 60 * MB, 'audio/wav'), 'sample', ok), /over 50 MB/)
  assert.equal(decoded, 0)
  await assert.rejects(decodeCustomAudio(file('bad.wav', 100, 'audio/wav'), 'ir', async () => { throw new Error('EncodingError') }), /Couldn't decode file/)
  await assert.rejects(decodeCustomAudio(file('long.wav', 100, 'audio/wav'), 'ir', async () => buffer(30)), /Longer than 12 s/)
  assert.equal((await decodeCustomAudio(file('ok.wav', 100, 'audio/wav'), 'ir', ok)).duration, 2)
})

test('reference loops: bigger, longer, any audio format', () => {
  assert.equal(checkAudioFile(file('loop.aif', 80 * MB, ''), 'reference'), null)
  assert.equal(checkAudioFile(file('loop.mp3', 1000, 'audio/mpeg'), 'reference'), null)
  assert.equal(checkAudioFile(file('loop.wav', 101 * MB, 'audio/wav'), 'reference'), 'File is over 100 MB')
  assert.equal(checkDecodedAudio(buffer(240), 'reference'), null)
  assert.equal(checkDecodedAudio(buffer(301), 'reference'), 'Longer than 300 s')
})

test('AIFF goes through the built-in parser when a context is passed', async () => {
  // Minimal 16-bit mono AIFF, 2 frames at 44.1 kHz.
  const bytes = new Uint8Array([
    ...'FORM'.split('').map(c => c.charCodeAt(0)), 0, 0, 0, 46,
    ...'AIFF'.split('').map(c => c.charCodeAt(0)),
    ...'COMM'.split('').map(c => c.charCodeAt(0)), 0, 0, 0, 18,
    0, 1, 0, 0, 0, 2, 0, 16, 0x40, 0x0e, 0xac, 0x44, 0, 0, 0, 0, 0, 0,
    ...'SSND'.split('').map(c => c.charCodeAt(0)), 0, 0, 0, 12,
    0, 0, 0, 0, 0, 0, 0, 0, 0x40, 0x00, 0xc0, 0x00,
  ])
  const aiff = { name: 'loop.aiff', size: bytes.length, type: '', arrayBuffer: async () => bytes.buffer }
  const ctx = {
    createBuffer: (n, len, rate) => {
      const data = Array.from({ length: n }, () => new Float32Array(len))
      return { numberOfChannels: n, length: len, sampleRate: rate, duration: len / rate, data, copyToChannel: (src, c) => data[c].set(src) }
    },
  }
  let decoded = 0
  const buf = await decodeCustomAudio(aiff, 'reference', async () => { decoded += 1; return buffer(1) }, ctx)
  assert.equal(decoded, 0, 'decodeAudioData is never asked to decode AIFF')
  assert.equal(buf.sampleRate, 44100)
  assert.equal(buf.data[0][0], 0.5)
  assert.equal(buf.data[0][1], -0.5)
})
