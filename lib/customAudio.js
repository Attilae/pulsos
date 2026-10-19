// Limits for user-loaded audio (custom sampler samples and reverb IRs). The
// files never leave the browser: they're decoded with decodeAudioData and handed
// straight to the audio graph, so these checks protect the tab, not the server.
// A huge file would be read whole into memory, and a long IR makes the
// convolver expensive enough to crackle playback. Pure, so it's testable.

const MB = 1024 * 1024

export const CUSTOM_AUDIO_LIMITS = Object.freeze({
  sample: Object.freeze({ maxBytes: 50 * MB, maxSeconds: 60, channels: null }),
  // ConvolverNode accepts 1, 2 or 4 channel buffers and throws on anything else.
  ir: Object.freeze({ maxBytes: 20 * MB, maxSeconds: 12, channels: [1, 2, 4] }),
})

const AUDIO_EXTENSIONS = ['wav', 'wave', 'mp3', 'ogg', 'oga', 'flac', 'm4a', 'aac', 'aif', 'aiff', 'webm', 'opus']
const IR_EXTENSIONS = ['wav', 'wave']

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
export async function decodeCustomAudio(file, kind, decode) {
  const fileError = checkAudioFile(file, kind)
  if (fileError) throw new Error(fileError)
  let buffer
  try {
    buffer = await decode(await file.arrayBuffer())
  } catch {
    throw new Error("Couldn't decode file")
  }
  const bufferError = checkDecodedAudio(buffer, kind)
  if (bufferError) throw new Error(bufferError)
  return buffer
}
