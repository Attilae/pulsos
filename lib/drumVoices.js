// Drum pad voices per kit (Tone.js). The pure vocabulary — kits, ranges, the
// tone filter mapping — is in lib/drumKit.js. Used by DrumSequencer
// (lib/engines/drumEngine.js), so the Drum Machine tab, the DAW drum lane and
// the Song tab all play the same kit.
//
// A PadVoice owns its nodes and exposes trigger(time, vel), set(voice) and
// dispose(). Its output goes straight to the pad's Volume unless tone ≠ 0, which
// inserts one filter — so a Classic pad at defaults is wired exactly as before.

import * as Tone from 'tone'
import { normalizePadVoice, toneFilter, tuneRate, drumKitDef } from './drumKit.js'
import { getCachedSample, resolveSamplerUrls } from './sampleCache.js'

const midiFreq = (midi, tune) => Tone.Frequency(midi + tune, 'midi').toFrequency()

// Tone's noise sources refuse a start that isn't strictly later than the last
// one. A voice that schedules several hits per trigger (the clap's bursts and
// tail) can overlap the next roll hit, so its noise layers go through this:
// a start that would go back in time is pushed just after the previous one.
function noiseClock() {
  let last = -Infinity
  return t => {
    const at = t > last ? t : last + 0.0005
    last = at
    return at
  }
}

class PadVoice {
  // output: the node feeding the pad's Volume. nodes: every node to dispose.
  // apply(voice): push tune/decay into the synths. play(time, vel, voice): trigger.
  constructor({ output, nodes, apply, play }) {
    this._output = output
    this._nodes = nodes
    this._apply = apply
    this._play = play
    this._voice = normalizePadVoice(null)
    this._filter = null
    this._dest = null
    this._lastAt = -Infinity
  }

  connect(dest) {
    this._dest = dest
    this._route()
    return this
  }

  set(voice) {
    const next = normalizePadVoice(voice)
    const rerouted = (next.tone === 0) !== (this._voice.tone === 0)
    this._voice = next
    this._apply(next)
    const f = toneFilter(next.tone)
    if (f) {
      if (!this._filter) this._filter = new Tone.Filter({ type: f.type, frequency: f.frequency, rolloff: -12, Q: 0.7 })
      this._filter.set({ type: f.type })
      this._filter.frequency.value = f.frequency
    }
    if (rerouted) this._route()
  }

  _route() {
    if (!this._dest) return
    this._output.disconnect()
    this._filter?.disconnect()
    if (this._voice.tone !== 0 && this._filter) {
      this._output.connect(this._filter)
      this._filter.connect(this._dest)
    } else {
      this._output.connect(this._dest)
    }
  }

  trigger(time, vel) {
    // Tone moves a start time that is already past up to "now", and refuses a
    // restart that isn't strictly later than the previous start. A late
    // scheduler tick (a busy main thread, a throttled tab) can therefore land
    // two hits of one voice, or a roll and the next step, on the same instant.
    // Keep every hit of this voice in the future and strictly increasing.
    const now = Tone.getContext().currentTime
    let at = Math.max(time, now + 0.002)
    if (at <= this._lastAt) at = this._lastAt + 0.001
    this._lastAt = at
    // A voice must never throw into the Transport callback (it would stop
    // every later pad in that tick).
    try { this._play(at, vel, this._voice) } catch (e) { console.warn('drum voice', e) }
  }

  dispose() {
    for (const n of this._nodes) n.dispose()
    this._filter?.dispose()
    this._nodes = []
    this._filter = null
  }
}

// ── Classic: the original six voices, unchanged at default settings ─────────

function classicVoice(padId) {
  switch (padId) {
    case 'kick': {
      const s = new Tone.MembraneSynth({
        pitchDecay: 0.05, octaves: 6,
        envelope: { attack: 0.001, decay: 0.4, sustain: 0.01, release: 1.4 },
      })
      return new PadVoice({
        output: s, nodes: [s],
        apply: v => s.set({ envelope: { decay: 0.4 * v.decay, release: 1.4 * v.decay } }),
        play: (t, vel, v) => s.triggerAttackRelease(v.tune ? midiFreq(24, v.tune) : 'C1', '8n', t, vel),
      })
    }
    case 'snare':
    case 'clap': {
      const snare = padId === 'snare'
      const s = new Tone.NoiseSynth(snare
        ? { noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.13, sustain: 0 } }
        : { noise: { type: 'pink' }, envelope: { attack: 0.005, decay: 0.18, sustain: 0 } })
      return new PadVoice({
        output: s, nodes: [s],
        apply: v => {
          s.set({ envelope: { decay: (snare ? 0.13 : 0.18) * v.decay } })
          s.noise.playbackRate = tuneRate(v.tune)
        },
        play: (t, vel) => s.triggerAttackRelease(snare ? '16n' : '8n', t, vel),
      })
    }
    case 'hat':
    case 'ride': {
      const hat = padId === 'hat'
      const s = new Tone.MetalSynth(hat
        ? { envelope: { attack: 0.001, decay: 0.05, release: 0.01 }, harmonicity: 5.1, modulationIndex: 32, resonance: 4000, octaves: 1.5 }
        : { envelope: { attack: 0.001, decay: 0.4, release: 0.2 }, harmonicity: 8, modulationIndex: 40, resonance: 6000, octaves: 0.8 })
      return new PadVoice({
        output: s, nodes: [s],
        apply: v => s.set({ envelope: hat
          ? { decay: 0.05 * v.decay, release: 0.01 * v.decay }
          : { decay: 0.4 * v.decay, release: 0.2 * v.decay } }),
        play: (t, vel, v) => hat
          ? s.triggerAttackRelease(v.tune ? midiFreq(84, v.tune) : 'C6', '32n', t, 0.5 * vel)
          : s.triggerAttackRelease(v.tune ? midiFreq(72, v.tune) : 'C5', '8n', t, 0.4 * vel),
      })
    }
    case 'rim': {
      const s = new Tone.MembraneSynth({
        pitchDecay: 0.008, octaves: 2,
        envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.05 },
      })
      return new PadVoice({
        output: s, nodes: [s],
        apply: v => s.set({ envelope: { decay: 0.05 * v.decay, release: 0.05 * v.decay } }),
        play: (t, vel, v) => s.triggerAttackRelease(v.tune ? midiFreq(69, v.tune) : 'A4', '32n', t, 0.7 * vel),
      })
    }
    default: return null
  }
}

// ── Layered: two or three parts per pad, as drum machines build them ────────

function layeredVoice(padId) {
  switch (padId) {
    case 'kick': {
      // Sine body with a fast pitch sweep, a 6 ms high-passed noise click, and a
      // little drive on the body for weight on small speakers.
      const body = new Tone.MembraneSynth({
        pitchDecay: 0.035, octaves: 5, oscillator: { type: 'sine' },
        envelope: { attack: 0.001, decay: 0.45, sustain: 0, release: 0.1 },
      })
      const drive = new Tone.Distortion({ distortion: 0.25, wet: 0.45 })
      const click = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.0005, decay: 0.006, sustain: 0 } })
      const clickHp = new Tone.Filter({ type: 'highpass', frequency: 2500 })
      const clickGain = new Tone.Gain(0.35)
      const mix = new Tone.Gain(1)
      body.chain(drive, mix)
      click.chain(clickHp, clickGain, mix)
      return new PadVoice({
        output: mix, nodes: [body, drive, click, clickHp, clickGain, mix],
        apply: v => body.set({ envelope: { decay: 0.45 * v.decay } }),
        play: (t, vel, v) => {
          body.triggerAttackRelease(midiFreq(24, v.tune), '8n', t, vel)
          click.triggerAttackRelease(0.01, t, vel)
        },
      })
    }
    case 'snare': {
      // Tuned triangle body (~G3) with a short pitch drop, plus high-passed noise.
      const body = new Tone.MembraneSynth({
        pitchDecay: 0.015, octaves: 1.6, oscillator: { type: 'triangle' },
        envelope: { attack: 0.001, decay: 0.11, sustain: 0, release: 0.05 },
      })
      const noise = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.17, sustain: 0 } })
      const noiseHp = new Tone.Filter({ type: 'highpass', frequency: 1400 })
      const mix = new Tone.Gain(1)
      body.connect(mix)
      noise.chain(noiseHp, mix)
      return new PadVoice({
        output: mix, nodes: [body, noise, noiseHp, mix],
        apply: v => {
          body.set({ envelope: { decay: 0.11 * v.decay } })
          noise.set({ envelope: { decay: 0.17 * v.decay } })
          noise.noise.playbackRate = tuneRate(v.tune)
        },
        play: (t, vel, v) => {
          body.triggerAttackRelease(midiFreq(55, v.tune), '16n', t, 0.7 * vel)
          noise.triggerAttackRelease('16n', t, 0.9 * vel)
        },
      })
    }
    case 'hat':
    case 'ride': {
      const hat = padId === 'hat'
      const s = new Tone.MetalSynth(hat
        ? { envelope: { attack: 0.001, decay: 0.045, release: 0.01 }, harmonicity: 5.1, modulationIndex: 28, resonance: 6500, octaves: 1.2 }
        : { envelope: { attack: 0.001, decay: 1.1, release: 0.3 }, harmonicity: 5.4, modulationIndex: 24, resonance: 7500, octaves: 1.1 })
      const hp = new Tone.Filter({ type: 'highpass', frequency: hat ? 6000 : 2500 })
      s.connect(hp)
      return new PadVoice({
        output: hp, nodes: [s, hp],
        apply: v => s.set({ envelope: hat
          ? { decay: 0.045 * v.decay, release: 0.01 * v.decay }
          : { decay: 1.1 * v.decay, release: 0.3 * v.decay } }),
        play: (t, vel, v) => hat
          ? s.triggerAttackRelease(midiFreq(84, v.tune), '32n', t, 0.45 * vel)
          : s.triggerAttackRelease(midiFreq(72, v.tune), '8n', t, 0.3 * vel),
      })
    }
    case 'rim': {
      // 808 rimshot: two short triangle tones (~455 Hz and ~1.67 kHz), high-passed.
      const lo = new Tone.Synth({ oscillator: { type: 'triangle' }, envelope: { attack: 0.0005, decay: 0.025, sustain: 0, release: 0.01 } })
      const hi = new Tone.Synth({ oscillator: { type: 'triangle' }, envelope: { attack: 0.0005, decay: 0.02, sustain: 0, release: 0.01 } })
      const hp = new Tone.Filter({ type: 'highpass', frequency: 400 })
      const mix = new Tone.Gain(1)
      lo.connect(hp); hi.connect(hp); hp.connect(mix)
      return new PadVoice({
        output: mix, nodes: [lo, hi, hp, mix],
        apply: v => {
          lo.set({ envelope: { decay: 0.025 * v.decay, release: 0.01 * v.decay } })
          hi.set({ envelope: { decay: 0.02 * v.decay, release: 0.01 * v.decay } })
        },
        play: (t, vel, v) => {
          const r = tuneRate(v.tune)
          lo.triggerAttackRelease(455 * r, 0.03, t, 0.6 * vel)
          hi.triggerAttackRelease(1667 * r, 0.03, t, 0.5 * vel)
        },
      })
    }
    case 'clap': {
      // 808 clap: three ~10 ms noise bursts 11 ms apart, then a longer tail, all
      // through a band-pass around 1.1 kHz. Separate synths for bursts and tail.
      const burstAt = noiseClock()
      const tailAt = noiseClock()
      const bursts = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.009, sustain: 0 } })
      const tail = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.002, decay: 0.2, sustain: 0 } })
      const bp = new Tone.Filter({ type: 'bandpass', frequency: 1100, Q: 1.2 })
      const mix = new Tone.Gain(1.6)
      bursts.connect(bp); tail.connect(bp); bp.connect(mix)
      return new PadVoice({
        output: mix, nodes: [bursts, tail, bp, mix],
        apply: v => {
          tail.set({ envelope: { decay: 0.2 * v.decay } })
          bursts.noise.playbackRate = tuneRate(v.tune)
          tail.noise.playbackRate = tuneRate(v.tune)
          bp.frequency.value = 1100 * tuneRate(v.tune)
        },
        play: (t, vel) => {
          for (let i = 0; i < 3; i++) bursts.triggerAttackRelease(0.008, burstAt(t + i * 0.011), 0.8 * vel)
          tail.triggerAttackRelease(0.05, tailAt(t + 0.03), vel)
        },
      })
    }
    default: return null
  }
}

// ── Sample kits: one recording per pad ──────────────────────────────────────

// Recordings are normalised; these keep the pads' balance close to the synth kits.
const SAMPLE_PAD_GAIN = { kick: 0.95, snare: 0.85, hat: 0.6, rim: 0.7, ride: 0.45, clap: 0.8 }

function sampleVoice(kitDef, padId) {
  const url = kitDef.samples?.[padId]
  if (!url) return null
  // Buffers already decoded (DrumSequencer warms the kit first) make the
  // Sampler ready at once; otherwise it fetches the file itself.
  const s = new Tone.Sampler({ urls: resolveSamplerUrls({ C4: url }, ''), baseUrl: '', release: 0.04 })
  const gain = SAMPLE_PAD_GAIN[padId] ?? 0.8
  return new PadVoice({
    output: s, nodes: [s],
    apply: () => {},
    play: (t, vel, v) => {
      if (!s.loaded) return
      // Tune repitches (and so speeds up or slows down) the recording. Decay
      // below ×1 cuts it short with a quick release; above ×1 it plays in full,
      // since a sample can't ring longer than it was recorded.
      const full = getCachedSample(url)?.duration ?? 2
      const hold = full * Math.min(1, v.decay) / tuneRate(v.tune)
      s.triggerAttackRelease(Tone.Frequency(60 + v.tune, 'midi').toNote(), hold, t, gain * vel)
    },
  })
}

/** A PadVoice for `padId` in `kit`, or null for an unknown pad. */
export function createPadVoice(kit, padId) {
  const def = drumKitDef(kit)
  if (def.samples) return sampleVoice(def, padId)
  return kit === 'layered' ? layeredVoice(padId) : classicVoice(padId)
}
