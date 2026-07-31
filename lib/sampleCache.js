// Process-wide cache of decoded sample buffers, keyed by absolute URL.
//
// Why it exists: every engine.startMock() rebuilds a route's Tone.Sampler from
// scratch, and a Sampler built from URL strings fetches + decodes its whole zone
// map before `loaded` flips true — until then every note handed to it is dropped
// on the floor (see _triggerSynth / _triggerLegatoNote). In the Song Chainer that
// lands exactly on an item boundary, so a sampler-backed preset starts its section
// mute for as long as its samples take to arrive. Some presets are 30+ mp3s.
//
// Caching the *decoded AudioBuffer* lets a rebuilt Sampler be handed buffers
// instead of URLs, which makes it `loaded` synchronously. That's safe across
// sampler lifetimes: disposing a Sampler disposes its ToneAudioBuffer wrappers,
// but a wrapper built from a raw AudioBuffer only holds a reference to it, so the
// cached buffer outlives any number of samplers.
//
// resolveSamplerUrls never starts a download of its own — it uses what's already
// cached and otherwise leaves the URL string for Tone to fetch as before. Warming
// is always explicit (warmSamples / prefetchSnapshotSamples), so nothing is ever
// fetched twice.

import * as Tone from 'tone'

const _buffers  = new Map()   // url → AudioBuffer (decoded)
const _inflight = new Map()   // url → Promise<AudioBuffer>

export function getCachedSample(url) {
  return _buffers.get(url) ?? null
}

// Fetch + decode `url` once; concurrent callers share the same request.
export function loadSample(url) {
  const hit = _buffers.get(url)
  if (hit) return Promise.resolve(hit)

  let pending = _inflight.get(url)
  if (!pending) {
    pending = Tone.ToneAudioBuffer.fromUrl(url)
      .then((buf) => {
        const raw = buf.get()
        _buffers.set(url, raw)
        _inflight.delete(url)
        return raw
      })
      .catch((err) => {
        _inflight.delete(url)
        throw err
      })
    _inflight.set(url, pending)
  }
  return pending
}

// Warm a list of URLs. Never rejects — a missing sample should degrade to the
// current behaviour (Tone fetches it at build time), not break the caller.
export function warmSamples(urls) {
  return Promise.all([...new Set(urls)].map(u => loadSample(u).catch(() => null)))
}

// Turn a Tone.Sampler `urls` map ({ note: file }) + baseUrl into a map ready to
// hand straight to the Sampler constructor: already-decoded zones become
// AudioBuffers (instant `loaded`), the rest stay absolute URL strings. Callers
// must pass `baseUrl: ''` alongside, since the returned strings are absolute.
export function resolveSamplerUrls(urls, baseUrl = '') {
  const out = {}
  for (const [note, file] of Object.entries(urls ?? {})) {
    const url = baseUrl + file
    out[note] = _buffers.get(url) ?? url
  }
  return out
}

// True when every zone of a Sampler url map is already decoded.
export function samplerUrlsCached(urls, baseUrl = '') {
  return Object.values(urls ?? {}).every(file => _buffers.has(baseUrl + file))
}
