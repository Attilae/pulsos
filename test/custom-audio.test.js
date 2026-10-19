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
