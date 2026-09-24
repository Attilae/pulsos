// Sound-design layer for the AI composer: how to choose and shape an instrument
// for a musical role. Distilled from docs/composer-synthesis-guide.md (research,
// 2026-09-24). The capability facts (what each instrument honours, the one-beat
// gate, tone ranges) live in planContract.js's vocabulary text; this module is the
// craft on top — envelope families, source choice, and the R1–R13 sound recipes
// the genre recipes point at. Every recipe is an unauditioned starting setting.
//
// Pure (no Tone, React or Zod): the in-app prompt and the MCP guide both read it.
// test/sound-policy.test.js runs every recipe through the real validatePlan and
// planAdvisories, so a recipe that drifts out of the contract fails `npm test`.

export const SOUND_POLICY_TEXT = `SOUND DESIGN (compose the notes and the sound together — the same route becomes a bass groove, a keys figure or a percussion texture depending on its source, register and articulation):
- Pick the role first, then design how it begins (attack, transient), where it sits (register, filter, sustain) and how it ends (decay, release, effect tails).
- Build most beats from the instruments whose shape a plan fully controls: Synth, MonoSynth, FMSynth, PolySynth, PluckSynth, NoiseSynth, Sampler and Drums. Reach for AMSynth, DuoSynth, MembraneSynth or MetalSynth for a specific colour, knowing their limits (see INSTRUMENTS).
- Fit each envelope to the lane's note length (noteLength; default 4n = one beat = 60 ÷ bpm s) and to the rhythmic spacing — or pick the note length to fit the envelope: 8n/16n for tight stabs and bass, 2n/1n for held notes on sparse lanes. Envelope families for ADSR synths (seconds, attack/decay/sustain/release): compact bass pulse 0.005–0.015 / 0.08–0.18 / 0 / 0.05–0.12; plucked foreground 0.003–0.01 / 0.1–0.25 / 0 / 0.06–0.2; held lead 0.01–0.04 / 0.1–0.3 / 0.4–0.7 / 0.1–0.3; soft support 0.03–0.1 / 0.15–0.5 / 0.3–0.65 / 0.3–0.8; slow swell (attack 0.3–1) only when the note is longer than the attack (noteLength 2n/1n, drone, legato mono voice). Sampler and Drums take attack and release only; PluckSynth takes none of it (tone.resonance sets how long it rings).
- A short, bright attack makes a syncopated figure readable; a bass tail must end before the next kick. Choose one low foundation — do not double the kit's kick with a Drums or MembraneSynth lane, and do not stack every attack.
- Velocity is strength, chance is whether a note happens. Keep low-end anchors reliable and make subdivisions quieter (drum steps 0.7 / 0.4) before thinning them randomly.
- Tone: the waveform is the spectrum the filter works on — triangle soft, square hollow and present (a bass that survives small speakers), sawtooth bright, fat* wide and detuned. A lowpass cannot add missing harmonics, and a cutoff below the bass fundamental weakens the note; keep Q moderate so the resonance is not a second hook. MonoSynth: the filter envelope, not the amp envelope, makes the note speak — a fast filterEnvelope decay with sustain 0 and filterQ 4–8 gives an acid squelch; fewer octaves and lower Q give a rounder analogue bass. FM: harmonicity 1 or 2 stays harmonic, odd fractions turn clangorous; modulationIndex 2–5 is plenty of brightness; a mod envelope that decays faster than the carrier gives a struck, bright onset with a cleaner tail.
- Granular is a quiet, related shadow of a support lane (mix around 0.08) — a held synth or sustained sample source works best — never on the bass.
- Suggested edits change one sound decision at a time. The sound recipes are starting settings nobody has auditioned in this song — never claim a sound was heard.`

// ---------------------------------------------------------------------------
// Sound recipes (guide §5, plus the tone-based experiments it lists as manual
// techniques, now reachable through the plan's `tone`). `envelope` is
// attack/decay/sustain/release for ADSR synths and attack/release only for
// Sampler/Drums. `octave` is the plan's octave offset.
// ---------------------------------------------------------------------------

export const SOUND_RECIPES = [
  {
    id: 'R1', name: 'Compact synth bass', role: 'bass',
    synthType: 'Synth', tone: { oscillator: 'square' },
    envelope: { attack: 0.008, decay: 0.12, sustain: 0, release: 0.08 },
    filter: { type: 'lowpass', frequency: 900, Q: 0.7 }, octave: -1,
    fx: 'dry; duck off drums:kick',
    use: 'House/techno/synthwave foundation. Triangle is softer, sawtooth brighter. First edit: shorten decay if its body masks the next kick.',
  },
  {
    id: 'R2', name: 'Sampled bass anchor', role: 'bass',
    synthType: 'Sampler', samplerPreset: 'bass-electric',
    envelope: { attack: 0.005, release: 0.1 },
    filter: { type: 'lowpass', frequency: 2000, Q: 0.7 }, octave: -1,
    fx: 'dry; sparse notes',
    use: 'Lo-fi/deep-house/dnb support; contrabass is darker. Compare presets before adding distortion.',
  },
  {
    id: 'R3', name: 'Plucked-style hook', role: 'hook',
    synthType: 'Synth', tone: { oscillator: 'sawtooth' },
    envelope: { attack: 0.005, decay: 0.16, sustain: 0, release: 0.1 },
    filter: { type: 'lowpass', frequency: 4000, Q: 0.8 },
    fx: 'quiet synced delay (8n or 8n.)',
    use: 'House/garage/techno cell. First edit: the decay, then the echo send.',
  },
  {
    id: 'R4', name: 'Restrained FM colour', role: 'hook',
    synthType: 'FMSynth', tone: { harmonicity: 3, modulationIndex: 2, modEnvelope: { attack: 0.01, decay: 0.3, sustain: 0.4, release: 0.2 } },
    envelope: { attack: 0.01, decay: 0.2, sustain: 0.35, release: 0.2 },
    filter: { type: 'lowpass', frequency: 4500, Q: 0.7 },
    fx: 'little reverb',
    use: 'Digital melodic detail at medium activity. First edit: a slower event rate or a lower modulationIndex.',
  },
  {
    id: 'R5', name: 'Warm sampled keys', role: 'hook',
    synthType: 'Sampler', samplerPreset: 'piano',
    envelope: { attack: 0.01, release: 0.3 },
    filter: { type: 'lowpass', frequency: 3500, Q: 0.7 },
    fx: 'modest reverb or chorus',
    use: 'Lo-fi/deep-house foreground (piano-tji is softer). Keep enough transient for the rhythm to read.',
  },
  {
    id: 'R6', name: 'Sparse organ response', role: 'answer',
    synthType: 'Sampler', samplerPreset: 'organ',
    envelope: { attack: 0.005, release: 0.2 },
    filter: { type: 'lowpass', frequency: 2500, Q: 0.7 },
    fx: 'delay sync 8n., feedback ~0.25, low send',
    use: 'Dub/house stab-like texture — one note per stop, not a chord. Reduce activity so the echoes are heard.',
  },
  {
    id: 'R7', name: 'Soft synth support', role: 'support',
    synthType: 'PolySynth', tone: { oscillator: 'triangle' },
    envelope: { attack: 0.04, decay: 0.25, sustain: 0.45, release: 0.5 },
    filter: { type: 'lowpass', frequency: 2500, Q: 0.7 },
    fx: 'restrained chorus or reverb',
    use: 'Ambient/melodic support, slower than the hook. Reduce release if overlapping notes blur.',
  },
  {
    id: 'R8', name: 'Clear sampled answer', role: 'answer',
    synthType: 'Sampler', samplerPreset: 'xylophone',
    envelope: { attack: 0.005, release: 0.25 },
    filter: { type: 'lowpass', frequency: 8000, Q: 0.7 }, octave: 1,
    fx: 'sparse echo',
    use: 'A distinct answer to warm keys (harp or guitar-nylon are alternatives). Quieter and sparser than the hook.',
  },
  {
    id: 'R9', name: 'Light noise percussion', role: 'texture',
    synthType: 'NoiseSynth',
    envelope: { attack: 0.003, decay: 0.04, sustain: 0, release: 0.025 },
    filter: { type: 'highpass', frequency: 4000, Q: 0.7 },
    fx: 'no long reverb',
    use: 'Techno/house tick or shaker, quiet. Unpitched: octave, scale and contour do nothing. Drop it if the hats already fill the role.',
  },
  {
    id: 'R10', name: 'Route-triggered drum accent', role: 'texture',
    synthType: 'Drums', drumVoice: 'tom-lo',
    envelope: { attack: 0.001, release: 0.08 },
    filter: { type: 'lowpass', frequency: 12000, Q: 0.7 },
    fx: 'mostly dry',
    use: 'An occasional contrast to the kit, on a sparse line. Fixed pitch — octave does not retune it.',
  },
  {
    id: 'R11', name: 'Related grain shadow', role: 'texture',
    synthType: 'PolySynth', tone: { oscillator: 'triangle' },
    envelope: { attack: 0.04, decay: 0.25, sustain: 0.45, release: 0.5 },
    granular: { enabled: true, mix: 0.08, grainSize: 0.1, overlap: 0.05, playbackRate: 0.5, loopStart: 0.1, loopEnd: 0.55, jitter: 0, reverse: false, attack: 0.05, release: 0.4 },
    filter: { type: 'lowpass', frequency: 2500, Q: 0.7 },
    fx: 'fewer other spatial effects',
    use: 'R7 plus a quiet grain layer for ambient/melodic texture. Raise mix only while the dry figure stays identifiable.',
  },
  {
    id: 'R12', name: 'FM struck keys', role: 'hook',
    synthType: 'FMSynth', tone: { harmonicity: 2, modulationIndex: 3, modEnvelope: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.08 } },
    envelope: { attack: 0.005, decay: 0.2, sustain: 0, release: 0.1 },
    filter: { type: 'lowpass', frequency: 6000, Q: 0.7 },
    fx: 'little reverb',
    use: 'Bright onset with a cleaner tail for a repeating mid-register figure. First edit: modulationIndex for more or less bite, then a longer carrier decay.',
  },
  {
    id: 'R13', name: 'Wide saw lead / arp', role: 'hook',
    synthType: 'PolySynth', tone: { oscillator: 'fatsawtooth' },
    envelope: { attack: 0.005, decay: 0.15, sustain: 0.2, release: 0.12 },
    filter: { type: 'lowpass', frequency: 3500, Q: 1 },
    fx: 'synced delay for lift, reverb behind',
    use: 'Synthwave lead or the trance focal arp — an approximation of a supersaw, not one. First edit: the filter, then the arp rate.',
  },
  {
    id: 'R14', name: 'Acid filter bass', role: 'bass',
    synthType: 'MonoSynth',
    tone: { oscillator: 'sawtooth', filterEnvelope: { attack: 0.001, decay: 0.18, sustain: 0, release: 0.1, baseFrequency: 120, octaves: 4 }, filterQ: 6 },
    envelope: { attack: 0.005, decay: 0.2, sustain: 0.4, release: 0.1 },
    filter: { type: 'lowpass', frequency: 6000, Q: 0.7 }, octave: -1,
    fx: 'dry or a touch of distortion; duck off drums:kick',
    use: 'Techno/acid line — the filter envelope makes each note squelch. First edit: filterQ, then filterEnvelope.octaves; lower both for a rounder bass.',
  },
  {
    id: 'R15', name: 'Plucked string', role: 'answer',
    synthType: 'PluckSynth',
    tone: { resonance: 0.9, dampening: 3000, attackNoise: 2 },
    filter: { type: 'lowpass', frequency: 6000, Q: 0.7 },
    fx: 'short reverb, optional 8n. delay',
    use: 'Guitar/kalimba-like answer for lo-fi, garage and deep house. It ignores envelope and velocity. First edit: resonance for ring length, then dampening for brightness.',
  },
]

export const SOUND_IDS = SOUND_RECIPES.map(r => r.id)
const SOUND_BY_ID = new Map(SOUND_RECIPES.map(r => [r.id, r]))
export const soundById = (id) => SOUND_BY_ID.get(id) ?? null

// The palette for a request no genre recipe matched: bass, hook, keys, support, texture.
export const DEFAULT_SOUND_IDS = ['R1', 'R3', 'R5', 'R7', 'R9']

const AR_ONLY = new Set(['Sampler', 'Drums'])
const n = (v) => String(+v.toFixed(3))

function envelopeText(r) {
  const e = r.envelope
  if (!e) return 'no envelope (string model)'
  return AR_ONLY.has(r.synthType)
    ? `attack ${n(e.attack)}, release ${n(e.release)}`
    : `env ${n(e.attack)}/${n(e.decay)}/${n(e.sustain)}/${n(e.release)}`
}

function toneText(tone) {
  if (!tone) return ''
  const parts = []
  if (tone.oscillator) parts.push(`oscillator ${tone.oscillator}`)
  if (tone.harmonicity != null) parts.push(`harmonicity ${tone.harmonicity}`)
  if (tone.modulationIndex != null) parts.push(`modulationIndex ${tone.modulationIndex}`)
  if (tone.modEnvelope) {
    const m = tone.modEnvelope
    parts.push(`modEnvelope ${n(m.attack)}/${n(m.decay)}/${n(m.sustain)}/${n(m.release)}`)
  }
  if (tone.filterEnvelope) {
    const f = tone.filterEnvelope
    parts.push(`filterEnvelope ${n(f.attack)}/${n(f.decay)}/${n(f.sustain)}/${n(f.release)} from ${f.baseFrequency} Hz over ${f.octaves} octaves`)
  }
  if (tone.filterQ != null) parts.push(`filterQ ${tone.filterQ}`)
  if (tone.resonance != null) parts.push(`resonance ${tone.resonance}`)
  if (tone.dampening != null) parts.push(`dampening ${tone.dampening}`)
  if (tone.attackNoise != null) parts.push(`attackNoise ${tone.attackNoise}`)
  return parts.length ? `; tone ${parts.join(', ')}` : ''
}

/** One compact prompt line for a sound recipe. */
export function soundRecipeLine(r) {
  const source = r.samplerPreset ? `Sampler "${r.samplerPreset}"` : r.drumVoice ? `Drums "${r.drumVoice}"` : r.synthType
  const octave = r.octave ? `; octave ${r.octave > 0 ? '+' : ''}${r.octave}` : ''
  const granular = r.granular
    ? `; granular mix ${r.granular.mix}, grainSize ${r.granular.grainSize}, overlap ${r.granular.overlap}, playbackRate ${r.granular.playbackRate}, window ${r.granular.loopStart}–${r.granular.loopEnd}, no jitter/reverse`
    : ''
  return `- ${r.id} ${r.name} [${r.role}]: ${source}; ${envelopeText(r)}${toneText(r.tone)}; ${r.filter.type} ~${r.filter.frequency} Hz Q ${r.filter.Q}${octave}${granular}; FX: ${r.fx}. ${r.use}`
}

/** The SOUND RECIPES prompt block for the given ids (all of them when omitted). */
export function soundRecipesText(ids = SOUND_IDS) {
  const recipes = ids.map(soundById).filter(Boolean)
  if (!recipes.length) return ''
  return `SOUND RECIPES (starting settings to adapt, not auditioned presets — resolve the real route's register and fill every required field of the plan):\n${recipes.map(soundRecipeLine).join('\n')}`
}

/**
 * A recipe as a plan track (lenient shape), used by the tests to run every
 * recipe through validatePlan/planAdvisories. Sampler/Drums get placeholder
 * decay/sustain, which the plan requires and the instrument ignores.
 */
export function soundRecipeTrack(r, routeId) {
  const env = AR_ONLY.has(r.synthType)
    ? { attack: r.envelope.attack, decay: 0.1, sustain: 1, release: r.envelope.release }
    : { ...r.envelope }
  return {
    routeId,
    synthType: r.synthType,
    ...(r.samplerPreset ? { samplerPreset: r.samplerPreset } : {}),
    ...(r.drumVoice ? { drumVoice: r.drumVoice } : {}),
    ...(r.synthType === 'PluckSynth' ? {} : { envelope: env }),
    ...(r.tone ? { tone: structuredClone(r.tone) } : {}),
    filter: { ...r.filter },
    ...(r.octave ? { octave: r.octave } : {}),
    ...(r.granular ? { granular: { ...r.granular } } : {}),
  }
}
