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

import { SYNTH_DEFAULTS, DRUMS_ROUTE_ID } from '../soundSpecs.js'
import { noteLengthBeats } from '../noteLength.js'

const NO_ENVELOPE = new Set(['PluckSynth'])
const UNPITCHED = new Set(['NoiseSynth', 'Drums'])
const POLY_OR_SAMPLE = new Set(['Sampler', 'PolySynth'])
const GRANULAR_MIX_HIGH = 0.3
const FM_FAST_ATTACK = 0.05

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

  for (const t of plan.tracks ?? []) {
    const id = t.routeId
    const type = t.synthType
    const drone = t.drone?.enabled === true
    const held = drone || t.legato === true

    if (!type && mode === 'new') {
      out.push(`"${id}" has no synthType, so it keeps whatever instrument the lane had before — set one for a new composition.`)
    }
    if (type && NO_ENVELOPE.has(type) && t.envelope) {
      out.push(`"${id}" is a PluckSynth, which ignores envelope, note length and velocity — shape it with tone.resonance (ring length) and tone.dampening (brightness) instead.`)
    }
    const attack = t.envelope?.attack
    const arp = t.arp?.enabled === true
    const noteSec = beat * noteLengthBeats(t.noteLength)
    const heldFor = t.noteLength ? `${t.noteLength} (${r2(noteSec)} s at ${tempo} BPM)` : `one beat (${r2(beat)} s at ${tempo} BPM)`
    if (attack != null && !held && !arp && !(type && NO_ENVELOPE.has(type)) && attack > noteSec) {
      out.push(`"${id}" has a ${r2(attack)} s attack but each note is held for ${heldFor}, so it never reaches full level — shorten the attack, set a longer noteLength, or hold the note with drone/legato.`)
    }
    if (t.noteLength && (held || arp || (type && NO_ENVELOPE.has(type)))) {
      const why = type && NO_ENVELOPE.has(type) ? 'PluckSynth ignores note length' : drone ? 'drone holds one note' : t.legato === true ? 'legato holds each note until the next' : 'the arp sets its own note length (arp.gate)'
      out.push(`"${id}" sets noteLength ${t.noteLength}, which does nothing here — ${why}.`)
    }
    if (type === 'FMSynth' && (t.envelope?.attack ?? SYNTH_DEFAULTS.FMSynth.attack) < FM_FAST_ATTACK && !t.tone?.modEnvelope) {
      out.push(`"${id}" is an FMSynth with a fast attack but the default 0.5 s modulator attack, so its brightness blooms late instead of striking — set tone.modEnvelope (e.g. attack 0.001, decay 0.12, sustain 0).`)
    }
    if (t.legato === true && type && POLY_OR_SAMPLE.has(type)) {
      out.push(`"${id}" is a ${type} with legato on — held voices pile up instead of gliding; legato suits mono synths.`)
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
    if (t.granular?.enabled) {
      if (type === 'Drums') {
        out.push(`"${id}" layers granular on a Drums lane — the grains follow the route's notes while the one-shot stays at its fixed pitch.`)
      }
      if ((t.granular.mix ?? 0) > GRANULAR_MIX_HIGH) {
        out.push(`"${id}" has granular mix ${r2(t.granular.mix)}; grains add on top of the dry sound, so start around 0.08.`)
      }
      if (/bass/i.test(t.label?.text ?? '')) {
        out.push(`"${id}" puts a granular layer on the bass — keep the bass dry.`)
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
  return out
}
