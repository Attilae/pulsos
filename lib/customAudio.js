// Limits for user-loaded audio (custom sampler samples, reverb IRs and the
// reference loop). Samples and IRs never leave the browser; the reference loop
// is also stored in the account, under its own cap (lib/referenceLoops.js).
// All of them are decoded with decodeAudioData and handed straight to the audio
// graph, so these checks protect the tab, not the server.
// A huge file would be read whole into memory, and a long IR makes the
// convolver expensive enough to crackle playback. Pure, so it's testable.

import { aiffToAudioBuffer, isAiff } from './aiff.js'

const MB = 1024 * 1024

export const CUSTOM_AUDIO_LIMITS = Object.freeze({
  sample: Object.freeze({ maxBytes: 50 * MB, maxSeconds: 60, channels: null }),
  // ConvolverNode accepts 1, 2 or 4 channel buffers and throws on anything else.
  ir: Object.freeze({ maxBytes: 20 * MB, maxSeconds: 12, channels: [1, 2, 4] }),
  // A backing loop to audition lanes against (lib/referenceTrack.js). Longer
  // than a sample, but it's decoded whole into memory, so still bounded.
  reference: Object.freeze({ maxBytes: 100 * MB, maxSeconds: 300, channels: null }),
})

const AUDIO_EXTENSIONS = ['wav', 'wave', 'mp3', 'ogg', 'oga', 'flac', 'm4a', 'aac', 'aif', 'aiff', 'aifc', 'webm', 'opus']
const IR_EXTENSIONS = ['wav', 'wave']
const AIFF_EXTENSIONS = ['aif', 'aiff', 'aifc']

function extensionOf(name) {
  const m = /\.([a-z0-9]+)$/i.exec(name ?? '')
  return m ? m[1].toLowerCase() : ''
}

// Before reading the file: returns an error message, or null when it's fine.
export function checkAudioFile(file, kind) {
  const limits = CUSTOM_AUDIO_LIMITS[kind]
  if (!limits) throw new Error(`unknown custom audio kind: ${kind}`)
  if (!file) return 'No file chosen'
  if (!(file.size > 0)) return 'File is empty'
  if (file.size > limits.maxBytes) return `File is over ${limits.maxBytes / MB} MB`
  const ext = extensionOf(file.name)
  const type = String(file.type ?? '').toLowerCase()
  if (kind === 'ir') {
    if (!IR_EXTENSIONS.includes(ext) && !/^audio\/(x-)?wav(e)?$/.test(type)) return 'Choose a WAV file'
  } else if (!AUDIO_EXTENSIONS.includes(ext) && !type.startsWith('audio/')) {
    return 'Not an audio file'
  }
  return null
}

// After decoding: `buffer` is an AudioBuffer (or anything with duration and
// numberOfChannels). Returns an error message, or null when it's fine.
export function checkDecodedAudio(buffer, kind) {
  const limits = CUSTOM_AUDIO_LIMITS[kind]
  if (!limits) throw new Error(`unknown custom audio kind: ${kind}`)
  if (!buffer || !(buffer.duration > 0) || !(buffer.length > 0)) return 'File has no audio'
  if (buffer.duration > limits.maxSeconds) return `Longer than ${limits.maxSeconds} s`
  if (limits.channels && !limits.channels.includes(buffer.numberOfChannels)) {
    return `${buffer.numberOfChannels}-channel IRs aren't supported`
  }
  return null
}

// Read, decode and check in one step. Throws an Error whose message is meant
// for the UI. `decode` is injected (rawContext.decodeAudioData) so callers own
// the audio context.
//
// AIFF is decoded by lib/aiff.js when `ctx` (anything with createBuffer) is
// passed, since Chrome and Firefox's decodeAudioData reject it.
export async function decodeCustomAudio(file, kind, decode, ctx = null) {
  const fileError = checkAudioFile(file, kind)
  if (fileError) throw new Error(fileError)
  let buffer
  const bytes = await file.arrayBuffer()
  if (ctx && (AIFF_EXTENSIONS.includes(extensionOf(file.name)) || isAiff(bytes))) {
    try {
      buffer = aiffToAudioBuffer(bytes, ctx)
    } catch (err) {
      throw new Error(err?.message || "Couldn't decode file")
    }
  } else {
    try {
      buffer = await decode(bytes)
    } catch {
      throw new Error("Couldn't decode file")
    }
  }
  const bufferError = checkDecodedAudio(buffer, kind)
  if (bufferError) throw new Error(bufferError)
  return buffer
}
