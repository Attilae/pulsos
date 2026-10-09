import test from 'node:test'
import assert from 'node:assert/strict'
import { generatePitchMap, noteToMidi, SCALES, PITCH_CONTOURS, normalizePitchVariety } from '../lib/mappings.js'
import { buildBasePitchMap, buildLanePitchMaps, buildMergedPitchCells, buildRouteSoundModes, laneGridStops, resolveStopPitch } from '../lib/lanePitch.js'
import { buildLanePitchMaps as displayPitchMaps } from '../lib/laneNotes.js'
import { buildLoopMidiEvents } from '../lib/midiEvents.js'
import { validatePlan } from '../lib/ai/planContract.js'
import { PLAN_INPUT_SCHEMA, COMPOSITION_RESPONSE_FORMAT } from '../lib/ai/planSchema.js'
import { defaultSnapshot, applyPlanToSnapshot, describeSnapshot } from '../lib/ai/planSnapshot.js'
import { buildSnapshot, applySnapshot } from '../lib/songState.js'

const stops = Array.from({ length: 6 }, (_, i) => ({
  id: String(i), name: `Station ${i}`, lat: 47.48 + i * .005,
  lon: 19.03 + [0, .01, .002, .015, .01, .02][i], dist: i * 100,
  signals: { demand: [0, .65, .65, .2, .95, 1][i] },
}))
const route = { id: 'A', name: 'A', type: 'tram', stops, totalDist: 500 }
const scale = { root: 'D', scaleType: 'minor' }
const fixtureNotes = {
  demand: [ ['C3', 'B4', 'B4', 'G3', 'A5', 'B5'], ['C3', 'B4', 'C5', 'A3', 'G5', 'B5'] ],
  geographic: [ ['C3', 'D4', 'E3', 'G5', 'A4', 'B5'], ['G3', 'C5', 'E4', 'A6', 'A5', 'B6'] ],
  randomWalk: [ ['F3', 'G4', 'A3', 'F5', 'A4', 'A5'], ['E4', 'G5', 'A4', 'G6', 'G5', 'B6'] ],
  arch: [ ['C3', 'G4', 'B3', 'B5', 'G4', 'C5'], ['G3', 'G5', 'B4', 'B6', 'E5', 'G5'] ],
}

test('old contours preserve pre-feature notes with new controls absent', () => {
  for (const [contour, fixtures] of Object.entries(fixtureNotes)) {
    for (const [i, variety] of [0, .7].entries()) {
      const options = { contour, variety, routeId: 'A' }
      assert.deepEqual(generatePitchMap(stops, 48, SCALES.major, 3, options), fixtures[i])
      assert.deepEqual(generatePitchMap(stops, 48, SCALES.major, 3, { ...options, maxLeap: 0 }), fixtures[i])
    }
  }
})

test('fresh and synthetic lanes retain selected scales without explicit sound modes', () => {
  const lanes = [route, { ...route, id: 'A~dup' }, { ...route, id: 'merged' }]
  const scales = { A: scale, 'A~dup': { root: 'F#', scaleType: 'pentatonicMinor' } }
  const modes = buildRouteSoundModes(lanes, {}, scales)
  assert.deepEqual(modes.A, { mode: 'harmonic', scale })
  assert.deepEqual(modes['A~dup'].scale, scales['A~dup'])
  assert.deepEqual(modes.merged.scale, { root: 'C', scaleType: 'major' })
  assert.deepEqual(buildRouteSoundModes(lanes, { A: 'percussive' }, scales).A, { mode: 'percussive', scale })
  assert.deepEqual(buildRouteSoundModes(null), {})
})

test('display, playback note resolution and MIDI agree after every pitch transformation', () => {
  for (const contour of PITCH_CONTOURS) {
    const pitchVariety = { contour, variety: .7, span: 2, maxLeap: 2 }
    const options = { scale, pitchVariety, perStopSteps: { '1': -3, '3': 2 }, octaveShift: -1, semitoneShift: 3,
      gridResolution: '8t', loopRegion: { startCell: 10, endCell: 55 } }
    const base = buildBasePitchMap(route, options)
    const display = displayPitchMaps(route, options).pitchMap
    const playback = base.map((note, i) => resolveStopPitch(note, { ...options, degrees: options.perStopSteps[stops[i].id] ?? 0 }))
    assert.deepEqual(display, playback)
    const midi = buildLoopMidiEvents(route, {
      trackScales: { A: scale }, trackPitchVariety: { A: pitchVariety },
      perStopSteps: { A: options.perStopSteps }, trackOctaves: { A: -1 }, trackSemitones: { A: 3 },
      trackGridResolutions: { A: options.gridResolution }, trackLoopRegions: { A: options.loopRegion },
    })
    assert.deepEqual(midi.map(e => e.midi), laneGridStops(route, options).map(s => noteToMidi(display[s.originalIdx])))
  }
})

test('explicit ranges and cyclic leaps hold for every scale, contour and grid, including trimmed loops', () => {
  const patterns = [stops, Array.from({ length: 80 }, (_, i) => ({
    id: `p${i}`, lat: 47.5 + Math.sin(i * 1.7) * .02,
    lon: 19 + Math.cos(i * 2.3) * .01, dist: i * 100,
    signals: { demand: i % 2 },
  }))]
  for (const [scaleType, intervals] of Object.entries(SCALES)) {
    for (const contour of PITCH_CONTOURS) for (const span of [1, 2, 3]) for (const maxLeap of [1, 2, 4]) {
      for (const gridResolution of ['4n', '16n', '8t']) for (const pattern of patterns) {
        const r = { ...route, stops: pattern, totalDist: pattern.at(-1).dist }
        const options = { scale: { root: 'C', scaleType }, pitchVariety: { contour, variety: 1, span, maxLeap },
          gridResolution, loopRegion: { startCell: 10, endCell: 49 } }
        const notes = buildBasePitchMap(r, options)
        const degree = note => {
          const delta = noteToMidi(note) - 48
          const idx = intervals.indexOf(delta % 12)
          assert.ok(idx >= 0, `${contour} stayed in ${scaleType}`)
          const d = Math.floor(delta / 12) * intervals.length + idx
          assert.ok(d >= 0 && d < span * intervals.length)
          return d
        }
        notes.forEach(degree)
        const audible = laneGridStops(r, options).map(s => degree(notes[s.originalIdx]))
        for (let i = 0; i < audible.length; i++) {
          assert.ok(Math.abs(audible[i] - audible[(i + 1) % audible.length]) <= maxLeap,
            `${contour}/${scaleType}: ${audible}, limit ${maxLeap}`)
        }
      }
    }
  }
})

test('geometry adds stable melody to tied demand and handles absent or coincident coordinates', () => {
  const tied = stops.map(s => ({ ...s, signals: { demand: .65 } }))
  const options = { contour: 'geometryDemand', variety: 0, span: 2, maxLeap: 2, routeId: 'A' }
  const notes = generatePitchMap(tied, 48, SCALES.major, 3, options)
  assert.ok(new Set(notes).size > 1)
  assert.deepEqual(generatePitchMap(tied, 48, SCALES.major, 3, options), notes)
  for (const inputs of [[], [{}], [{ lat: 47, lon: 19 }, { lat: 47, lng: 19 }], [{ lat: 47, lon: 179.99 }, { lat: 47, lon: -179.99 }, {}]]) {
    const result = generatePitchMap(inputs, 48, SCALES.major, 3, options)
    assert.equal(result.length, inputs.length)
    result.forEach(n => assert.ok(Number.isFinite(noteToMidi(n))))
  }
})

test('explicit stop edits override automatic constraints; octave and transpose remain live inputs', () => {
  const options = { scale, pitchVariety: { contour: 'geometryDemand', span: 1, maxLeap: 1 } }
  const base = buildBasePitchMap(route, options)
  const edited = buildLanePitchMaps(route, { ...options, perStopSteps: { '0': 14 }, octaveShift: 1, semitoneShift: 2 })
  assert.equal(edited.pitchMap[0], resolveStopPitch(base[0], { scale, degrees: 14, octaveShift: 1, semitoneShift: 2 }))
  assert.ok(noteToMidi(edited.pitchMap[0]) > noteToMidi(base[0]) + 24)
})

test('merged chord MIDI includes every source voice resolved in the merged lane key', () => {
  const second = { ...route, id: 'B', stops: stops.map(s => ({ ...s, signals: { demand: 1 - s.signals.demand } })) }
  const merged = { ...route, id: 'merged', isMerged: true, sourceRoutes: [route, second] }
  const pitchVariety = { contour: 'geometryDemand', span: 2, maxLeap: 2 }
  const options = { scale, pitchVariety, octaveShift: 1, semitoneShift: -2 }
  const cells = buildMergedPitchCells(merged, options)
  const midi = buildLoopMidiEvents(merged, { trackScales: { merged: scale }, trackPitchVariety: { merged: pitchVariety },
    trackOctaves: { merged: 1 }, trackSemitones: { merged: -2 } })
  assert.deepEqual(midi.map(e => e.midi), cells.flatMap(c => c.notes.map(noteToMidi)))
  assert.ok(midi.length > stops.length, 'both source voices survive')
})

test('composer schema, validation, description and song save/load retain optional pitch settings', () => {
  const pitchVariety = { contour: 'geometryDemand', variety: .3, span: 2, maxLeap: 2 }
  const raw = { tracks: [{ routeId: 'A', synthType: 'Synth', pitchVariety }] }
  const parsed = PLAN_INPUT_SCHEMA.parse(raw)
  assert.deepEqual(parsed.tracks[0].pitchVariety, pitchVariety)
  const { plan, dropped } = validatePlan(parsed, [route])
  assert.deepEqual(dropped, [])
  assert.deepEqual(plan.tracks[0].pitchVariety, pitchVariety)
  const { snapshot } = applyPlanToSnapshot(defaultSnapshot('budapest'), plan)
  assert.deepEqual(snapshot.trackPitchVariety.A, pitchVariety)
  const state = {}
  applySnapshot(snapshot, { setTrackPitchVariety: value => { state.trackPitchVariety = value } }, null, [route])
  assert.deepEqual(buildSnapshot(state).trackPitchVariety.A, pitchVariety)
  assert.deepEqual(describeSnapshot(snapshot, [route], { detail: true }).lanes[0].pitchVariety, pitchVariety)
  const strictPitch = COMPOSITION_RESPONSE_FORMAT.json_schema.schema.properties.tracks.items.properties.pitchVariety
  const object = strictPitch.anyOf.find(s => s.type === 'object')
  assert.ok(object.required.includes('span') && object.required.includes('maxLeap'))
})

test('invalid pitch controls are ignored without dropping a valid contour', () => {
  assert.deepEqual(normalizePitchVariety({ contour: 'nope', variety: NaN, span: 9, maxLeap: -1 }), { contour: 'demand', variety: 0 })
  const { plan, dropped } = validatePlan({ tracks: [{ routeId: 'A', pitchVariety: { contour: 'demand', variety: .2, span: 0, maxLeap: 8 } }] }, [route])
  assert.deepEqual(plan.tracks[0].pitchVariety, { contour: 'demand', variety: .2 })
  assert.equal(dropped.length, 2)
})
