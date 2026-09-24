import test from 'node:test'
import assert from 'node:assert/strict'
import { NOTE_LENGTHS, DEFAULT_NOTE_LENGTH, normalizeNoteLength, noteLengthBeats, normalizeNoteLengthMap } from '../lib/noteLength.js'
import { validatePlan } from '../lib/ai/planContract.js'
import { withNewCompositionBaseline } from '../lib/ai/planApply.js'
import { planAdvisories } from '../lib/ai/planAdvisories.js'

// Per-lane note length (lib/noteLength.js). Absent must mean the legacy gate so
// older songs keep sounding the same; everything else is a Tone division.

test('note lengths are Tone divisions with their beat counts, default one beat', () => {
  assert.equal(DEFAULT_NOTE_LENGTH, '4n')
  assert.deepEqual(NOTE_LENGTHS, ['16n', '8n', '8n.', '4n', '4n.', '2n', '1n'])
  assert.equal(noteLengthBeats('8n.'), 0.75)
  assert.equal(noteLengthBeats('1n'), 4)
  assert.equal(noteLengthBeats(null), 1, 'unset → the legacy one-beat gate')
  assert.equal(noteLengthBeats(undefined, 0.5), 0.5, 'unset → the caller\'s legacy fallback (percussive/live 8n)')
  assert.equal(noteLengthBeats('3n'), 1)
})

test('normalize drops anything that is not a known length', () => {
  assert.equal(normalizeNoteLength('2n'), '2n')
  for (const bad of ['3n', 2, null, undefined, '', '8t']) assert.equal(normalizeNoteLength(bad), null)
  assert.deepEqual(normalizeNoteLengthMap({ a: '8n', b: 'nope', c: null }), { a: '8n' })
  assert.deepEqual(normalizeNoteLengthMap(undefined), {})
})

test('validatePlan keeps a valid noteLength and reports a bad one', () => {
  const routes = [{ id: 'A' }, { id: 'B' }]
  const { plan, dropped } = validatePlan({ tracks: [
    { routeId: 'A', synthType: 'Synth', noteLength: '8n.' },
    { routeId: 'B', synthType: 'Synth', noteLength: '3n' },
  ] }, routes)
  assert.equal(plan.tracks[0].noteLength, '8n.')
  assert.equal(plan.tracks[1].noteLength, undefined)
  assert.ok(dropped.includes('noteLength "3n" on "B"'))
})

test('a new composition resets every lane to the default note length', () => {
  const plan = withNewCompositionBaseline({ tracks: [{ routeId: 'A' }, { routeId: 'B', noteLength: '2n' }] })
  assert.equal(plan.tracks[0].noteLength, '4n')
  assert.equal(plan.tracks[1].noteLength, '2n')
})

test('advisories judge the attack against the lane\'s note length', () => {
  const env = (attack) => ({ attack, decay: 0.2, sustain: 0.5, release: 0.3 })
  const at120 = (track) => planAdvisories({ bpm: 120, tracks: [{ routeId: 'A', synthType: 'Synth', ...track }] })
  assert.match(at120({ envelope: env(0.8) })[0], /held for one beat \(0\.5 s at 120 BPM\)/)
  assert.deepEqual(at120({ envelope: env(0.8), noteLength: '2n' }), [], 'a half note (1 s) lets a 0.8 s attack peak')
  assert.match(at120({ envelope: env(0.3), noteLength: '8n' })[0], /held for 8n \(0\.25 s at 120 BPM\)/)
})

test('advisories flag a note length that cannot act', () => {
  const one = (track, pattern) => {
    const out = planAdvisories({ bpm: 120, tracks: [{ routeId: 'A', synthType: 'Synth', ...track }] })
    assert.equal(out.length, 1, JSON.stringify(out))
    assert.match(out[0], pattern)
  }
  one({ noteLength: '2n', legato: true }, /legato holds each note/)
  one({ noteLength: '2n', arp: { enabled: true, style: 'up', rate: '16n', gate: 0.5, octaves: 1, steps: 3, distance: 2 } }, /arp\.gate/)
  one({ synthType: 'PluckSynth', noteLength: '8n' }, /PluckSynth ignores note length/)
})
