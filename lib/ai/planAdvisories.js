// Plan advisories: settings that validate but will not sound the way a plan
// probably means them to — an attack longer than the one-beat note gate, an
// envelope on an instrument that ignores it, grains on a fixed-pitch drum lane. validatePlan reports what it
// *drops*; this reports what it keeps but the engine will play differently.
// Nothing here changes the plan.
//
// The facts come from the synthesis research (docs/composer-synthesis-guide.md)
// and are verified against lib/engine.js: ordinary stop notes are held for the
// lane's noteLength (default '4n'),
// Sampler/Drums only take attack/release, PluckSynth is triggered attack-only,
// FMSynth's default modulator attack is 0.5 s. Pure — shared by the MCP tools
// and the in-app AI Composer preview.

import { SYNTH_DEFAULTS, DRUMS_ROUTE_ID, DEFAULT_RESONATOR_VOICES, DEFAULT_MACRO_VOICES, POLY_VOICE_LABELS, macroEngine } from '../soundSpecs.js'
import { noteLengthBeats } from '../noteLength.js'
import { normalizeStopNoteLength, STOP_NOTE_LENGTH_SYNTHS } from '../stopNoteLength.js'
import { normalizeVelocityMapping, VELOCITY_DEAF_SYNTHS } from '../stopVelocity.js'
import { TEXTURE_ENABLED } from '../granularEngine.js'

const NO_ENVELOPE = new Set(['PluckSynth'])
const UNPITCHED = new Set(['NoiseSynth', 'Drums'])
const POLY_OR_SAMPLE = new Set(['Sampler', 'PolySynth'])
const GRANULAR_MIX_HIGH = 0.3
const FM_FAST_ATTACK = 0.05
// Resonator voices across a whole plan before it's worth warning about CPU: six
// lanes at the default two voices is the budget docs/rings-resonator-plan.md
// targets on phones.
const RESONATOR_VOICE_BUDGET = 12
// Macro voices cost a third to a half of a Resonator voice each (0.07–0.44 % of
// a core, dsp/macro/README.md), so the plan-wide budget is larger.
const MACRO_VOICE_BUDGET = 20
// The only Macro engines whose sound follows the trigger's length.
const MACRO_GATED = new Set(['sixOpA', 'sixOpB', 'sixOpC'])

const r2 = (v) => Math.round(v * 100) / 100

/**
 * @param {object} plan  a validatePlan() result's plan
 * @param {{ mode?: 'new'|'edit', bpm?: number }} [options]  bpm falls back to the
 *   plan's, then to 120 (a new session's tempo)
 * @returns {string[]}
 */
export function planAdvisories(plan, { mode = 'new', bpm } = {}) {
  if (!plan) return []
  const out = []
  const tempo = plan.bpm ?? bpm ?? 120
  const beat = 60 / tempo

  let resonatorVoices = 0
  let macroVoices = 0
  for (const t of plan.tracks ?? []) {
    const id = t.routeId
    const type = t.synthType
    // A Resonator's envelope: on when the plan names one (or sets
    // tone.resonatorEnvelope true), off when it says false, and off for a new
    // lane that says neither. An edit that says neither keeps whatever the lane
    // has, which isn't known here, so nothing envelope-dependent is claimed.
    const resonatorEnv = type !== 'Resonator' ? null
      : t.tone?.resonatorEnvelope === false ? false
      : (t.envelope || t.tone?.resonatorEnvelope === true) ? true
      : mode === 'new' ? false : null
    // Macro's envelope, by the same rules (tone.macro.envelope).
    const macroEnv = type !== 'Macro' ? null
      : t.tone?.macro?.envelope === false ? false
      : (t.envelope || t.tone?.macro?.envelope === true) ? true
      : mode === 'new' ? false : null
    if (type === 'Resonator') {
      resonatorVoices += t.tone?.resonatorVoices ?? DEFAULT_RESONATOR_VOICES
      const inert = []
      if (resonatorEnv === false && t.noteLength) inert.push('noteLength (only MIDI export uses it while the envelope is off)')
      if (t.legato === true) inert.push('legato (every note is a new attack)')
      if (t.glide) inert.push('glide')
      if (t.granular?.enabled) inert.push('granular (not available on this instrument yet)')
      if (resonatorEnv === false && t.drone?.enabled) inert.push('drone (without the envelope it strikes once and rings out)')
      if (inert.length) {
        const why = resonatorEnv === false ? ', which rings out on its own,' : ''
        out.push(`"${id}" is a Resonator${why} so ${inert.join(', ')} ${inert.length > 1 ? 'do' : 'does'} nothing.${resonatorEnv === false ? ' Set the ring length with tone.damping (higher rings longer), or give it an envelope to hold and release notes.' : ''}`)
      }
      const bow = t.tone?.bow
      if (resonatorEnv === false && bow > 0) {
        out.push(`"${id}" sets tone.bow but its envelope is off, so the bow does nothing. Give the track an envelope to switch it on.`)
      }
      if (resonatorEnv !== false && t.tone?.strike === false && !(bow > 0)) {
        out.push(`"${id}" turns tone.strike off with no tone.bow, so nothing excites the resonator and it is silent. Set tone.bow above 0 or keep the strike.`)
      }
    }
    if (type === 'Macro') {
      const m = t.tone?.macro ?? {}
      macroVoices += m.voices ?? DEFAULT_MACRO_VOICES
      // A new lane without an engine starts on the default; an edit that names
      // none keeps the lane's, which isn't known here.
      const engine = m.engine ?? (mode === 'new' ? macroEngine(undefined).id : null)
      const inert = []
      if (t.legato === true) inert.push('legato (every note is a new trigger)')
      if (t.glide) inert.push('glide')
      // Texture (a live insert) works on it; the GrainPlayer layer can't render it.
      if (t.granular?.enabled && !TEXTURE_ENABLED) inert.push('granular (not available on this instrument yet)')
      // Without the envelope only the 6-op FM engines hold a note; with it every
      // engine does.
      if (macroEnv === false && engine && !MACRO_GATED.has(engine)) {
        if (t.noteLength) inert.push('noteLength (without the envelope only the 6-op FM engines sustain while a note is held)')
        if (t.drone?.enabled) inert.push('drone (without the envelope the held note pings once and fades; only the 6-op FM engines hold it)')
      }
      if (inert.length) {
        out.push(`"${id}" is a Macro lane, so ${inert.join(', ')} ${inert.length > 1 ? 'do' : 'does'} nothing.${macroEnv === false && inert.some(s => s.startsWith('noteLength') || s.startsWith('drone')) ? ' Give it an envelope to hold notes on any engine.' : ''}`)
      }
      if (macroEnv === true && m.lpgColour != null) {
        out.push(`"${id}" sets tone.macro.lpgColour with its envelope on, which holds the low-pass gate open, so the colour does nothing.`)
      }
      if (engine === 'chiptune' && !m.timbreAmount) {
        out.push(`"${id}" uses the chiptune engine with timbreAmount 0, so every note drones until the next one takes its voice. Set tone.macro.timbreAmount (e.g. 0.3) for a decay.`)
      }
      if (Math.abs(m.fmAmount ?? 0) > 0.3 && !/drum|perc|fx/i.test(t.label?.text ?? '')) {
        out.push(`"${id}" sets tone.macro.fmAmount ${r2(m.fmAmount)}: each note's pitch sweeps by octaves, which sounds like a zap or laser drum rather than a tonal part. Keep it within ±0.15 for melody.`)
      }
    }
    // The envelope/note-length/granular checks below describe instruments with an
    // envelope; a Resonator or Macro only counts while its envelope is known to
    // be on.
    const enveloped = (type !== 'Resonator' || resonatorEnv === true) && (type !== 'Macro' || macroEnv === true)
    const drone = t.drone?.enabled === true
    // The Resonator and Macro ignore legato, so on them legato doesn't hold notes.
    const held = drone || (t.legato === true && type !== 'Resonator' && type !== 'Macro')

    if (!type && mode === 'new') {
      out.push(`"${id}" has no synthType, so it keeps whatever instrument the lane had before. Set one for a new composition.`)
    }
    if (type && NO_ENVELOPE.has(type) && t.envelope) {
      out.push(`"${id}" is a PluckSynth, which ignores envelope, note length and velocity. Shape it with tone.resonance (ring length) and tone.dampening (brightness) instead.`)
    }
    const velMap = normalizeVelocityMapping(t.stopVelocity)
    if (velMap && type && VELOCITY_DEAF_SYNTHS.has(type)) {
      out.push(`"${id}" sets stopVelocity, but PluckSynth ignores velocity. It is kept for when the lane changes instrument.`)
    }
    if (velMap && velMap.max - velMap.min < 0.1) {
      out.push(`"${id}" sets stopVelocity with min and max within 0.1 of each other, so stops barely differ. Widen the range for audible accents.`)
    }
    const attack = t.envelope?.attack
    const arp = t.arp?.enabled === true
    // Stop-driven note length: on a Poly / Pad lane, holds range min..max, so
    // only an attack longer than the longest hold never peaks (a shorter hold
    // than the attack just swells less — often the point on a pad).
    const demandLen = normalizeStopNoteLength(t.stopNoteLength)
    const demandActive = demandLen && STOP_NOTE_LENGTH_SYNTHS.has(type) && !held && !arp
    if (demandLen && !demandActive && (type || held || arp)) {
      const why = held ? (drone ? 'drone holds one note' : 'legato holds each note until the next')
        : arp ? 'the arp sets its own note length (arp.gate)'
        : 'it only drives Poly / Pad (PolySynth) lanes'
      out.push(`"${id}" sets stopNoteLength from demand, which does nothing here: ${why}. It is kept, and the lane plays its fixed noteLength.`)
    }
    const noteSec = beat * noteLengthBeats(demandActive ? demandLen.max : t.noteLength)
    const heldFor = demandActive ? `at most ${demandLen.max} (${r2(noteSec)} s at ${tempo} BPM), its longest stopNoteLength`
      : t.noteLength ? `${t.noteLength} (${r2(noteSec)} s at ${tempo} BPM)` : `one beat (${r2(beat)} s at ${tempo} BPM)`
    if (enveloped && attack != null && !held && !arp && !(type && NO_ENVELOPE.has(type)) && attack > noteSec) {
      out.push(`"${id}" has a ${r2(attack)} s attack but each note is held for ${heldFor}, so it never reaches full level. Shorten the attack, set a longer noteLength, or hold the note with drone/legato.`)
    }
    if (enveloped && t.noteLength && (held || arp || (type && NO_ENVELOPE.has(type)))) {
      const why = type && NO_ENVELOPE.has(type) ? 'PluckSynth ignores note length' : drone ? 'drone holds one note' : t.legato === true ? 'legato holds each note until the next' : 'the arp sets its own note length (arp.gate)'
      out.push(`"${id}" sets noteLength ${t.noteLength}, which does nothing here: ${why}.`)
    }
    // A PolySynth's voice: what the plan says, Basic for a new lane that says
    // nothing, unknown for an edit that says nothing (the lane keeps its own).
    const polyVoice = type !== 'PolySynth' ? null : t.tone?.voice ?? (mode === 'new' ? 'Synth' : null)
    if (polyVoice) {
      const inert = []
      if (polyVoice === 'Synth') {
        for (const key of ['harmonicity', 'modulationIndex', 'modEnvelope']) if (t.tone?.[key] != null) inert.push(`tone.${key}`)
      } else if (polyVoice === 'AMSynth' && t.tone?.modulationIndex != null) {
        inert.push('tone.modulationIndex')
      }
      if (inert.length) {
        out.push(`"${id}" is a PolySynth on its ${POLY_VOICE_LABELS[polyVoice]} voice, so ${inert.join(', ')} ${inert.length > 1 ? 'do' : 'does'} nothing.${polyVoice === 'Synth' ? ' Set tone.voice to "FMSynth" or "AMSynth" to use them.' : ' Only the FMSynth voice has a modulation index.'}`)
      }
    }
    const fmVoice = type === 'FMSynth' || polyVoice === 'FMSynth'
    const fmAttackDefault = type === 'PolySynth' ? SYNTH_DEFAULTS.PolySynth.attack : SYNTH_DEFAULTS.FMSynth.attack
    if (fmVoice && (t.envelope?.attack ?? fmAttackDefault) < FM_FAST_ATTACK && !t.tone?.modEnvelope) {
      out.push(`"${id}" is ${type === 'PolySynth' ? 'a PolySynth on its FM voice' : 'an FMSynth'} with a fast attack but the default 0.5 s modulator attack, so its brightness blooms late instead of striking. Set tone.modEnvelope (e.g. attack 0.001, decay 0.12, sustain 0).`)
    }
    if (t.legato === true && type && POLY_OR_SAMPLE.has(type)) {
      out.push(`"${id}" is a ${type} with legato on: held voices pile up instead of gliding; legato suits mono synths.`)
    }
    if (type && UNPITCHED.has(type)) {
      const pitched = []
      if (t.octave) pitched.push('octave')
      if (t.scale) pitched.push('scale')
      if (t.pitchVariety && t.pitchVariety.variety > 0) pitched.push('pitchVariety')
      if (t.arp?.enabled) pitched.push('arp')
      if (pitched.length) {
        out.push(`"${id}" is ${type === 'Drums' ? 'a fixed-pitch Drums one-shot' : 'unpitched NoiseSynth'}, so ${pitched.join(', ')} ${pitched.length > 1 ? 'have' : 'has'} no pitch effect.`)
      }
    }
    if (enveloped && type !== 'Resonator' && type !== 'Macro' && t.granular?.enabled) {
      if (type === 'Drums') {
        out.push(`"${id}" layers granular on a Drums lane: the grains follow the route's notes while the one-shot stays at its fixed pitch.`)
      }
      if ((t.granular.mix ?? 0) > GRANULAR_MIX_HIGH) {
        out.push(`"${id}" has granular mix ${r2(t.granular.mix)}; grains add on top of the dry sound, so start around 0.08.`)
      }
      if (/bass/i.test(t.label?.text ?? '')) {
        out.push(`"${id}" puts a granular layer on the bass: keep the bass dry.`)
      }
    }
    const source = t.sidechain?.enabled ? t.sidechain.source : null
    if (source?.startsWith(`${DRUMS_ROUTE_ID}:`) && plan.drums?.enabled) {
      const pad = source.slice(DRUMS_ROUTE_ID.length + 1)
      const steps = plan.drums.patterns?.[pad]
      if (steps && !steps.some(v => v > 0)) {
        out.push(`"${id}" ducks off drums:${pad}, but that pad has no steps, so it never ducks.`)
      }
    }
  }
  if (macroVoices > MACRO_VOICE_BUDGET) {
    out.push(`The plan runs ${macroVoices} Macro voices in total, which may stutter on phones. Keep tone.macro.voices at 1–2 on lanes that don't play chords.`)
  }
  if (resonatorVoices > RESONATOR_VOICE_BUDGET) {
    out.push(`The plan runs ${resonatorVoices} Resonator voices in total; each is a full resonator, so this may stutter on phones. Keep tone.resonatorVoices at 1–2 on lanes that don't play chords.`)
  }
  return out
}
