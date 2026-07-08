import * as Tone from 'tone'
import { AlertLayer }      from './alertLayer.js'
import { NetworkState }    from './networkState.js'
import { VehicleVoice }   from './vehicleVoice.js'
import { GranularVoice }  from './granularVoice.js'
import { FxTrack, FX_BUSES, AUTOMATION_TARGETS } from './fxTrack.js'
import { AutomationTrack } from './automationTrack.js'
import { DrumSequencer } from './engines/drumEngine.js'
import {
  geoToMidi, midiToNote, randomFromScale, shiftOctaveNote, denormalizeToRange, denormalizeExp,
  snapStopsToGrid, GRID_TOTAL_CELLS, GRID_BARS, GRID_STEPS_PER_BAR, GRID_RESOLUTION_STEPS_PER_BAR, DEFAULT_GRID_RESOLUTION,
  generatePitchMap, routeBounds, SCALES, noteToMidi, MODES,
  buildArpSequence, transposeNoteInScale,
} from './mappings.js'

export const LINE_TYPES = ['metro', 'tram', 'trolley', 'bus', 'hev']

export const LINE_TYPE_COLORS = {
  metro:   '#E2001A',
  tram:    '#FFD700',
  trolley: '#C8102E',
  bus:     '#0066CC',
  hev:     '#009640',
}

export const SYNTH_TYPES = [
  'Synth', 'FMSynth', 'NoiseSynth', 'PolySynth',
  'Sampler', 'Drums',
]

// Arpeggiator option lists + defaults (defined in mappings; re-exported so the UI
// and composer share one source of truth alongside SYNTH_TYPES).
export { ARP_STYLES, ARP_RATES, DEFAULT_ARP } from './mappings.js'

// Multi-sample instruments for Tone.Sampler. Each preset maps a handful of
// notes to hosted sample files; Tone.Sampler pitch-shifts between them.
export const SAMPLER_PRESETS = {
  piano: {
    id: 'piano', label: 'Piano (Salamander)',
    baseUrl: 'https://tonejs.github.io/audio/salamander/',
    urls: {
      A0: 'A0.mp3', C1: 'C1.mp3', 'D#1': 'Ds1.mp3', 'F#1': 'Fs1.mp3',
      A1: 'A1.mp3', C2: 'C2.mp3', 'D#2': 'Ds2.mp3', 'F#2': 'Fs2.mp3',
      A2: 'A2.mp3', C3: 'C3.mp3', 'D#3': 'Ds3.mp3', 'F#3': 'Fs3.mp3',
      A3: 'A3.mp3', C4: 'C4.mp3', 'D#4': 'Ds4.mp3', 'F#4': 'Fs4.mp3',
      A4: 'A4.mp3', C5: 'C5.mp3', 'D#5': 'Ds5.mp3', 'F#5': 'Fs5.mp3',
      A5: 'A5.mp3', C6: 'C6.mp3', A6: 'A6.mp3', C7: 'C7.mp3', C8: 'C8.mp3',
    },
    license: 'CC-BY 3.0', attribution: 'Salamander Grand Piano V3 (Alexander Holm)',
    source: 'https://github.com/sfzinstruments/SalamanderGrandPiano',
  },
  casio: {
    id: 'casio', label: 'Casio',
    baseUrl: 'https://tonejs.github.io/audio/casio/',
    urls: {
      A1: 'A1.mp3', 'A#1': 'As1.mp3', B1: 'B1.mp3', C2: 'C2.mp3',
      'C#2': 'Cs2.mp3', D2: 'D2.mp3', 'D#2': 'Ds2.mp3', E2: 'E2.mp3',
      F2: 'F2.mp3', 'F#2': 'Fs2.mp3', G2: 'G2.mp3', 'G#1': 'Gs1.mp3',
    },
    license: 'CC-BY 3.0', attribution: 'Tonejs/audio sample set',
    source: 'https://github.com/Tonejs/audio',
  },
  'bass-electric': {
    id: 'bass-electric', label: 'Electric Bass',
    baseUrl: 'https://nbrosowsky.github.io/tonejs-instruments/samples/bass-electric/',
    urls: { 'A#1': 'As1.mp3', 'A#2': 'As2.mp3', 'A#3': 'As3.mp3', 'A#4': 'As4.mp3', 'C#1': 'Cs1.mp3', 'C#2': 'Cs2.mp3', 'C#3': 'Cs3.mp3', 'C#4': 'Cs4.mp3', 'E1': 'E1.mp3', 'E2': 'E2.mp3', 'E3': 'E3.mp3', 'E4': 'E4.mp3', 'G1': 'G1.mp3', 'G2': 'G2.mp3', 'G3': 'G3.mp3', 'G4': 'G4.mp3' },
    license: 'CC-BY 3.0', attribution: 'nbrosowsky/tonejs-instruments',
    source: 'https://github.com/nbrosowsky/tonejs-instruments',
  },
  bassoon: {
    id: 'bassoon', label: 'Bassoon',
    baseUrl: 'https://nbrosowsky.github.io/tonejs-instruments/samples/bassoon/',
    urls: { 'A4': 'A4.mp3', 'C3': 'C3.mp3', 'C4': 'C4.mp3', 'C5': 'C5.mp3', 'E4': 'E4.mp3', 'G2': 'G2.mp3', 'G3': 'G3.mp3', 'G4': 'G4.mp3', 'A2': 'A2.mp3', 'A3': 'A3.mp3' },
    license: 'CC-BY 3.0', attribution: 'nbrosowsky/tonejs-instruments',
    source: 'https://github.com/nbrosowsky/tonejs-instruments',
  },
  cello: {
    id: 'cello', label: 'Cello',
    baseUrl: 'https://nbrosowsky.github.io/tonejs-instruments/samples/cello/',
    urls: { 'E3': 'E3.mp3', 'E4': 'E4.mp3', 'F2': 'F2.mp3', 'F3': 'F3.mp3', 'F4': 'F4.mp3', 'F#3': 'Fs3.mp3', 'F#4': 'Fs4.mp3', 'G2': 'G2.mp3', 'G3': 'G3.mp3', 'G4': 'G4.mp3', 'G#2': 'Gs2.mp3', 'G#3': 'Gs3.mp3', 'G#4': 'Gs4.mp3', 'A2': 'A2.mp3', 'A3': 'A3.mp3', 'A4': 'A4.mp3', 'A#2': 'As2.mp3', 'A#3': 'As3.mp3', 'B2': 'B2.mp3', 'B3': 'B3.mp3', 'B4': 'B4.mp3', 'C2': 'C2.mp3', 'C3': 'C3.mp3', 'C4': 'C4.mp3', 'C5': 'C5.mp3', 'C#3': 'Cs3.mp3', 'C#4': 'Cs4.mp3', 'D2': 'D2.mp3', 'D3': 'D3.mp3', 'D4': 'D4.mp3', 'D#2': 'Ds2.mp3', 'D#3': 'Ds3.mp3', 'D#4': 'Ds4.mp3', 'E2': 'E2.mp3' },
    license: 'CC-BY 3.0', attribution: 'nbrosowsky/tonejs-instruments',
    source: 'https://github.com/nbrosowsky/tonejs-instruments',
  },
  clarinet: {
    id: 'clarinet', label: 'Clarinet',
    baseUrl: 'https://nbrosowsky.github.io/tonejs-instruments/samples/clarinet/',
    urls: { 'D4': 'D4.mp3', 'D5': 'D5.mp3', 'D6': 'D6.mp3', 'F3': 'F3.mp3', 'F4': 'F4.mp3', 'F5': 'F5.mp3', 'F#6': 'Fs6.mp3', 'A#3': 'As3.mp3', 'A#4': 'As4.mp3', 'A#5': 'As5.mp3', 'D3': 'D3.mp3' },
    license: 'CC-BY 3.0', attribution: 'nbrosowsky/tonejs-instruments',
    source: 'https://github.com/nbrosowsky/tonejs-instruments',
  },
  contrabass: {
    id: 'contrabass', label: 'Contrabass',
    baseUrl: 'https://nbrosowsky.github.io/tonejs-instruments/samples/contrabass/',
    urls: { 'C2': 'C2.mp3', 'C#3': 'Cs3.mp3', 'D2': 'D2.mp3', 'E2': 'E2.mp3', 'E3': 'E3.mp3', 'F#1': 'Fs1.mp3', 'F#2': 'Fs2.mp3', 'G1': 'G1.mp3', 'G#2': 'Gs2.mp3', 'G#3': 'Gs3.mp3', 'A2': 'A2.mp3', 'A#1': 'As1.mp3', 'B3': 'B3.mp3' },
    license: 'CC-BY 3.0', attribution: 'nbrosowsky/tonejs-instruments',
    source: 'https://github.com/nbrosowsky/tonejs-instruments',
  },
  flute: {
    id: 'flute', label: 'Flute',
    baseUrl: 'https://nbrosowsky.github.io/tonejs-instruments/samples/flute/',
    urls: { 'A6': 'A6.mp3', 'C4': 'C4.mp3', 'C5': 'C5.mp3', 'C6': 'C6.mp3', 'C7': 'C7.mp3', 'E4': 'E4.mp3', 'E5': 'E5.mp3', 'E6': 'E6.mp3', 'A4': 'A4.mp3', 'A5': 'A5.mp3' },
    license: 'CC-BY 3.0', attribution: 'nbrosowsky/tonejs-instruments',
    source: 'https://github.com/nbrosowsky/tonejs-instruments',
  },
  'french-horn': {
    id: 'french-horn', label: 'French Horn',
    baseUrl: 'https://nbrosowsky.github.io/tonejs-instruments/samples/french-horn/',
    urls: { 'D3': 'D3.mp3', 'D5': 'D5.mp3', 'D#2': 'Ds2.mp3', 'F3': 'F3.mp3', 'F5': 'F5.mp3', 'G2': 'G2.mp3', 'A1': 'A1.mp3', 'A3': 'A3.mp3', 'C2': 'C2.mp3', 'C4': 'C4.mp3' },
    license: 'CC-BY 3.0', attribution: 'nbrosowsky/tonejs-instruments',
    source: 'https://github.com/nbrosowsky/tonejs-instruments',
  },
  'guitar-acoustic': {
    id: 'guitar-acoustic', label: 'Guitar (Acoustic)',
    baseUrl: 'https://nbrosowsky.github.io/tonejs-instruments/samples/guitar-acoustic/',
    urls: { 'F4': 'F4.mp3', 'F#2': 'Fs2.mp3', 'F#3': 'Fs3.mp3', 'F#4': 'Fs4.mp3', 'G2': 'G2.mp3', 'G3': 'G3.mp3', 'G4': 'G4.mp3', 'G#2': 'Gs2.mp3', 'G#3': 'Gs3.mp3', 'G#4': 'Gs4.mp3', 'A2': 'A2.mp3', 'A3': 'A3.mp3', 'A4': 'A4.mp3', 'A#2': 'As2.mp3', 'A#3': 'As3.mp3', 'A#4': 'As4.mp3', 'B2': 'B2.mp3', 'B3': 'B3.mp3', 'B4': 'B4.mp3', 'C3': 'C3.mp3', 'C4': 'C4.mp3', 'C5': 'C5.mp3', 'C#3': 'Cs3.mp3', 'C#4': 'Cs4.mp3', 'C#5': 'Cs5.mp3', 'D2': 'D2.mp3', 'D3': 'D3.mp3', 'D4': 'D4.mp3', 'D5': 'D5.mp3', 'D#2': 'Ds2.mp3', 'D#3': 'Ds3.mp3', 'E2': 'E2.mp3', 'E3': 'E3.mp3', 'E4': 'E4.mp3', 'F2': 'F2.mp3', 'F3': 'F3.mp3' },
    license: 'CC-BY 3.0', attribution: 'nbrosowsky/tonejs-instruments',
    source: 'https://github.com/nbrosowsky/tonejs-instruments',
  },
  'guitar-electric': {
    id: 'guitar-electric', label: 'Guitar (Electric)',
    baseUrl: 'https://nbrosowsky.github.io/tonejs-instruments/samples/guitar-electric/',
    urls: { 'D#3': 'Ds3.mp3', 'D#4': 'Ds4.mp3', 'D#5': 'Ds5.mp3', 'E2': 'E2.mp3', 'F#2': 'Fs2.mp3', 'F#3': 'Fs3.mp3', 'F#4': 'Fs4.mp3', 'F#5': 'Fs5.mp3', 'A2': 'A2.mp3', 'A3': 'A3.mp3', 'A4': 'A4.mp3', 'A5': 'A5.mp3', 'C3': 'C3.mp3', 'C4': 'C4.mp3', 'C5': 'C5.mp3', 'C6': 'C6.mp3', 'C#2': 'Cs2.mp3' },
    license: 'CC-BY 3.0', attribution: 'nbrosowsky/tonejs-instruments',
    source: 'https://github.com/nbrosowsky/tonejs-instruments',
  },
  'guitar-nylon': {
    id: 'guitar-nylon', label: 'Guitar (Nylon)',
    baseUrl: 'https://nbrosowsky.github.io/tonejs-instruments/samples/guitar-nylon/',
    urls: { 'F#2': 'Fs2.mp3', 'F#3': 'Fs3.mp3', 'F#4': 'Fs4.mp3', 'F#5': 'Fs5.mp3', 'G3': 'G3.mp3', 'G#2': 'Gs2.mp3', 'G#4': 'Gs4.mp3', 'G#5': 'Gs5.mp3', 'A2': 'A2.mp3', 'A3': 'A3.mp3', 'A4': 'A4.mp3', 'A5': 'A5.mp3', 'A#5': 'As5.mp3', 'B1': 'B1.mp3', 'B2': 'B2.mp3', 'B3': 'B3.mp3', 'B4': 'B4.mp3', 'C#3': 'Cs3.mp3', 'C#4': 'Cs4.mp3', 'C#5': 'Cs5.mp3', 'D2': 'D2.mp3', 'D3': 'D3.mp3', 'D5': 'D5.mp3', 'D#4': 'Ds4.mp3', 'E2': 'E2.mp3', 'E3': 'E3.mp3', 'E4': 'E4.mp3', 'E5': 'E5.mp3' },
    license: 'CC-BY 3.0', attribution: 'nbrosowsky/tonejs-instruments',
    source: 'https://github.com/nbrosowsky/tonejs-instruments',
  },
  harmonium: {
    id: 'harmonium', label: 'Harmonium',
    baseUrl: 'https://nbrosowsky.github.io/tonejs-instruments/samples/harmonium/',
    urls: { 'C2': 'C2.mp3', 'C3': 'C3.mp3', 'C4': 'C4.mp3', 'C5': 'C5.mp3', 'C#2': 'Cs2.mp3', 'C#3': 'Cs3.mp3', 'C#4': 'Cs4.mp3', 'C#5': 'Cs5.mp3', 'D2': 'D2.mp3', 'D3': 'D3.mp3', 'D4': 'D4.mp3', 'D5': 'D5.mp3', 'D#2': 'Ds2.mp3', 'D#3': 'Ds3.mp3', 'D#4': 'Ds4.mp3', 'E2': 'E2.mp3', 'E3': 'E3.mp3', 'E4': 'E4.mp3', 'F2': 'F2.mp3', 'F3': 'F3.mp3', 'F4': 'F4.mp3', 'F#2': 'Fs2.mp3', 'F#3': 'Fs3.mp3', 'G2': 'G2.mp3', 'G3': 'G3.mp3', 'G4': 'G4.mp3', 'G#2': 'Gs2.mp3', 'G#3': 'Gs3.mp3', 'G#4': 'Gs4.mp3', 'A2': 'A2.mp3', 'A3': 'A3.mp3', 'A4': 'A4.mp3', 'A#2': 'As2.mp3', 'A#3': 'As3.mp3', 'A#4': 'As4.mp3' },
    license: 'CC-BY 3.0', attribution: 'nbrosowsky/tonejs-instruments',
    source: 'https://github.com/nbrosowsky/tonejs-instruments',
  },
  harp: {
    id: 'harp', label: 'Harp',
    baseUrl: 'https://nbrosowsky.github.io/tonejs-instruments/samples/harp/',
    urls: { 'C5': 'C5.mp3', 'D2': 'D2.mp3', 'D4': 'D4.mp3', 'D6': 'D6.mp3', 'D7': 'D7.mp3', 'E1': 'E1.mp3', 'E3': 'E3.mp3', 'E5': 'E5.mp3', 'F2': 'F2.mp3', 'F4': 'F4.mp3', 'F6': 'F6.mp3', 'F7': 'F7.mp3', 'G1': 'G1.mp3', 'G3': 'G3.mp3', 'G5': 'G5.mp3', 'A2': 'A2.mp3', 'A4': 'A4.mp3', 'A6': 'A6.mp3', 'B1': 'B1.mp3', 'B3': 'B3.mp3', 'B5': 'B5.mp3', 'B6': 'B6.mp3', 'C3': 'C3.mp3' },
    license: 'CC-BY 3.0', attribution: 'nbrosowsky/tonejs-instruments',
    source: 'https://github.com/nbrosowsky/tonejs-instruments',
  },
  organ: {
    id: 'organ', label: 'Organ',
    baseUrl: 'https://nbrosowsky.github.io/tonejs-instruments/samples/organ/',
    urls: { 'C3': 'C3.mp3', 'C4': 'C4.mp3', 'C5': 'C5.mp3', 'C6': 'C6.mp3', 'D#1': 'Ds1.mp3', 'D#2': 'Ds2.mp3', 'D#3': 'Ds3.mp3', 'D#4': 'Ds4.mp3', 'D#5': 'Ds5.mp3', 'F#1': 'Fs1.mp3', 'F#2': 'Fs2.mp3', 'F#3': 'Fs3.mp3', 'F#4': 'Fs4.mp3', 'F#5': 'Fs5.mp3', 'A1': 'A1.mp3', 'A2': 'A2.mp3', 'A3': 'A3.mp3', 'A4': 'A4.mp3', 'A5': 'A5.mp3', 'C1': 'C1.mp3', 'C2': 'C2.mp3' },
    license: 'CC-BY 3.0', attribution: 'nbrosowsky/tonejs-instruments',
    source: 'https://github.com/nbrosowsky/tonejs-instruments',
  },
  'piano-tji': {
    id: 'piano-tji', label: 'Piano (Tji)',
    baseUrl: 'https://nbrosowsky.github.io/tonejs-instruments/samples/piano/',
    urls: { 'A1': 'A1.mp3', 'A2': 'A2.mp3', 'A3': 'A3.mp3', 'A4': 'A4.mp3', 'A5': 'A5.mp3', 'A6': 'A6.mp3', 'A7': 'A7.mp3', 'C1': 'C1.mp3', 'C2': 'C2.mp3', 'C3': 'C3.mp3', 'C4': 'C4.mp3', 'C5': 'C5.mp3', 'C6': 'C6.mp3', 'C7': 'C7.mp3', 'D#1': 'Ds1.mp3', 'D#2': 'Ds2.mp3', 'D#3': 'Ds3.mp3', 'D#4': 'Ds4.mp3', 'D#5': 'Ds5.mp3', 'D#6': 'Ds6.mp3', 'D#7': 'Ds7.mp3', 'F#1': 'Fs1.mp3', 'F#2': 'Fs2.mp3', 'F#3': 'Fs3.mp3', 'F#4': 'Fs4.mp3', 'F#5': 'Fs5.mp3', 'F#6': 'Fs6.mp3', 'F#7': 'Fs7.mp3' },
    license: 'CC-BY 3.0', attribution: 'nbrosowsky/tonejs-instruments',
    source: 'https://github.com/nbrosowsky/tonejs-instruments',
  },
  saxophone: {
    id: 'saxophone', label: 'Saxophone',
    baseUrl: 'https://nbrosowsky.github.io/tonejs-instruments/samples/saxophone/',
    urls: { 'D#5': 'Ds5.mp3', 'E3': 'E3.mp3', 'E4': 'E4.mp3', 'E5': 'E5.mp3', 'F3': 'F3.mp3', 'F4': 'F4.mp3', 'F5': 'F5.mp3', 'F#3': 'Fs3.mp3', 'F#4': 'Fs4.mp3', 'F#5': 'Fs5.mp3', 'G3': 'G3.mp3', 'G4': 'G4.mp3', 'G5': 'G5.mp3', 'G#3': 'Gs3.mp3', 'G#4': 'Gs4.mp3', 'G#5': 'Gs5.mp3', 'A4': 'A4.mp3', 'A5': 'A5.mp3', 'A#3': 'As3.mp3', 'A#4': 'As4.mp3', 'B3': 'B3.mp3', 'B4': 'B4.mp3', 'C4': 'C4.mp3', 'C5': 'C5.mp3', 'C#3': 'Cs3.mp3', 'C#4': 'Cs4.mp3', 'C#5': 'Cs5.mp3', 'D3': 'D3.mp3', 'D4': 'D4.mp3', 'D5': 'D5.mp3', 'D#3': 'Ds3.mp3', 'D#4': 'Ds4.mp3' },
    license: 'CC-BY 3.0', attribution: 'nbrosowsky/tonejs-instruments',
    source: 'https://github.com/nbrosowsky/tonejs-instruments',
  },
  trombone: {
    id: 'trombone', label: 'Trombone',
    baseUrl: 'https://nbrosowsky.github.io/tonejs-instruments/samples/trombone/',
    urls: { 'A#3': 'As3.mp3', 'C3': 'C3.mp3', 'C4': 'C4.mp3', 'C#2': 'Cs2.mp3', 'C#4': 'Cs4.mp3', 'D3': 'D3.mp3', 'D4': 'D4.mp3', 'D#2': 'Ds2.mp3', 'D#3': 'Ds3.mp3', 'D#4': 'Ds4.mp3', 'F2': 'F2.mp3', 'F3': 'F3.mp3', 'F4': 'F4.mp3', 'G#2': 'Gs2.mp3', 'G#3': 'Gs3.mp3', 'A#1': 'As1.mp3', 'A#2': 'As2.mp3' },
    license: 'CC-BY 3.0', attribution: 'nbrosowsky/tonejs-instruments',
    source: 'https://github.com/nbrosowsky/tonejs-instruments',
  },
  trumpet: {
    id: 'trumpet', label: 'Trumpet',
    baseUrl: 'https://nbrosowsky.github.io/tonejs-instruments/samples/trumpet/',
    urls: { 'C6': 'C6.mp3', 'D5': 'D5.mp3', 'D#4': 'Ds4.mp3', 'F3': 'F3.mp3', 'F4': 'F4.mp3', 'F5': 'F5.mp3', 'G4': 'G4.mp3', 'A3': 'A3.mp3', 'A5': 'A5.mp3', 'A#4': 'As4.mp3', 'C4': 'C4.mp3' },
    license: 'CC-BY 3.0', attribution: 'nbrosowsky/tonejs-instruments',
    source: 'https://github.com/nbrosowsky/tonejs-instruments',
  },
  tuba: {
    id: 'tuba', label: 'Tuba',
    baseUrl: 'https://nbrosowsky.github.io/tonejs-instruments/samples/tuba/',
    urls: { 'A#2': 'As2.mp3', 'A#3': 'As3.mp3', 'D3': 'D3.mp3', 'D4': 'D4.mp3', 'D#2': 'Ds2.mp3', 'F1': 'F1.mp3', 'F2': 'F2.mp3', 'F3': 'F3.mp3', 'A#1': 'As1.mp3' },
    license: 'CC-BY 3.0', attribution: 'nbrosowsky/tonejs-instruments',
    source: 'https://github.com/nbrosowsky/tonejs-instruments',
  },
  violin: {
    id: 'violin', label: 'Violin',
    baseUrl: 'https://nbrosowsky.github.io/tonejs-instruments/samples/violin/',
    urls: { 'A3': 'A3.mp3', 'A4': 'A4.mp3', 'A5': 'A5.mp3', 'A6': 'A6.mp3', 'C4': 'C4.mp3', 'C5': 'C5.mp3', 'C6': 'C6.mp3', 'C7': 'C7.mp3', 'E4': 'E4.mp3', 'E5': 'E5.mp3', 'E6': 'E6.mp3', 'G4': 'G4.mp3', 'G5': 'G5.mp3', 'G6': 'G6.mp3' },
    license: 'CC-BY 3.0', attribution: 'nbrosowsky/tonejs-instruments',
    source: 'https://github.com/nbrosowsky/tonejs-instruments',
  },
  xylophone: {
    id: 'xylophone', label: 'Xylophone',
    baseUrl: 'https://nbrosowsky.github.io/tonejs-instruments/samples/xylophone/',
    urls: { 'C8': 'C8.mp3', 'G4': 'G4.mp3', 'G5': 'G5.mp3', 'G6': 'G6.mp3', 'G7': 'G7.mp3', 'C5': 'C5.mp3', 'C6': 'C6.mp3', 'C7': 'C7.mp3' },
    license: 'CC-BY 3.0', attribution: 'nbrosowsky/tonejs-instruments',
    source: 'https://github.com/nbrosowsky/tonejs-instruments',
  },
}

export const SAMPLER_PRESET_LIST = Object.values(SAMPLER_PRESETS)
  .map(p => ({ id: p.id, label: p.label }))

// 'Drums' synth type: each track is a single one-shot drum voice (one sample),
// always triggered at its native pitch (DRUM_TRIGGER_NOTE) so it never transposes
// with the route's melody. Placeholder samples are CC0 (see public/samples/drums).
export const DRUM_BASE_URL = '/samples/drums/cc-kit/'
export const DRUM_TRIGGER_NOTE = 'C4'
export const DRUM_VOICES = [
  { id: 'kick',    label: 'Kick',       file: 'kick.wav' },
  { id: 'snare',   label: 'Snare',      file: 'snare.wav' },
  { id: 'hihat',   label: 'Closed Hat', file: 'hihat.wav' },
  { id: 'openhat', label: 'Open Hat',   file: 'openhat.wav' },
  { id: 'crash',   label: 'Crash',      file: 'crash.wav' },
  { id: 'tom-lo',  label: 'Low Tom',    file: 'tom-lo.wav' },
  { id: 'tom-mid', label: 'Mid Tom',    file: 'tom-mid.wav' },
  { id: 'tom-hi',  label: 'Hi Tom',     file: 'tom-hi.wav' },
]
export const DRUM_VOICE_LICENSE = {
  license: 'CC0', attribution: 'Michael Fischer TR-808 set (placeholder)',
  source: 'https://github.com/tidalcycles/sounds-tr808-fischer',
}

// Per-track granular layer (lib/granularVoice.js): a GrainPlayer fed by an
// offline render of the track's own instrument, layered on top of the dry
// notes. Config lives in engine._granulars (routeId → cfg), toggled like the
// arpeggiator. attack/release shape the per-note grain burst gate.
export const DEFAULT_GRANULAR = {
  enabled: false, mix: 0.5,
  grainSize: 0.09, overlap: 0.05, playbackRate: 1,
  loopStart: 0, loopEnd: 1, reverse: false, jitter: 0,
  attack: 0.05, release: 0.8,
}

// The note the grain source is rendered at — also the GranularVoice baseNote
// that anchors its detune pitch mapping (= DRUM_TRIGGER_NOTE, so drum sources
// granulate at native pitch when the melody hits C4).
const GRANULAR_RENDER_NOTE    = 'C4'
const GRANULAR_RENDER_SECONDS = 2

// url → decoded AudioBuffer cache for granular render sources (Sampler/Drums).
const _granularSampleCache = new Map()

// One sample is enough — Tone.Sampler repitches from the nearest zone, so pick
// the preset note closest to the render note.
async function fetchGranularRenderSample(synthType, params) {
  let url
  if (synthType === 'Drums') {
    const voice = DRUM_VOICES.find(v => v.id === params.drumVoice) ?? DRUM_VOICES[0]
    url = DRUM_BASE_URL + voice.file
  } else {
    const preset = SAMPLER_PRESETS[params.samplerPreset] ?? SAMPLER_PRESETS.piano
    const target = noteToMidi(GRANULAR_RENDER_NOTE)
    const note = Object.keys(preset.urls).reduce((best, n) =>
      Math.abs(noteToMidi(n) - target) < Math.abs(noteToMidi(best) - target) ? n : best)
    url = preset.baseUrl + preset.urls[note]
  }
  if (!_granularSampleCache.has(url)) {
    const buf = await Tone.ToneAudioBuffer.fromUrl(url)
    _granularSampleCache.set(url, buf.get())
  }
  return _granularSampleCache.get(url)
}

// Automation targets for the granular layer (only offered while it's enabled).
export const GRAIN_PARAM_TARGETS = [
  { id: 'grain.mix',          label: 'Grain Mix',  group: 'Granular', min: 0,    max: 1 },
  { id: 'grain.grainSize',    label: 'Grain Size', group: 'Granular', min: 0.01, max: 0.5 },
  { id: 'grain.overlap',      label: 'Overlap',    group: 'Granular', min: 0.01, max: 0.5 },
  { id: 'grain.playbackRate', label: 'Rate',       group: 'Granular', min: 0.25, max: 4 },
  { id: 'grain.loopStart',    label: 'Loop Start', group: 'Granular', min: 0,    max: 1 },
  { id: 'grain.loopEnd',      label: 'Loop End',   group: 'Granular', min: 0,    max: 1 },
  { id: 'grain.jitter',       label: 'Jitter',     group: 'Granular', min: 0,    max: 1 },
]

export const SYNTH_DEFAULTS = {
  Synth: {
    oscillatorType: 'triangle', phase: 0, detune: 0,
    attack: 0.005, attackCurve: 'exponential',
    decay: 0.1,   decayCurve: 'exponential',
    sustain: 0.3,
    release: 1.0, releaseCurve: 'exponential',
  },
  FMSynth: {
    oscillatorType: 'sine', phase: 0, detune: 0,
    attack: 0.4, attackCurve: 'exponential',
    decay: 0.1,  decayCurve: 'exponential',
    sustain: 1.0,
    release: 1.4, releaseCurve: 'exponential',
    modulationOscType: 'sine',
    modAttack: 0.5, modDecay: 0.1, modSustain: 1.0, modRelease: 1.4,
    harmonicity: 3, modulationIndex: 4,
  },
  AMSynth: {
    oscillatorType: 'sine', phase: 0, detune: 0,
    attack: 0.1, attackCurve: 'exponential',
    decay: 0.2,  decayCurve: 'exponential',
    sustain: 0.5,
    release: 0.8, releaseCurve: 'exponential',
    modulationOscType: 'square',
    modAttack: 0.5, modDecay: 0.0, modSustain: 1.0, modRelease: 0.5,
    harmonicity: 3,
  },
  MonoSynth: {
    oscillatorType: 'sawtooth', phase: 0, detune: 0,
    attack: 0.005, attackCurve: 'exponential',
    decay: 0.3,   decayCurve: 'exponential',
    sustain: 0.5,
    release: 0.8,  releaseCurve: 'exponential',
    filterFrequency: 800, filterType: 'lowpass', filterRolloff: -12, filterQ: 1,
    filterEnvAttack: 0.001, filterEnvDecay: 0.3, filterEnvSustain: 0.3, filterEnvRelease: 0.8,
    filterEnvBaseFreq: 200, filterEnvOctaves: 3, filterEnvExponent: 2,
  },
  MembraneSynth: {
    pitchDecay: 0.05, membOctaves: 10,
    attack: 0.001, attackCurve: 'exponential',
    decay: 0.4,   decayCurve: 'exponential',
    sustain: 0.0,
    release: 0.1, releaseCurve: 'exponential',
  },
  MetalSynth: {
    metalHarmonicity: 5.1, metalModIndex: 32, metalOctaves: 1.5, resonance: 4000,
    attack: 0.001, attackCurve: 'exponential',
    decay: 0.4,   decayCurve: 'exponential',
    sustain: 0.0,
    release: 0.3, releaseCurve: 'exponential',
  },
  NoiseSynth: {
    noiseType: 'white',
    attack: 0.005, attackCurve: 'exponential',
    decay: 0.1,   decayCurve: 'exponential',
    sustain: 0.0,
    release: 0.1, releaseCurve: 'exponential',
  },
  PluckSynth: { attackNoise: 1, dampening: 4000, resonance: 0.7 },
  // Polyphonic voice — used by "merged" chord lanes (Tone.PolySynth wraps a
  // monophonic voice). `voice` picks the wrapped constructor; the rest is the
  // shared Synth-shaped envelope/oscillator applied to every voice.
  PolySynth: {
    voice: 'Synth',
    oscillatorType: 'triangle', phase: 0, detune: 0,
    attack: 0.02, attackCurve: 'exponential',
    decay: 0.2,   decayCurve: 'exponential',
    sustain: 0.4,
    release: 1.2, releaseCurve: 'exponential',
  },
  DuoSynth: {
    voice0OscType: 'sawtooth', detune: 0,
    attack: 0.1, attackCurve: 'exponential',
    decay: 0.2,  decayCurve: 'exponential',
    sustain: 0.5,
    release: 0.8, releaseCurve: 'exponential',
    duoHarmonicity: 1.5, vibratoRate: 5, vibratoAmount: 0.5,
  },
  Sampler: { samplerPreset: 'piano', attack: 0.01, release: 1.0 },
  Drums:   { drumVoice: 'kick', attack: 0.001, release: 0.6 },
}

function buildSynthOpts(synthType, params = {}, volume) {
  const p = { ...(SYNTH_DEFAULTS[synthType] ?? SYNTH_DEFAULTS.Synth), ...params }
  const vol = volume !== undefined ? { volume } : {}
  const env = {
    attack: p.attack, attackCurve: p.attackCurve ?? 'exponential',
    decay: p.decay,   decayCurve:  p.decayCurve  ?? 'exponential',
    sustain: p.sustain,
    release: p.release, releaseCurve: p.releaseCurve ?? 'exponential',
  }
  const osc = { type: p.oscillatorType, phase: p.phase ?? 0 }
  switch (synthType) {
    case 'FMSynth': return {
      ...vol, detune: p.detune ?? 0,
      oscillator: osc, envelope: env,
      modulation: { type: p.modulationOscType },
      modulationEnvelope: { attack: p.modAttack, decay: p.modDecay, sustain: p.modSustain, release: p.modRelease },
      harmonicity: p.harmonicity, modulationIndex: p.modulationIndex,
    }
    case 'AMSynth': return {
      ...vol, detune: p.detune ?? 0,
      oscillator: osc, envelope: env,
      modulation: { type: p.modulationOscType },
      modulationEnvelope: { attack: p.modAttack, decay: p.modDecay, sustain: p.modSustain, release: p.modRelease },
      harmonicity: p.harmonicity,
    }
    case 'MonoSynth': return {
      ...vol, detune: p.detune ?? 0,
      oscillator: osc, envelope: env,
      filter: { frequency: p.filterFrequency, type: p.filterType, rolloff: p.filterRolloff, Q: p.filterQ },
      filterEnvelope: {
        attack: p.filterEnvAttack, decay: p.filterEnvDecay,
        sustain: p.filterEnvSustain, release: p.filterEnvRelease,
        baseFrequency: p.filterEnvBaseFreq, octaves: p.filterEnvOctaves, exponent: p.filterEnvExponent,
      },
    }
    case 'MembraneSynth': return { ...vol, pitchDecay: p.pitchDecay, octaves: p.membOctaves, envelope: env }
    case 'MetalSynth': return {
      ...vol,
      harmonicity: p.metalHarmonicity, modulationIndex: p.metalModIndex,
      octaves: p.metalOctaves, resonance: p.resonance, envelope: env,
    }
    case 'Sampler': {
      const preset = SAMPLER_PRESETS[p.samplerPreset] ?? SAMPLER_PRESETS.piano
      return {
        ...vol, urls: preset.urls, baseUrl: preset.baseUrl,
        attack: p.attack ?? 0.01, release: p.release ?? 1.0,
      }
    }
    case 'Drums': {
      const voice = DRUM_VOICES.find(v => v.id === p.drumVoice) ?? DRUM_VOICES[0]
      return {
        ...vol, urls: { [DRUM_TRIGGER_NOTE]: voice.file }, baseUrl: DRUM_BASE_URL,
        attack: p.attack ?? 0.001, release: p.release ?? 0.6,
      }
    }
    // PolySynth's constructor takes (voice, voiceOptions); return the wrapped
    // voice's options so it can be applied to every voice (see _makeSynth).
    case 'PolySynth': return buildSynthOpts(p.voice ?? 'Synth', params, volume)
    case 'NoiseSynth': return { ...vol, noise: { type: p.noiseType }, envelope: env }
    case 'PluckSynth': return { ...vol, attackNoise: p.attackNoise, dampening: p.dampening, resonance: p.resonance }
    case 'DuoSynth': return {
      ...vol, detune: p.detune ?? 0,
      harmonicity: p.duoHarmonicity, vibratoRate: p.vibratoRate, vibratoAmount: p.vibratoAmount,
      voice0: { oscillator: { type: p.voice0OscType }, envelope: env },
      voice1: { oscillator: { type: p.voice0OscType }, envelope: env },
    }
    default: return { ...vol, detune: p.detune ?? 0, oscillator: osc, envelope: env }
  }
}

// Per-synth-type automation targets with min/max ranges for 0–1 → actual-value mapping.
// 'common' applies to all synths that have a standard envelope (everything except PluckSynth).
export const SYNTH_PARAM_TARGETS = {
  common: [
    { id: 'synth.attack',   label: 'Attack',   group: 'Amp Env', min: 0.001, max: 4 },
    { id: 'synth.decay',    label: 'Decay',    group: 'Amp Env', min: 0.01,  max: 2 },
    { id: 'synth.sustain',  label: 'Sustain',  group: 'Amp Env', min: 0,     max: 1 },
    { id: 'synth.release',  label: 'Release',  group: 'Amp Env', min: 0.01,  max: 4 },
    { id: 'synth.detune',   label: 'Detune',   group: 'Osc',     min: -100,  max: 100 },
  ],
  Synth: [],
  FMSynth: [
    { id: 'synth.harmonicity',     label: 'Harmonicity', group: 'FM',     min: 0,     max: 20 },
    { id: 'synth.modulationIndex', label: 'Mod Index',   group: 'FM',     min: 0,     max: 100 },
    { id: 'synth.modAttack',       label: 'Mod Attack',  group: 'FM Env', min: 0.001, max: 4 },
    { id: 'synth.modDecay',        label: 'Mod Decay',   group: 'FM Env', min: 0.01,  max: 2 },
    { id: 'synth.modSustain',      label: 'Mod Sustain', group: 'FM Env', min: 0,     max: 1 },
    { id: 'synth.modRelease',      label: 'Mod Release', group: 'FM Env', min: 0.01,  max: 4 },
  ],
  AMSynth: [
    { id: 'synth.harmonicity',  label: 'Harmonicity', group: 'AM',     min: 0,     max: 20 },
    { id: 'synth.modAttack',    label: 'Mod Attack',  group: 'AM Env', min: 0.001, max: 4 },
    { id: 'synth.modDecay',     label: 'Mod Decay',   group: 'AM Env', min: 0.01,  max: 2 },
    { id: 'synth.modSustain',   label: 'Mod Sustain', group: 'AM Env', min: 0,     max: 1 },
    { id: 'synth.modRelease',   label: 'Mod Release', group: 'AM Env', min: 0.01,  max: 4 },
  ],
  MonoSynth: [
    { id: 'synth.filterFrequency',  label: 'Filter Freq', group: 'Filter',     min: 20,    max: 20000, curve: 'exp' },
    { id: 'synth.filterQ',          label: 'Filter Q',    group: 'Filter',     min: 0.1,   max: 20 },
    { id: 'synth.filterEnvAttack',  label: 'Flt Atk',     group: 'Filter Env', min: 0.001, max: 4 },
    { id: 'synth.filterEnvDecay',   label: 'Flt Dcy',     group: 'Filter Env', min: 0.01,  max: 2 },
    { id: 'synth.filterEnvSustain', label: 'Flt Sus',     group: 'Filter Env', min: 0,     max: 1 },
    { id: 'synth.filterEnvRelease', label: 'Flt Rel',     group: 'Filter Env', min: 0.01,  max: 4 },
    { id: 'synth.filterEnvOctaves', label: 'Flt Oct',     group: 'Filter Env', min: 0,     max: 8 },
  ],
  MembraneSynth: [
    { id: 'synth.pitchDecay',  label: 'Pitch Decay', group: 'Membrane', min: 0.001, max: 0.5 },
    { id: 'synth.membOctaves', label: 'Pitch Oct',   group: 'Membrane', min: 0,     max: 20 },
  ],
  MetalSynth: [
    { id: 'synth.metalHarmonicity', label: 'Harmonicity', group: 'Metal', min: 0,  max: 30 },
    { id: 'synth.metalModIndex',    label: 'Mod Index',   group: 'Metal', min: 0,  max: 100 },
    { id: 'synth.resonance',        label: 'Resonance',   group: 'Metal', min: 20, max: 20000, curve: 'exp' },
    { id: 'synth.metalOctaves',     label: 'Octaves',     group: 'Metal', min: 0,  max: 8 },
  ],
  NoiseSynth: [],
  PluckSynth: [
    { id: 'synth.attackNoise', label: 'Attack Noise', group: 'Pluck', min: 0, max: 20 },
    { id: 'synth.dampening',   label: 'Dampening',    group: 'Pluck', min: 0, max: 7000 },
    { id: 'synth.resonance',   label: 'Resonance',    group: 'Pluck', min: 0, max: 0.99 },
  ],
  DuoSynth: [
    { id: 'synth.duoHarmonicity', label: 'Harmonicity',  group: 'Duo', min: 0, max: 6 },
    { id: 'synth.vibratoRate',    label: 'Vibrato Rate', group: 'Duo', min: 0, max: 20 },
    { id: 'synth.vibratoAmount',  label: 'Vibrato Amt',  group: 'Duo', min: 0, max: 1 },
  ],
  Sampler: [],
  Drums:   [],   // sample-backed one-shot: no modulatable synth params
}

// Sample-backed voices (Tone.Sampler) keep attack/release as top-level props and have
// no standard amp envelope, so the global adsr.*/glide/synth.* targets don't apply.
const SAMPLE_BACKED   = new Set(['Sampler', 'Drums'])
// Voices with no standard ADSR envelope at all (also can't take the common synth.* env).
const NO_STANDARD_ENV = new Set(['PluckSynth', 'Sampler', 'Drums'])

// The set of automation destinations valid for a given synth type, given which FX
// buses are currently active. Single source of truth for the lane dropdown (DawView)
// and the reset-on-synth-change validation (MixerTab). Returns a flat array of specs;
// callers group by `.group` for display.
export function availableAutomationTargets(synthType, activeFxTracks = [], granularEnabled = false) {
  const base = AUTOMATION_TARGETS.filter(t => {
    if (t.id.startsWith('send.')) return activeFxTracks.includes(t.id.slice(5))
    if (t.id.startsWith('adsr.')) return !NO_STANDARD_ENV.has(synthType)
    if (t.id === 'glide')         return !SAMPLE_BACKED.has(synthType)
    return true
  })
  const commonParams = NO_STANDARD_ENV.has(synthType) ? [] : (SYNTH_PARAM_TARGETS.common ?? [])
  const typeParams   = SYNTH_PARAM_TARGETS[synthType] ?? []
  const grainParams  = granularEnabled ? GRAIN_PARAM_TARGETS : []
  return [...base, ...commonParams, ...typeParams, ...grainParams]
}

// Look up an automation destination's spec ({min, max, unit, ...}) by id.
// Searches AUTOMATION_TARGETS (track-level: sends, volume, pan, glide, adsr.*)
// then SYNTH_PARAM_TARGETS (per-synth-type: synth.*).
export function findTargetSpec(paramTarget, synthType) {
  const t = AUTOMATION_TARGETS.find(t => t.id === paramTarget)
  if (t) return t
  const all = [
    ...(SYNTH_PARAM_TARGETS.common ?? []),
    ...(SYNTH_PARAM_TARGETS[synthType] ?? []),
    ...GRAIN_PARAM_TARGETS,
  ]
  return all.find(s => s.id === paramTarget) ?? null
}

// Apply a single flat param key directly to a live synth without disturbing other params.
function applySynthParam(synth, synthType, paramKey, value) {
  try {
    const isSampler = synthType === 'Sampler'
    switch (paramKey) {
      case 'attack':              synth.set(isSampler ? { attack: value }  : { envelope: { attack: value } }); break
      case 'decay':               if (!isSampler) synth.set({ envelope: { decay: value } }); break
      case 'sustain':             if (!isSampler) synth.set({ envelope: { sustain: value } }); break
      case 'release':             synth.set(isSampler ? { release: value } : { envelope: { release: value } }); break
      case 'detune':              synth.set({ detune: value }); break
      case 'harmonicity':         synth.set({ harmonicity: value }); break
      case 'modulationIndex':     synth.set({ modulationIndex: value }); break
      case 'modAttack':           synth.set({ modulationEnvelope: { attack: value } }); break
      case 'modDecay':            synth.set({ modulationEnvelope: { decay: value } }); break
      case 'modSustain':          synth.set({ modulationEnvelope: { sustain: value } }); break
      case 'modRelease':          synth.set({ modulationEnvelope: { release: value } }); break
      case 'filterFrequency':     synth.set({ filter: { frequency: value } }); break
      case 'filterQ':             synth.set({ filter: { Q: value } }); break
      case 'filterEnvAttack':     synth.set({ filterEnvelope: { attack: value } }); break
      case 'filterEnvDecay':      synth.set({ filterEnvelope: { decay: value } }); break
      case 'filterEnvSustain':    synth.set({ filterEnvelope: { sustain: value } }); break
      case 'filterEnvRelease':    synth.set({ filterEnvelope: { release: value } }); break
      case 'filterEnvOctaves':    synth.set({ filterEnvelope: { octaves: value } }); break
      case 'pitchDecay':          synth.set({ pitchDecay: value }); break
      case 'membOctaves':         synth.set({ octaves: value }); break
      case 'metalHarmonicity':    synth.set({ harmonicity: value }); break
      case 'metalModIndex':       synth.set({ modulationIndex: value }); break
      case 'metalOctaves':        synth.set({ octaves: value }); break
      case 'resonance':
        if (synthType === 'PluckSynth') {
          if (synth.resonance && 'value' in synth.resonance) synth.resonance.value = value
        } else { synth.set({ resonance: value }) }
        break
      case 'attackNoise':         synth.set({ attackNoise: value }); break
      case 'dampening':           synth.set({ dampening: value }); break
      case 'duoHarmonicity':      synth.set({ harmonicity: value }); break
      case 'vibratoRate':         synth.set({ vibratoRate: value }); break
      case 'vibratoAmount':       synth.set({ vibratoAmount: value }); break
    }
  } catch {}
}

const NO_HARMONY = new Set(['MembraneSynth', 'MetalSynth', 'NoiseSynth', 'PluckSynth', 'Sampler'])

// Voices a Tone.PolySynth can wrap (merged chord lanes). Keep in sync with the
// `voice` values allowed in SYNTH_DEFAULTS.PolySynth.
const POLY_VOICE_CTORS = { Synth: Tone.Synth, FMSynth: Tone.FMSynth, AMSynth: Tone.AMSynth }

export class TransitEngine {
  constructor(onEvent) {
    this.onEvent   = onEvent
    this._started  = false

    this._volumes = {}
    this._muted   = {}

    this._alertLayer = null
    this._netState   = null

    this._voices = new Map()
    this._fleet  = new Map()

    this._soundModes = new Map()
    this._mockSynths = new Map()   // routeId → { synth, routeGain, harmonySynth, ... }
    this._soloRoutes = new Set()

    // All instrument sends: 'instId:fxBusId' → level (persists across start/stop)
    this._pendingSends = {}
    // Active send Gain nodes (recreated on each start)
    this._sendGains = {}

    // Static FX buses (recreated on each start, disposed on stop)
    this._fxTracks = {}

    // Per-bus parameter overrides (persist across start/stop). 'busId' → { paramId: value }
    this._fxBusParams = {}

    // Per-route octave shifts: routeId → integer offset (-2..+2)
    this._octaveShifts = {}

    // Per-stop diatonic pitch offsets for duplicate lanes: routeId → { stopId: degrees }.
    // Applied in _buildRoutePart to re-pitch a copied lane while staying in key.
    this._pitchOffsets = {}

    // Per-route portamento glide time (seconds). routeId → number
    this._glides = {}

    // Per-route legato mode: routeId → boolean
    this._legatoRoutes = {}

    // Per-route arpeggiator config: routeId → { enabled, style, rate, gate, octaves, steps, distance }
    this._arpeggiators = {}

    // Per-route granular layer config (DEFAULT_GRANULAR shape). Persists across
    // start/stop; the GranularVoice itself lives on the route entry.
    this._granulars = {}

    // Optional session recorder for MIDI export (lib/midiExport.js)
    this._midiRecorder     = null
    this._sessionStartTime = 0

    // Per-route mixer settings (persist across start/stop)
    this._routeVolumesDb = {}   // routeId → dB (-Infinity..+6)
    this._routePans      = {}   // routeId → -1..1
    this._routeDisabled  = {}   // routeId → boolean

    // Per-route insert FX (persist across start/stop)
    this._routeFilters = {}     // routeId → { type, frequency, Q }
    this._routeEqs     = {}     // routeId → { low, mid, high, lowFrequency, highFrequency }

    // FX bus mute/solo state (persists across start/stop)
    this._fxMutedIds = new Set()
    this._fxSoloIds  = new Set()

    // Automation lanes: 'routeId:laneId' → AutomationTrack (persists across start/stop)
    this._automationLanes    = {}
    this._automationLaneCfgs = {}   // same key → mutable cfg object (callback reads from it)
    this._automationParts    = {}   // same key → per-lane mock Tone.Part (own speed)

    // Set of routeIds currently used as automation data sources (no synth, no notes)
    this._automationSources = new Set()

    // Drone mode per route: routeId → { enabled, rootNote }
    this._droneRoutes = {}

    // Per-route speed multiplier: routeId → number (default 1)
    this._trackSpeeds = {}

    // Per-route loop section: routeId → { startCell, endCell } within 0..GRID_TOTAL_CELLS
    this._trackLoopRegions = {}

    // Per-route note-grid resolution: routeId → rate string (e.g. '16n', '8t'); see
    // GRID_RESOLUTION_STEPS_PER_BAR in mappings.js. Defaults to DEFAULT_GRID_RESOLUTION.
    this._gridResolutions = {}

    // Cached soundModes from last startMock — read by _buildRoutePart for noteDur
    this._cachedSoundModes = {}

    // Optional drum backing imported from the Drum Machine tab: a plain pattern
    // ({ patterns, offsets, muted, bpm }) plus a lazily-built DrumSequencer that
    // rides the mock Transport (see startMock/stopMock). null = no drums.
    this._drumPattern = null
    this._drumSeq     = null

    // Active Tone.Part instances per route (created in startMock)
    this._routeParts = {}

    // Merged (PolySynth chord) lanes: mergedRouteId → { sourceIds: [...] }. A merged
    // lane has no geography of its own — its Part stacks the notes its source lanes
    // would play at each grid cell into chords (see _buildMergedRoutePart).
    this._merges = {}
    // Union of every merge's sourceIds. These lanes keep their Parts (so a merge
    // toggles cleanly) but are gated silent at trigger time — only the merged lane
    // is heard. Rebuilt by setMerge.
    this._mergeConsumed = new Set()

    // Cached routes for static-curve rebuilds
    this._routes = null

    this._netUpdateTimer = null
  }

  init() {
    this._alertLayer = new AlertLayer()
    this._panners = {}

    for (const type of LINE_TYPES) {
      const vol    = new Tone.Volume(0)
      const panner = new Tone.Panner(0)
      panner.connect(vol)
      vol.connect(this._alertLayer.input)
      this._volumes[type] = vol
      this._panners[type] = panner
      this._muted[type]   = false
    }

    this._netState = new NetworkState(this._alertLayer.input)
  }

  // Override the network hub interchanges (for cities other than Budapest).
  setNetworkHubs(hubs) {
    this._netState?.setHubs(hubs)
  }

  computeNote(lat, lng, octaveShift = 0, bounds = null) {
    const scale = this._alertLayer?.currentModeScale ?? MODES.dorian
    const root  = (this._netState?.rootMidi ?? 62) + octaveShift * 12
    return midiToNote(geoToMidi(lat, lng, root, scale, 3, bounds))
  }

  setOctaveShift(routeId, shift) {
    this._octaveShifts[routeId] = shift
  }

  // Per-stop diatonic pitch offsets for a (duplicate) lane: { stopId: degrees }.
  // The pitch map is re-derived when the Part is built, so rebuild any running Part.
  setPitchOffsets(routeId, map) {
    this._pitchOffsets[routeId] = map ?? {}
    if (this._routeParts[routeId]) this._rebuildRoutePart(routeId)
  }

  // Hot-add a duplicate lane: create its synth entry and, if mock playback is
  // running, build its Part so it sounds immediately. If added while stopped, the
  // next startMock builds it from the merged route list.
  addRoute(route, soundMode = { mode: 'harmonic', scale: { root: 'C', scaleType: 'major' } }, synthType = 'Synth', envelope = null) {
    if (!route?.stops?.length || this._mockSynths.has(route.id)) return
    // Stopped: do nothing — the next startMock builds this lane from the merged
    // route list + the per-route config maps. Only materialize while playing.
    if (Tone.Transport.state !== 'started') return
    if (this._routes && !this._routes.find(r => r.id === route.id)) this._routes.push(route)
    this._cachedSoundModes = { ...this._cachedSoundModes, [route.id]: soundMode }
    this._createSingleRouteEntry(route.id, route.type, synthType, envelope, soundMode.scale ?? { root: 'C', scaleType: 'major' })
    if (!this._routeParts[route.id]) {
      const part = this._buildPartForRoute(route)
      if (part) this._routeParts[route.id] = part
    }
  }

  // Register (or clear) a merged chord lane. sourceIds is the list of base route
  // ids whose notes are stacked into this lane's PolySynth. Pass a falsy/empty
  // list to un-register. Rebuilds the running Part if playing.
  setMerge(mergedRouteId, sourceIds) {
    if (sourceIds?.length) this._merges[mergedRouteId] = { sourceIds: [...sourceIds] }
    else delete this._merges[mergedRouteId]
    // Recompute the consumed set so source lanes are gated silent (they keep their
    // Parts alive so un-merging resumes them without a rebuild).
    this._mergeConsumed = new Set()
    for (const { sourceIds: ids } of Object.values(this._merges))
      for (const id of ids) this._mergeConsumed.add(id)
    if (this._routeParts[mergedRouteId]) this._rebuildRoutePart(mergedRouteId)
  }

  // Remove a duplicate lane: dispose its Part + synth entry and drop its per-route state.
  removeRoute(routeId) {
    this._routeParts[routeId]?.dispose()
    delete this._routeParts[routeId]
    const entry = this._mockSynths.get(routeId)
    if (entry) { this._disposeRouteEntry(entry); this._mockSynths.delete(routeId) }
    for (const key of Object.keys(this._sendGains)) {
      if (key.startsWith(`${routeId}:`)) { this._sendGains[key]?.dispose(); delete this._sendGains[key] }
    }
    for (const m of [this._pitchOffsets, this._octaveShifts, this._glides, this._legatoRoutes,
                     this._arpeggiators, this._granulars, this._routeVolumesDb, this._routePans,
                     this._routeDisabled, this._routeFilters, this._routeEqs, this._droneRoutes,
                     this._trackSpeeds, this._trackLoopRegions, this._gridResolutions, this._cachedSoundModes,
                     this._merges]) {
      delete m[routeId]
    }
    if (this._routes) this._routes = this._routes.filter(r => r.id !== routeId)
  }

  // ── Per-route mixer ───────────────────────────────────────────────────────

  setRouteVolume(routeId, db) {
    this._routeVolumesDb[routeId] = db
    this._applyRouteGain(routeId)
  }

  setRouteDisabled(routeId, disabled) {
    this._routeDisabled[routeId] = disabled
    this._applyRouteGain(routeId)
  }

  setRoutePan(routeId, value) {
    this._routePans[routeId] = value
    const entry = this._mockSynths.get(routeId)
    entry?.routePanner?.pan.rampTo(value, 0.05)
  }

  _applyRouteGain(routeId) {
    const entry = this._mockSynths.get(routeId)
    if (!entry?.routeGain) return
    const disabled = this._routeDisabled[routeId]
    const db       = this._routeVolumesDb[routeId] ?? 0
    const gain     = disabled ? 0 : Math.pow(10, db / 20)
    entry.routeGain.gain.rampTo(gain, 0.05)
  }

  setRouteFilter(routeId, params) {
    this._routeFilters[routeId] = { ...(this._routeFilters[routeId] ?? {}), ...params }
    const entry = this._mockSynths.get(routeId)
    if (!entry?.filter) return
    if (params.type      != null) entry.filter.type = params.type
    if (params.frequency != null) entry.filter.frequency.rampTo(params.frequency, 0.05)
    if (params.Q         != null) entry.filter.Q.rampTo(params.Q, 0.05)
  }

  setRouteEq(routeId, params) {
    this._routeEqs[routeId] = { ...(this._routeEqs[routeId] ?? {}), ...params }
    const entry = this._mockSynths.get(routeId)
    if (!entry?.eq) return
    if (params.low           != null) entry.eq.low.rampTo(params.low, 0.05)
    if (params.mid           != null) entry.eq.mid.rampTo(params.mid, 0.05)
    if (params.high          != null) entry.eq.high.rampTo(params.high, 0.05)
    if (params.lowFrequency  != null) entry.eq.lowFrequency.rampTo(params.lowFrequency, 0.05)
    if (params.highFrequency != null) entry.eq.highFrequency.rampTo(params.highFrequency, 0.05)
  }

  setGlide(routeId, seconds) {
    this._glides[routeId] = seconds
    const entry = this._mockSynths.get(routeId)
    if (entry?.synth && 'portamento' in entry.synth) {
      try { entry.synth.portamento = seconds } catch {}
    }
  }

  setLegato(routeId, enabled) {
    this._legatoRoutes[routeId] = enabled
    if (!enabled) {
      // release any held legato note
      const entry = this._mockSynths.get(routeId)
      if (entry?.synth) {
        try { entry.synth.triggerRelease(Tone.now()) } catch {}
      }
      entry?.granularVoice?.triggerRelease(Tone.now())
    }
  }

  // Merge per-route arpeggiator config. Pure state — read at trigger time, so
  // there's nothing live on the synth to mutate here.
  setArpeggiator(routeId, cfg) {
    this._arpeggiators[routeId] = { ...(this._arpeggiators[routeId] ?? {}), ...cfg }
  }

  // ── Send matrix ───────────────────────────────────────────────────────────────

  setSendLevel(instRouteId, fxBusId, level) {
    const key = `${instRouteId}:${fxBusId}`
    this._pendingSends[key] = level

    const existing = this._sendGains[key]
    if (existing) {
      existing.gain.rampTo(level, 0.05)
      return
    }

    // Wire on the fly when the user adds a send after engine start
    const entry = this._mockSynths.get(instRouteId)
    const fxBus = this._fxTracks[fxBusId]
    if (!entry?.routeGain || !fxBus) return

    const sendGain = new Tone.Gain(level)
    entry.routeGain.connect(sendGain)
    sendGain.connect(fxBus.input)
    this._sendGains[key] = sendGain
  }

  // ── FX bus controls ───────────────────────────────────────────────────────────

  setFxBusWet(busId, value) {
    this._fxBusParams[busId] = { ...(this._fxBusParams[busId] ?? {}), wet: value }
    this._fxTracks[busId]?.setWet(value)
  }

  setFxBusParam(busId, paramId, value) {
    this._fxBusParams[busId] = { ...(this._fxBusParams[busId] ?? {}), [paramId]: value }
    this._fxTracks[busId]?.setParam(paramId, value)
  }

  // Live tempo change. Transport-scheduled parts follow Transport.bpm on their
  // own; synced FX hold note divisions converted once at set time, so re-apply.
  setBpm(bpm) {
    Tone.Transport.bpm.value = bpm
    for (const track of Object.values(this._fxTracks)) track.reapplySync?.()
  }

  setFxBusCustomIR(busId, audioBuffer) {
    return this._fxTracks[busId]?.setCustomIRBuffer(audioBuffer)
  }

  setFxBusMute(busId, isMuted) {
    if (isMuted) this._fxMutedIds.add(busId)
    else         this._fxMutedIds.delete(busId)
    this._applyFxMuteState()
  }

  setFxBusSolo(busId, isSoloed) {
    if (isSoloed) this._fxSoloIds.add(busId)
    else          this._fxSoloIds.delete(busId)
    this._applyFxMuteState()
  }

  _applyFxMuteState() {
    const hasSolo = this._fxSoloIds.size > 0
    for (const [busId, track] of Object.entries(this._fxTracks)) {
      const muted = hasSolo
        ? !this._fxSoloIds.has(busId)
        : this._fxMutedIds.has(busId)
      track.setMute(muted)
    }
  }

  // ── Automation lanes ─────────────────────────────────────────────────────────

  addAutomationLane(routeId, laneId, cfg) {
    const key = `${routeId}:${laneId}`
    if (this._automationLanes[key]) this._automationLanes[key].dispose()

    const laneCfg = {
      sourceRouteId: cfg.sourceRouteId ?? '',
      paramTarget:   cfg.paramTarget   ?? 'volume',
      points:        cfg.points        ?? {},   // { stopId: 0..1 } authored overrides
      speed:         cfg.speed         ?? 1,    // per-lane mock loop-speed multiplier
      glide:         cfg.glide         ?? 0,    // per-lane slew time (s) between points; 0 = snap
      loopRegion:    cfg.loopRegion    ?? null, // per-lane { startCell, endCell }; null = inherit source region
    }
    this._automationLaneCfgs[key] = laneCfg

    const at = new AutomationTrack()
    at.setLaneId(laneId)
    at.setPoints(laneCfg.points)   // by reference: live drags take effect immediately
    // Callback closure reads laneCfg by reference so paramTarget/glide updates take effect immediately
    at.setTarget((value) => this._applyAutomation(routeId, laneCfg.paramTarget, value, laneCfg.glide))

    if (laneCfg.sourceRouteId) {
      const srcRoute = this._routes?.find(r => r.id === laneCfg.sourceRouteId)
      if (srcRoute?.stops) at.buildStaticCurve(srcRoute.stops)
    }

    this._automationLanes[key] = at
    this._rebuildAutomationSources()
    this._rebuildAutomationLanePart(key)
  }

  updateAutomationLane(routeId, laneId, cfg) {
    const key = `${routeId}:${laneId}`
    const at = this._automationLanes[key]
    if (!at) { this.addAutomationLane(routeId, laneId, cfg); return }

    const laneCfg = this._automationLaneCfgs[key] ?? {}
    if (cfg.sourceRouteId !== undefined)   laneCfg.sourceRouteId = cfg.sourceRouteId
    if (cfg.paramTarget   !== undefined && cfg.paramTarget !== laneCfg.paramTarget) {
      // Free the param this lane was modulating so it returns to its manual value
      // instead of staying frozen at the last automated sample.
      this._restoreParamToManual(routeId, laneCfg.paramTarget)
      laneCfg.paramTarget = cfg.paramTarget
    }
    if (cfg.points        !== undefined) { laneCfg.points        = cfg.points; at.setPoints(laneCfg.points) }
    if (cfg.speed         !== undefined)   laneCfg.speed         = cfg.speed
    if (cfg.glide         !== undefined)   laneCfg.glide         = cfg.glide   // live: read by the fire callback, no rebuild
    if (cfg.loopRegion    !== undefined)   laneCfg.loopRegion    = cfg.loopRegion  // per-lane sub-loop; null = inherit source

    if (cfg.sourceRouteId !== undefined) {
      const srcRoute = laneCfg.sourceRouteId ? this._routes?.find(r => r.id === laneCfg.sourceRouteId) : null
      if (srcRoute?.stops) at.buildStaticCurve(srcRoute.stops)
      this._rebuildAutomationSources()
    }
    // Re-time the lane's mock part when its speed, source, or loop region changes.
    if (cfg.speed !== undefined || cfg.sourceRouteId !== undefined || cfg.loopRegion !== undefined) {
      this._rebuildAutomationLanePart(key)
    }
  }

  removeAutomationLane(routeId, laneId) {
    const key = `${routeId}:${laneId}`
    // Return the param this lane controlled to its manual value before tearing down.
    this._restoreParamToManual(routeId, this._automationLaneCfgs[key]?.paramTarget)
    this._automationLanes[key]?.dispose()
    this._automationParts[key]?.dispose()
    delete this._automationLanes[key]
    delete this._automationLaneCfgs[key]
    delete this._automationParts[key]
    this._rebuildAutomationSources()
  }

  _rebuildAutomationSources() {
    this._automationSources = new Set(
      Object.values(this._automationLaneCfgs)
        .map(c => c.sourceRouteId)
        .filter(Boolean)
    )
  }

  // Build a looping mock Tone.Part that fires this lane's source-route stops at the
  // lane's own speed (independent of the source line and global BPM). Mock-only;
  // live mode dispatches via _dispatchFromSourceRoute on real arrivals.
  _buildAutomationLanePart(key) {
    const cfg = this._automationLaneCfgs[key]
    const at  = this._automationLanes[key]
    if (!cfg?.sourceRouteId || !at) return null
    const src = this._routes?.find(r => r.id === cfg.sourceRouteId)
    if (!src?.stops?.length || !src?.totalDist) return null

    const LOOP_BEATS  = 16
    const loopSec     = (LOOP_BEATS / Tone.Transport.bpm.value) * 60
    const speed       = cfg.speed ?? 1
    const region      = cfg.loopRegion ?? this._trackLoopRegions[cfg.sourceRouteId]
    const startCell   = Math.max(0, Math.min(GRID_TOTAL_CELLS - 1, Math.round(region?.startCell ?? 0)))
    const endCell     = Math.max(startCell + 1, Math.min(GRID_TOTAL_CELLS, Math.round(region?.endCell ?? GRID_TOTAL_CELLS)))
    const regionLen   = endCell - startCell
    const partLoopSec = (regionLen / GRID_TOTAL_CELLS) * loopSec / speed
    const regionStartFrac = startCell / GRID_TOTAL_CELLS
    const regionEndFrac   = endCell   / GRID_TOTAL_CELLS

    // Follows the source route's own grid resolution (a lane plays the source's stops).
    const rate          = this._gridResolutions[cfg.sourceRouteId] ?? DEFAULT_GRID_RESOLUTION
    const stepsPerBar   = GRID_RESOLUTION_STEPS_PER_BAR[rate] ?? GRID_STEPS_PER_BAR
    const noteTotalCells = GRID_BARS * stepsPerBar

    const gridStops = snapStopsToGrid(src.stops, src.totalDist, noteTotalCells, stepsPerBar)
      .filter(s => {
        const frac = s.cellIdx / noteTotalCells
        return frac >= regionStartFrac && frac < regionEndFrac
      })

    const part = new Tone.Part((time, stop) => at.onStopEvent(stop.id),
      gridStops.map(stop => [
        ((stop.cellIdx / noteTotalCells - regionStartFrac) / (regionEndFrac - regionStartFrac)) * partLoopSec,
        stop,
      ]))
    part.loop    = true
    part.loopEnd = partLoopSec
    part.start(0)
    return part
  }

  // Dispose + (re)build a lane's part. Only schedules while the transport is running;
  // when stopped, startMock rebuilds every lane part on play.
  _rebuildAutomationLanePart(key) {
    this._automationParts[key]?.dispose()
    delete this._automationParts[key]
    if (Tone.getTransport().state !== 'started') return
    const part = this._buildAutomationLanePart(key)
    if (part) this._automationParts[key] = part
  }

  // Ensure a route→bus send gain exists (lazily wiring it like setSendLevel does),
  // so automating a send routes signal even when no manual send was configured.
  _ensureSendGain(routeId, fxBusId) {
    const key = `${routeId}:${fxBusId}`
    let sendGain = this._sendGains[key]
    if (sendGain) return sendGain
    const entry = this._mockSynths.get(routeId)
    const fxBus = this._fxTracks[fxBusId]
    if (!entry?.routeGain || !fxBus) return null
    sendGain = new Tone.Gain(0)
    entry.routeGain.connect(sendGain)
    sendGain.connect(fxBus.input)
    this._sendGains[key] = sendGain
    return sendGain
  }

  _applyAutomation(routeId, paramTarget, normalizedValue, glide) {
    const entry = this._mockSynths.get(routeId)
    const spec  = findTargetSpec(paramTarget, entry?.synthType)
    if (!spec) return
    // Frequency-style targets sweep geometrically; everything else is linear.
    const v = spec.curve === 'exp'
      ? denormalizeExp(normalizedValue, spec.min, spec.max)
      : denormalizeToRange(normalizedValue, spec.min, spec.max)
    // Per-lane glide is the slew time between points. Floor to ~10 ms so glide 0 still
    // ramps just enough to avoid zipper/click noise (a perceptual "snap").
    const ramp = (typeof glide === 'number' && glide > 0) ? glide : 0.01

    if (paramTarget.startsWith('send.')) {
      const fxBusId = paramTarget.slice(5)
      this._ensureSendGain(routeId, fxBusId)?.gain.rampTo(v, ramp)
    } else if (paramTarget === 'volume') {
      // spec is dB; routeGain is a linear Tone.Gain
      entry?.routeGain?.gain.rampTo(Math.pow(10, v / 20), ramp)
    } else if (paramTarget === 'pan') {
      // spec is -100..100; Tone.Panner.pan expects -1..1
      entry?.routePanner?.pan.rampTo(v / 100, ramp)
    } else if (paramTarget === 'glide') {
      // spec is ms; portamento is seconds. Direct set — lane glide is a no-op here.
      if (entry?.synth && 'portamento' in entry.synth) {
        try { entry.synth.portamento = v / 1000 } catch {}
      }
    } else if (paramTarget.startsWith('filter.')) {
      // Per-route insert filter (exists for every synth type)
      const param = paramTarget.slice(7)
      if (param === 'frequency') entry?.filter?.frequency.rampTo(v, ramp)
      else if (param === 'Q')    entry?.filter?.Q.rampTo(v, ramp)
    } else if (paramTarget.startsWith('adsr.')) {
      // .set() applies instantly — lane glide can't ramp these
      const param = paramTarget.slice(5)
      try { entry?.synth?.set({ envelope: { [param]: v } }) } catch {}
    } else if (paramTarget.startsWith('grain.')) {
      const key = paramTarget.slice(6)
      const g = entry?.granularVoice
      if (g) { if (key === 'mix') g.setMix(v); else g.set({ [key]: v }) }
    } else if (paramTarget.startsWith('synth.')) {
      if (entry?.synth) applySynthParam(entry.synth, entry.synthType, paramTarget.slice(6), v)
    }
  }

  // Restore a param to its manual baseline when an automation lane stops owning it
  // (its target was switched, or the lane was removed). Without this the node stays
  // frozen at the last automated value — e.g. a lane sitting briefly on the default
  // 'volume' target leaves the track gain stuck (often near-silent) when the user then
  // switches it to 'filter', so the filter sweep is inaudible.
  _restoreParamToManual(routeId, paramTarget) {
    if (!paramTarget) return
    const entry = this._mockSynths.get(routeId)
    if (paramTarget.startsWith('send.')) {
      const key = `${routeId}:${paramTarget.slice(5)}`
      this._sendGains[key]?.gain.rampTo(this._pendingSends[key] ?? 0, 0.05)
    } else if (paramTarget === 'volume') {
      this._applyRouteGain(routeId)
    } else if (paramTarget === 'pan') {
      entry?.routePanner?.pan.rampTo(this._routePans[routeId] ?? 0, 0.05)
    } else if (paramTarget === 'glide') {
      const g = this._glides[routeId]
      if (g != null && entry?.synth && 'portamento' in entry.synth) {
        try { entry.synth.portamento = g } catch {}
      }
    } else if (paramTarget.startsWith('filter.')) {
      const f = this._routeFilters[routeId] ?? {}
      const param = paramTarget.slice(7)
      if (param === 'frequency') entry?.filter?.frequency.rampTo(f.frequency ?? 20000, 0.05)
      else if (param === 'Q')    entry?.filter?.Q.rampTo(f.Q ?? 4, 0.05)
    } else if (paramTarget.startsWith('grain.')) {
      const key = paramTarget.slice(6)
      const cfg = { ...DEFAULT_GRANULAR, ...(this._granulars[routeId] ?? {}) }
      const g = entry?.granularVoice
      if (g) { if (key === 'mix') g.setMix(cfg.mix); else g.set({ [key]: cfg[key] }) }
    }
    // adsr.* / synth.* are applied via synth.set() and have no stored manual baseline on
    // the engine; they re-initialize from the UI on the next synth rebuild.
  }

  // The source line crossing a stop fires that stop's authored automation value.
  _dispatchFromSourceRoute(sourceRouteId, stopId) {
    for (const [key, at] of Object.entries(this._automationLanes)) {
      if (this._automationLaneCfgs[key]?.sourceRouteId === sourceRouteId)
        at.onStopEvent(stopId)
    }
  }

  // ── Synth factory ─────────────────────────────────────────────────────────────

  _makeSynth(synthType, params = {}, volume = -18) {
    const opts = buildSynthOpts(synthType, params, volume)
    switch (synthType) {
      case 'PolySynth': {
        const voice = { ...SYNTH_DEFAULTS.PolySynth, ...params }.voice ?? 'Synth'
        return new Tone.PolySynth(POLY_VOICE_CTORS[voice] ?? Tone.Synth, opts)
      }
      case 'FMSynth':       return new Tone.FMSynth(opts)
      case 'AMSynth':       return new Tone.AMSynth(opts)
      case 'MonoSynth':     return new Tone.MonoSynth(opts)
      case 'MembraneSynth': return new Tone.MembraneSynth(opts)
      case 'MetalSynth':    return new Tone.MetalSynth(opts)
      case 'NoiseSynth':    return new Tone.NoiseSynth(opts)
      case 'PluckSynth':    return new Tone.PluckSynth(opts)
      case 'DuoSynth':      return new Tone.DuoSynth(opts)
      case 'Sampler':       return new Tone.Sampler(opts)
      case 'Drums':         return new Tone.Sampler(opts)
      default:              return new Tone.Synth(opts)
    }
  }

  _triggerSynth(entry, note, dur, time) {
    const { synth, synthType, harmonySynth, harmonyInterval } = entry
    if (synthType === 'Drums') {
      // One-shot: always fire the voice at its native pitch, ignore route note.
      if (synth.loaded) synth.triggerAttackRelease(DRUM_TRIGGER_NOTE, dur, time)
    } else if (synthType === 'Sampler') {
      if (synth.loaded) synth.triggerAttackRelease(note, dur, time)
    } else if (synthType === 'NoiseSynth') {
      synth.triggerAttackRelease(dur, time)
    } else if (synthType === 'PluckSynth') {
      synth.triggerAttack(note, time)
    } else {
      synth.triggerAttackRelease(note, dur, time)
      if (harmonySynth && harmonyInterval) {
        harmonySynth.triggerAttackRelease(
          Tone.Frequency(note).transpose(harmonyInterval).toFrequency(), dur, time
        )
      }
    }
    // Layer a granular burst of the rendered instrument at the same pitch.
    const g = entry.granularVoice
    if (g?.loaded && this._granulars[entry.routeId]?.enabled) {
      g.triggerAttackRelease(note, dur, time)
    }
  }

  _triggerLegatoNote(entry, note, time) {
    const { synth, synthType, harmonySynth, harmonyInterval } = entry
    // For legato: attack only — note holds until the next attack replaces it
    if (synthType === 'NoiseSynth') {
      synth.triggerAttack(time)
    } else if (synthType === 'Drums') {
      if (synth.loaded) synth.triggerAttack(DRUM_TRIGGER_NOTE, time)
    } else if (synthType === 'Sampler') {
      if (synth.loaded) synth.triggerAttack(note, time)
    } else {
      try { synth.triggerAttack(note, time) } catch {}
      if (harmonySynth && harmonyInterval) {
        try {
          harmonySynth.triggerAttack(
            Tone.Frequency(note).transpose(harmonyInterval).toFrequency(), time
          )
        } catch {}
      }
    }
    const g = entry.granularVoice
    if (g?.loaded && this._granulars[entry.routeId]?.enabled) {
      g.triggerAttack(note, time)
    }
  }

  // Arpeggiate: the stop pitch is the root note; expand it into a scale-based
  // sequence and schedule each step at the synced rate. Tempo-synced via the
  // current Transport BPM (Tone.Time(rate)). Only the root note is sent to
  // onEvent / MIDI record by the caller — the arp tail isn't separately recorded.
  _triggerArp(entry, routeId, rootNote, time) {
    const cfg = this._arpeggiators[routeId]
    if (!cfg) return
    const scaleType = entry.scale?.scaleType ?? 'major'
    const scaleRoot = entry.scale?.root ?? 'C'
    const seq = buildArpSequence(rootNote, cfg, scaleType, scaleRoot)
    const stepSec = Tone.Time(cfg.rate ?? '16n').toSeconds()
    const dur = stepSec * (cfg.gate ?? 0.5)
    seq.forEach((n, i) => this._triggerSynth(entry, n, dur, time + i * stepSec))
  }

  // ── Route entry lifecycle ────────────────────────────────────────────────────

  _disposeRouteEntry(entry) {
    if (!entry) return
    if (entry._grainRenderTimer) clearTimeout(entry._grainRenderTimer)
    entry._grainRenderId = (entry._grainRenderId ?? 0) + 1
    entry.granularVoice?.dispose()
    entry.synth?.dispose()
    entry.harmonySynth?.dispose()
    entry.routeGain?.dispose()
    entry.routePanner?.dispose()
    entry.filter?.dispose()
    entry.eq?.dispose()
  }

  _createSingleRouteEntry(routeId, routeType, synthType = 'Synth', envelope = null, scale = null) {
    const lineOut = this._panners[routeType] ?? this._volumes[routeType] ?? this._alertLayer.input

    const disabled  = !!this._routeDisabled[routeId]
    const db        = this._routeVolumesDb[routeId] ?? 0
    const initGain  = disabled ? 0 : Math.pow(10, db / 20)
    const initPan   = this._routePans[routeId] ?? 0

    const synth       = this._makeSynth(synthType, envelope ?? {}, -18)
    const routeGain   = new Tone.Gain(initGain)
    const routePanner = new Tone.Panner(initPan)

    const fParams = this._routeFilters[routeId] ?? { type: 'lowpass', frequency: 20000, Q: 4 }
    const eParams = this._routeEqs[routeId]     ?? { low: 0, mid: 0, high: 0, lowFrequency: 400, highFrequency: 2500 }
    const filter  = new Tone.Filter(fParams)
    const eq      = new Tone.EQ3(eParams)

    synth.connect(routeGain)
    routeGain.connect(filter)
    filter.connect(eq)
    eq.connect(routePanner)
    routePanner.connect(lineOut)

    const glide = this._glides[routeId]
    if (glide != null && 'portamento' in synth) {
      try { synth.portamento = glide } catch {}
    }

    // Wire pending sends to already-created FX buses
    for (const [key, level] of Object.entries(this._pendingSends)) {
      const [instId, fxBusId] = key.split(':')
      if (instId !== routeId) continue
      const fxBus = this._fxTracks[fxBusId]
      if (!fxBus || this._sendGains[key]) continue
      const sendGain = new Tone.Gain(level)
      routeGain.connect(sendGain)
      sendGain.connect(fxBus.input)
      this._sendGains[key] = sendGain
    }

    const entry = {
      synth, harmonySynth: null, harmonyInterval: 0,
      routeId, routeType, synthType,
      synthParams: { ...(envelope ?? {}) },
      granularVoice: null,
      scale: scale ?? { root: 'C', scaleType: 'major' },
      routeGain, routePanner, filter, eq,
    }
    this._mockSynths.set(routeId, entry)

    // Rebuild the granular layer if this track has it enabled (restart / song replay).
    if (this._granulars[routeId]?.enabled) {
      this._ensureGranularVoice(routeId, entry)
      this._scheduleGranularRender(routeId, 0)
    }
    return entry
  }

  // ── FX bus creation ───────────────────────────────────────────────────────────

  _createFxBuses() {
    for (const spec of FX_BUSES) {
      if (this._fxTracks[spec.id]) this._fxTracks[spec.id].dispose()
      const overrides = this._fxBusParams[spec.id] ?? {}
      this._fxTracks[spec.id] = new FxTrack(spec.id, this._alertLayer.input, overrides)
    }
    this._applyFxMuteState()
  }

  // ── Live data handlers ───────────────────────────────────────────────────────

  handleVehicleUpdate(data) {
    const {
      vehicleId, lineType, lat, lng, bearing, speed,
      currentStatus, occupancyPct, carriageDetails,
      delay, uncertainty, scheduleRelationship,
      stopId, stopName, routeShortName, color,
    } = data

    if (!vehicleId || !lineType) return

    const vehicleRoute   = this._routes?.find(r => r.name === routeShortName)
    const octaveShift    = vehicleRoute ? (this._octaveShifts[vehicleRoute.id] ?? 0) : 0
    const bounds         = vehicleRoute?.stops ? routeBounds(vehicleRoute.stops) : null
    const note = this.computeNote(lat ?? 47.49, lng ?? 19.05, octaveShift, bounds)
    this._fleet.set(vehicleId, { lat: lat ?? 47.49, lng: lng ?? 19.05, note, lineType, currentStatus, routeShortName })

    // Automation source routes: only dispatch data, never create voices or play notes
    if (vehicleRoute?.id && this._automationSources.has(vehicleRoute.id)) {
      if (currentStatus === 1) this._dispatchFromSourceRoute(vehicleRoute.id, stopId)
      this._scheduleNetworkUpdate()
      return
    }

    let entry = this._voices.get(vehicleId)

    const needsVoice = currentStatus === 0 || currentStatus === 1
    if (!entry && needsVoice) {
      if (this._voices.size >= 150) this._evictOldestVoice()
      const routeEntry = vehicleRoute?.id ? this._mockSynths.get(vehicleRoute.id) : null
      const outputNode = routeEntry?.routeGain
        ?? this._panners[lineType]
        ?? this._volumes[lineType]
      if (outputNode) {
        const voice = new VehicleVoice(outputNode)
        const sm = routeShortName ? this._soundModes.get(routeShortName) : null
        if (sm) voice.setMode(sm.mode, 0)
        entry = { voice, lastUpdated: Date.now() }
        this._voices.set(vehicleId, entry)
      }
    }

    if (entry) {
      entry.lastUpdated = Date.now()
      entry.voice.update({ note, currentStatus, delay })

      if (scheduleRelationship != null && scheduleRelationship !== 0) {
        entry.voice.handleScheduleRelationship(scheduleRelationship)
      }
    }

    if (currentStatus === 1) {
      this._netState?.recordArrival()
      const ev = {
        vehicleId, lineType, lineId: routeShortName ?? vehicleId,
        stopId, stopName, note, routeShortName, color,
      }
      this.onEvent(ev)

      if (vehicleRoute?.id) {
        this._dispatchFromSourceRoute(vehicleRoute.id, stopId)
      }
    }

    this._scheduleNetworkUpdate()
  }

  handleTripUpdate(data) {
    const { vehicleId, delay, uncertainty, scheduleRelationship } = data
    const entry = this._voices.get(vehicleId)
    if (entry) {
      entry.voice.update({ delay, uncertainty, currentStatus: -1 })
      if (scheduleRelationship != null && scheduleRelationship !== 0) {
        entry.voice.handleScheduleRelationship(scheduleRelationship)
      }
    }
  }

  handleAlertUpdate(alerts) {
    this._alertLayer?.handleAlerts(alerts)
  }

  setSoundMode(routeShortName, mode, scale = { root: 'C', scaleType: 'major' }) {
    this._soundModes.set(routeShortName, { mode, scale })
    for (const [vehicleId, entry] of this._voices) {
      if (this._fleet.get(vehicleId)?.routeShortName === routeShortName) {
        entry.voice.setMode(mode, 0)
      }
    }
  }

  setScale(routeId, scale) {
    const entry = this._mockSynths.get(routeId)
    if (entry) this._mockSynths.set(routeId, { ...entry, scale })
    // The geographic pitch map is derived from the scale when the Part is built,
    // so rebuild any running Part to re-pitch the rail into the new harmony.
    if (this._routeParts[routeId]) this._rebuildRoutePart(routeId)
  }

  // ── Transport-driven playback ─────────────────────────────────────────────────

  _createRouteSynths(routes, soundModes = {}, synthTypes = {}, adsr = {}) {
    for (const route of routes) {
      if (!route.stops?.length) continue
      if (this._automationSources.has(route.id)) continue

      const sm        = soundModes[route.id] ?? { mode: 'harmonic', scale: { root: 'C', scaleType: 'major' } }
      const synthType = synthTypes[route.id] ?? 'Synth'
      const isSpecialized = NO_HARMONY.has(synthType)
      const perc      = !isSpecialized && sm.mode === 'percussive'

      const defaultEnvelope = isSpecialized
        ? SYNTH_DEFAULTS[synthType]
        : perc
          ? { attack: 0.003, decay: 0.18, sustain: 0, release: 0.35 }
          : SYNTH_DEFAULTS[synthType] ?? { attack: 0.1, decay: 0.1, sustain: 0.6, release: 0.8 }

      const envelope = adsr[route.id] ?? defaultEnvelope
      const scale    = sm.scale ?? { root: 'C', scaleType: 'major' }

      this._createSingleRouteEntry(route.id, route.type, synthType, envelope, scale)
    }

    // Build static curves using each lane's source route's stops
    for (const [key, at] of Object.entries(this._automationLanes)) {
      const srcRouteId = this._automationLaneCfgs[key]?.sourceRouteId
      if (!srcRouteId) continue
      const srcRoute = routes.find(r => r.id === srcRouteId)
      if (srcRoute?.stops) at.buildStaticCurve(srcRoute.stops)
    }
  }

  setMidiRecorder(recorder) {
    this._midiRecorder = recorder
  }

  // ── Audio export taps (lib/audioExport.js) ──────────────────────────────
  // The per-route output node *after* its inserts (gain/filter/eq/pan) and the
  // granular layer (which connects into routeGain), but before the shared
  // line-type bus / FX sends / master reverb — i.e. a dry channel stem.
  getRouteOutputNode(routeId) {
    return this._mockSynths.get(routeId)?.routePanner ?? null
  }

  // The master output (captures everything: FX buses + AlertLayer reverb/comp/limiter).
  getMasterOutputNode() {
    return Tone.getDestination()
  }

  // The raw Web Audio context (for creating capture nodes on the right graph).
  getAudioContext() {
    return Tone.getContext().rawContext
  }

  _beginMidiSession() {
    this._sessionStartTime = Tone.now()
    this._midiRecorder?.clear()
    this._midiRecorder?.start()
  }

  _recordMidiNote(routeId, note) {
    if (!this._midiRecorder) return
    this._midiRecorder.record({
      routeId,
      note,
      timeSec:   Tone.now() - this._sessionStartTime,
      soundMode: this._cachedSoundModes?.[routeId]?.mode ?? 'harmonic',
      legato:    !!this._legatoRoutes[routeId],
    })
  }

  // Import (or clear) a drum backing pattern from the Drum Machine tab. Applied
  // live if a sequencer is already running; picked up on next startMock otherwise.
  // A null pattern removes the backing. The pattern's own bpm is ignored — drums
  // ride the mock Transport so they stay in sync with the DAW tempo.
  setDrumPattern(pattern) {
    this._drumPattern = pattern ?? null
    if (this._drumSeq) {
      if (this._drumPattern) {
        this._drumSeq.load(this._drumPattern)
      } else {
        this._drumSeq.dispose()
        this._drumSeq = null
      }
      return
    }
    // No sequencer yet: build + schedule live only if we're mid-playback.
    if (this._drumPattern && Tone.Transport.state === 'started') this._startDrumSeq()
  }

  // Build + schedule the drum sequencer on the current Transport (no-op if there
  // is no pattern or it has no active steps). Routed through master so master
  // volume and WAV mix export both capture the drums.
  _startDrumSeq() {
    if (this._drumSeq || !this._drumPattern) return
    const seq = new DrumSequencer()
    seq.init(this.getMasterOutputNode())
    seq.load(this._drumPattern)
    if (!seq.hasActiveSteps()) { seq.dispose(); return }
    seq.schedule()
    this._drumSeq = seq
  }

    startMock(routes, soundModes = {}, bpm = 120, synthTypes = {}, adsr = {}, effects = {}) {
    Tone.Transport.bpm.value = bpm

    this._routes = routes
    this._cachedSoundModes = soundModes
    this._createFxBuses()
    this._createRouteSynths(routes, soundModes, synthTypes, adsr)

    // The global Transport runs continuously and never loops; each route/automation
    // Part loops on its OWN length (partLoopSec) so per-track speed + loop regions
    // create polyrhythm instead of being snapped back to a shared 4-bar cycle.
    Tone.Transport.loop = false

    for (const route of routes) {
      const part = this._buildPartForRoute(route)
      if (part) this._routeParts[route.id] = part
    }

    // Each automation lane schedules its own part at its own speed.
    for (const key of Object.keys(this._automationLanes)) {
      const part = this._buildAutomationLanePart(key)
      if (part) this._automationParts[key] = part
    }

    this._startDrumSeq()

    this._beginMidiSession()
    Tone.Transport.start()
  }

  // Dispatch: merged (PolySynth chord) lanes build a different Part than normal
  // geographic lanes. A route is merged when it's flagged isMerged (carries its
  // source routes' geometry) or registered in _merges.
  _buildPartForRoute(route) {
    return (route?.isMerged || this._merges[route?.id])
      ? this._buildMergedRoutePart(route)
      : this._buildRoutePart(route)
  }

  // Build a merged chord lane's Part. Instead of one geographic pitch stream, it
  // stacks the notes that every source lane would play at each shared grid cell
  // into a chord fired through this lane's single Tone.PolySynth. Timing follows
  // this merged lane's OWN speed / loop-region / grid resolution + scale + octave,
  // so all sources are re-pitched into one key and one grid.
  _buildMergedRoutePart(route) {
    const sources = (route?.sourceRoutes ?? []).filter(s => s?.stops?.length && s?.totalDist)
    if (!sources.length) return null
    const entry = this._mockSynths.get(route.id)
    if (!entry) return null

    const LOOP_BEATS = 16
    const loopSec    = (LOOP_BEATS / Tone.Transport.bpm.value) * 60
    const speed      = this._trackSpeeds[route.id] ?? 1

    const region    = this._trackLoopRegions[route.id]
    const rawStart  = region?.startCell ?? 0
    const rawEnd    = region?.endCell ?? GRID_TOTAL_CELLS
    const startCell = Math.max(0, Math.min(GRID_TOTAL_CELLS - 1, rawStart))
    const endCell   = Math.max(startCell + 1, Math.min(GRID_TOTAL_CELLS, rawEnd))
    const regionLen = endCell - startCell
    const partLoopSec = (regionLen / GRID_TOTAL_CELLS) * loopSec / speed
    const regionStartFrac = startCell / GRID_TOTAL_CELLS
    const regionEndFrac   = endCell   / GRID_TOTAL_CELLS

    const rate           = this._gridResolutions[route.id] ?? DEFAULT_GRID_RESOLUTION
    const stepsPerBar    = GRID_RESOLUTION_STEPS_PER_BAR[rate] ?? GRID_STEPS_PER_BAR
    const noteTotalCells = GRID_BARS * stepsPerBar

    const { root = 'C', scaleType = 'dorian' } = entry.scale ?? {}
    const rootMidi  = noteToMidi(`${root}3`)
    const modeScale = SCALES[scaleType] ?? MODES.dorian
    const octave    = this._octaveShifts[route.id] ?? 0

    // Bucket every source's in-region stop notes by grid cell → one chord per cell.
    const chords = new Map()   // cellIdx → { notes: Set<string>, name: string }
    for (const src of sources) {
      const pitchMap  = generatePitchMap(src.stops, rootMidi, modeScale)
      const gridStops = snapStopsToGrid(src.stops, src.totalDist, noteTotalCells, stepsPerBar)
        .filter(s => {
          const frac = s.cellIdx / noteTotalCells
          return frac >= regionStartFrac && frac < regionEndFrac
        })
      for (const stop of gridStops) {
        const raw  = pitchMap[stop.originalIdx] ?? randomFromScale(root, scaleType)
        const note = shiftOctaveNote(raw, octave)
        let cell = chords.get(stop.cellIdx)
        if (!cell) { cell = { notes: new Set(), name: stop.name }; chords.set(stop.cellIdx, cell) }
        cell.notes.add(note)
      }
    }
    if (chords.size === 0) return null

    const noteDur = '4n'
    const events = [...chords.entries()].map(([cellIdx, cell]) => [
      ((cellIdx / noteTotalCells - regionStartFrac) / (regionEndFrac - regionStartFrac)) * partLoopSec,
      { notes: [...cell.notes], name: cell.name },
    ])

    const part = new Tone.Part((time, ev) => {
      if (this._soloRoutes.size > 0 && !this._soloRoutes.has(route.id)) return
      if (this._routeDisabled[route.id]) return

      const e = this._mockSynths.get(route.id)
      if (!e) return
      // Tone.PolySynth.triggerAttackRelease accepts an array → the whole chord in one call.
      this._triggerSynth(e, ev.notes, noteDur, time)
      this.onEvent({ routeShortName: route.name, stopName: ev.name, note: ev.notes[0], lineType: route.type })
      for (const n of ev.notes) this._recordMidiNote(route.id, n)
    }, events)

    part.loop    = true
    part.loopEnd = partLoopSec
    part.start(0)
    return part
  }

  // Build (or rebuild) a single route's Tone.Part using the current
  // speed + loop-region state. Returns the Part, or null if the route
  // can't be scheduled (missing stops, missing mock synth entry, etc.)
  _buildRoutePart(route) {
    if (!route?.stops?.length || !route?.totalDist) return null

    const LOOP_BEATS  = 16
    const loopSec     = (LOOP_BEATS / Tone.Transport.bpm.value) * 60
    const speed       = this._trackSpeeds[route.id] ?? 1

    const region      = this._trackLoopRegions[route.id]
    const rawStart    = region?.startCell ?? 0
    const rawEnd      = region?.endCell ?? GRID_TOTAL_CELLS
    const startCell   = Math.max(0, Math.min(GRID_TOTAL_CELLS - 1, rawStart))
    const endCell     = Math.max(startCell + 1, Math.min(GRID_TOTAL_CELLS, rawEnd))
    const regionLen   = endCell - startCell
    const partLoopSec = (regionLen / GRID_TOTAL_CELLS) * loopSec / speed
    const regionStartFrac = startCell / GRID_TOTAL_CELLS
    const regionEndFrac   = endCell   / GRID_TOTAL_CELLS

    // Note quantization grid is independent of the loop-region's fixed 64-cell space —
    // compare/schedule by fraction-of-loop so any per-track resolution (16th, triplet, ...)
    // still respects the same region trim.
    const rate          = this._gridResolutions[route.id] ?? DEFAULT_GRID_RESOLUTION
    const stepsPerBar   = GRID_RESOLUTION_STEPS_PER_BAR[rate] ?? GRID_STEPS_PER_BAR
    const noteTotalCells = GRID_BARS * stepsPerBar

    const gridStops = snapStopsToGrid(route.stops, route.totalDist, noteTotalCells, stepsPerBar)
      .filter(s => {
        const frac = s.cellIdx / noteTotalCells
        return frac >= regionStartFrac && frac < regionEndFrac
      })

    // Automation source routes have no synth and no shared part — each lane that
    // reads this source schedules its own part (at its own speed) via
    // _buildAutomationLanePart. So a source route simply produces no note part here.
    const entry = this._mockSynths.get(route.id)
    if (!entry) return null

    const soundMode = this._cachedSoundModes?.[route.id]?.mode
    const noteDur   = soundMode !== 'percussive' ? '4n' : '8n'

    // Build the geographic pitch map once per route: latitude → scale degree,
    // longitude → octave register (see generatePitchMap / geoToMidi).
    const { root: autoRoot = 'C', scaleType: autoScale = 'dorian' } = entry.scale ?? {}
    const autoRootMidi  = noteToMidi(`${autoRoot}3`)
    const autoModeScale = SCALES[autoScale] ?? MODES.dorian
    const pitchMap      = generatePitchMap(route.stops, autoRootMidi, autoModeScale)

    const part = new Tone.Part((time, stop) => {
      if (this._soloRoutes.size > 0 && !this._soloRoutes.has(route.id)) return
      if (this._routeDisabled[route.id]) return
      if (this._mergeConsumed.has(route.id)) return   // folded into a merged lane
      if (this._droneRoutes[route.id]?.enabled) return

      const e = this._mockSynths.get(route.id)
      if (!e) return
      const { root = 'C', scaleType = 'major' } = e.scale ?? {}
      const rawNote   = pitchMap[stop.originalIdx] ?? randomFromScale(root, scaleType)
      // Per-stop diatonic re-pitch (duplicate lanes) → stays within the lane's harmony.
      const off       = this._pitchOffsets[route.id]?.[stop.id] ?? 0
      const tuned     = off ? transposeNoteInScale(rawNote, off, root, scaleType) : rawNote
      const note = shiftOctaveNote(tuned, this._octaveShifts[route.id] ?? 0)
      if (this._arpeggiators[route.id]?.enabled) {
        this._triggerArp(e, route.id, note, time)
      } else if (this._legatoRoutes[route.id]) {
        this._triggerLegatoNote(e, note, time)
      } else {
        this._triggerSynth(e, note, noteDur, time)
      }
      this.onEvent({ routeShortName: route.name, stopName: stop.name, note, lineType: route.type })
      this._recordMidiNote(route.id, note)
    }, gridStops.map(stop => [
      ((stop.cellIdx / noteTotalCells - regionStartFrac) / (regionEndFrac - regionStartFrac)) * partLoopSec,
      stop,
    ]))

    part.loop    = true
    part.loopEnd = partLoopSec
    part.start(0)
    return part
  }

  startLive(routes, soundModes = {}, bpm = 120, synthTypes = {}, adsr = {}, effects = {}) {
    Tone.Transport.bpm.value = bpm

    this._routes = routes
    this._createFxBuses()
    this._createRouteSynths(routes, soundModes, synthTypes, adsr)

    // Run the Transport continuously without a global loop (see startMock).
    Tone.Transport.loop = false
    this._beginMidiSession()
    Tone.Transport.start()
  }

  triggerLiveNote(routeId, routeType, note) {
    if (this._soloRoutes.size > 0 && !this._soloRoutes.has(routeId)) return
    if (this._routeDisabled[routeId]) return
    if (this._mergeConsumed.has(routeId)) return   // folded into a merged lane
    if (this._droneRoutes[routeId]?.enabled) return

    const e = this._mockSynths.get(routeId)
    if (!e) return
    const time = Math.max(Tone.now(), (e._lastTriggerTime ?? 0) + 0.001)
    e._lastTriggerTime = time
    if (this._arpeggiators[routeId]?.enabled) {
      this._triggerArp(e, routeId, note, time)
    } else if (this._legatoRoutes[routeId]) {
      this._triggerLegatoNote(e, note, time)
    } else {
      this._triggerSynth(e, note, '8n', time)
    }
    this.onEvent({ routeShortName: routeId, note, lineType: routeType })
    this._recordMidiNote(routeId, note)
  }

  setSolo(routeId, isSoloed) {
    if (isSoloed) this._soloRoutes.add(routeId)
    else          this._soloRoutes.delete(routeId)
  }

  setDroneMode(routeId, enabled, rootNote = 'C3') {
    this._droneRoutes[routeId] = { enabled, rootNote }
    const entry = this._mockSynths.get(routeId)
    if (!entry) return
    if (enabled) {
      entry.synth.triggerAttack(rootNote, Tone.now())
      if (this._granulars[routeId]?.enabled) entry.granularVoice?.triggerAttack(rootNote, Tone.now())
    } else {
      entry.synth.triggerRelease(Tone.now())
      entry.granularVoice?.triggerRelease(Tone.now())
    }
  }

  setDroneRoot(routeId, rootNote) {
    const dr = this._droneRoutes[routeId]
    if (dr) dr.rootNote = rootNote
    if (!dr?.enabled) return
    const entry = this._mockSynths.get(routeId)
    if (entry?.synth?.frequency)
      entry.synth.frequency.rampTo(Tone.Frequency(rootNote).toFrequency(), 0.1)
    entry?.granularVoice?.setNote(rootNote)
  }

  setTrackSpeed(routeId, multiplier) {
    this._trackSpeeds[routeId] = multiplier
    this._rebuildRoutePart(routeId)
  }

  setTrackLoopRegion(routeId, region) {
    if (!region) return
    this._trackLoopRegions[routeId] = {
      startCell: Math.max(0, Math.min(GRID_TOTAL_CELLS - 1, Math.round(region.startCell ?? 0))),
      endCell:   Math.max(1, Math.min(GRID_TOTAL_CELLS, Math.round(region.endCell ?? GRID_TOTAL_CELLS))),
    }
    this._rebuildRoutePart(routeId)
  }

  setGridResolution(routeId, rate) {
    this._gridResolutions[routeId] = rate
    this._rebuildRoutePart(routeId)
  }

  getRouteProgress(routeId) {
    const part = this._routeParts[routeId]
    return part ? part.progress : null
  }

  _rebuildRoutePart(routeId) {
    const route = this._routes?.find(r => r.id === routeId)
    if (!route) return
    this._routeParts[routeId]?.dispose()
    delete this._routeParts[routeId]
    const part = this._buildPartForRoute(route)
    if (part) this._routeParts[routeId] = part
    // Re-time any automation lanes that read this route as their source (its loop
    // region / speed change shifts their stop timeline).
    for (const [key, cfg] of Object.entries(this._automationLaneCfgs)) {
      if (cfg.sourceRouteId === routeId) this._rebuildAutomationLanePart(key)
    }
  }

  setSynthType(routeId, routeType, synthType, envelope) {
    const entry = this._mockSynths.get(routeId)
    if (!entry) return

    entry.synth.dispose()
    entry.harmonySynth?.dispose()

    const synth = this._makeSynth(synthType, envelope ?? SYNTH_DEFAULTS[synthType] ?? {}, -18)
    synth.connect(entry.routeGain)

    const glide = this._glides[routeId]
    if (glide != null && 'portamento' in synth) {
      try { synth.portamento = glide } catch {}
    }

    this._mockSynths.set(routeId, {
      ...entry, synth, harmonySynth: null, harmonyInterval: 0, synthType,
      synthParams: { ...(envelope ?? {}) },
    })
    // The granular layer granulates this instrument — re-render its source.
    if (this._granulars[routeId]?.enabled) this._scheduleGranularRender(routeId, 0)
  }

  updateEnvelope(routeId, params) {
    const e = this._mockSynths.get(routeId)
    if (!e) return
    e.synthParams = { ...(e.synthParams ?? {}), ...params }
    // Debounced so slider drags coalesce into one re-render.
    if (this._granulars[routeId]?.enabled) this._scheduleGranularRender(routeId)
    if (e.synthType === 'Sampler' || e.synthType === 'Drums') {
      // Sampler/Drums attack/release are top-level; never push urls through .set()
      const live = {}
      if (params.attack  != null) live.attack  = params.attack
      if (params.release != null) live.release = params.release
      if (Object.keys(live).length) e.synth.set(live)
      return
    }
    e.synth.set(buildSynthOpts(e.synthType, params))
  }

  // Load a user-uploaded AudioBuffer into a route's Sampler at the given note.
  setSamplerBuffer(routeId, note = 'C4', audioBuffer) {
    const e = this._mockSynths.get(routeId)
    if (e?.synthType !== 'Sampler' || !audioBuffer) return
    try { e.synth.add(note, audioBuffer) } catch (err) { console.warn('setSamplerBuffer', err) }
  }

  // ── Granular layer ────────────────────────────────────────────────────────────
  // Per-track grain cloud rendered from the track's own instrument and layered
  // on top of the dry notes (toggled like the arpeggiator).

  setGranular(routeId, cfg) {
    this._granulars[routeId] = { ...(this._granulars[routeId] ?? {}), ...cfg }
    const merged = this._granulars[routeId]
    const entry = this._mockSynths.get(routeId)
    if (!entry) return
    if (merged.enabled) {
      const hadVoice = !!entry.granularVoice
      const voice = this._ensureGranularVoice(routeId, entry)
      voice.set(merged)
      if (!hadVoice || !voice.loaded) this._scheduleGranularRender(routeId, 0)
    } else if (entry.granularVoice) {
      entry.granularVoice.dispose()
      entry.granularVoice = null
    }
  }

  _ensureGranularVoice(routeId, entry = this._mockSynths.get(routeId)) {
    if (!entry) return null
    if (!entry.granularVoice) {
      const cfg = { ...DEFAULT_GRANULAR, ...(this._granulars[routeId] ?? {}) }
      const voice = new GranularVoice({ baseNote: GRANULAR_RENDER_NOTE, ...cfg })
      // Into routeGain so the layer inherits the track's inserts/sends/mute.
      voice.connect(entry.routeGain)
      entry.granularVoice = voice
    }
    return entry.granularVoice
  }

  _scheduleGranularRender(routeId, delay = 400) {
    const entry = this._mockSynths.get(routeId)
    if (!entry || !this._granulars[routeId]?.enabled) return
    if (entry._grainRenderTimer) clearTimeout(entry._grainRenderTimer)
    entry._grainRenderTimer = setTimeout(() => {
      entry._grainRenderTimer = null
      this._renderGranularSource(routeId)
    }, delay)
  }

  // Render the route's current instrument playing GRANULAR_RENDER_NOTE into a
  // short buffer and hand it to the granular voice as its grain source.
  async _renderGranularSource(routeId) {
    const entry = this._mockSynths.get(routeId)
    if (!entry?.granularVoice) return
    const renderId = entry._grainRenderId = (entry._grainRenderId ?? 0) + 1
    const synthType = entry.synthType
    const params = { ...(SYNTH_DEFAULTS[synthType] ?? {}), ...(entry.synthParams ?? {}) }
    try {
      // Tone.Offline swaps the global context for the whole callback, so the
      // callback must stay synchronous — sample-backed synths get their single
      // source sample pre-fetched here in the main context instead.
      let sampleBuffer = null
      if (synthType === 'Sampler' || synthType === 'Drums') {
        sampleBuffer = await fetchGranularRenderSample(synthType, params)
        if (entry._grainRenderId !== renderId || this._mockSynths.get(routeId) !== entry) return
      }
      const rendered = await Tone.Offline(() => {
        const s = sampleBuffer
          ? new Tone.Sampler({
              urls: { [GRANULAR_RENDER_NOTE]: sampleBuffer },
              attack: params.attack ?? 0.01, release: params.release ?? 1.0,
            })
          : this._makeSynth(synthType, params, 0)
        s.toDestination()
        if (synthType === 'NoiseSynth')      s.triggerAttackRelease(1.2, 0.05)
        else if (synthType === 'PluckSynth') s.triggerAttack(GRANULAR_RENDER_NOTE, 0.05)
        else                                 s.triggerAttackRelease(GRANULAR_RENDER_NOTE, 1.2, 0.05)
      }, GRANULAR_RENDER_SECONDS)
      if (entry._grainRenderId !== renderId || this._mockSynths.get(routeId) !== entry) return
      entry.granularVoice?.setBuffer(rendered.get())
    } catch (err) {
      console.warn('Granular source render failed', err)
    }
  }

  // ── DAW controls ─────────────────────────────────────────────────────────────

  setVolume(lineType, db) {
    this._volumes[lineType]?.set({ volume: db })
  }

  setMute(lineType, muted) {
    this._muted[lineType] = muted
    this._volumes[lineType]?.set({ mute: muted })
  }

  setPan(lineType, value) {
    this._panners[lineType]?.pan.rampTo(value, 0.05)
  }

  async start() {
    await Tone.start()
    this._started = true
  }

  stopMock() {
    if (this._netUpdateTimer) {
      clearTimeout(this._netUpdateTimer)
      this._netUpdateTimer = null
    }

    // Drum sequencer rides this Transport; tear it down before cancel() so its
    // voices are freed. The stored _drumPattern stays so the next start rebuilds it.
    if (this._drumSeq) {
      this._drumSeq.dispose()
      this._drumSeq = null
    }

    Tone.Transport.cancel()
    Tone.Transport.stop()
    Tone.Transport.position = 0

    for (const part of Object.values(this._routeParts)) part.dispose()
    this._routeParts = {}

    for (const part of Object.values(this._automationParts)) part.dispose()
    this._automationParts = {}

    // Release any held legato notes before disposal
    for (const [routeId, legato] of Object.entries(this._legatoRoutes)) {
      if (legato) {
        const entry = this._mockSynths.get(routeId)
        if (entry?.synth) try { entry.synth.triggerRelease(Tone.now()) } catch {}
        entry?.granularVoice?.triggerRelease(Tone.now())
      }
    }

    for (const entry of this._mockSynths.values()) this._disposeRouteEntry(entry)
    this._mockSynths.clear()

    for (const gain of Object.values(this._sendGains)) gain.dispose()
    this._sendGains = {}

    for (const fxTrack of Object.values(this._fxTracks)) fxTrack.dispose()
    this._fxTracks = {}

    for (const [id, entry] of [...this._voices]) {
      entry.voice.dispose()
      this._voices.delete(id)
    }
    this._fleet.clear()

    this._netState?.stop()
    // _automationLanes, _automationLaneCfgs, and _pendingSends persist across start/stop
  }

  dispose() {
    this.stopMock()
    // _routeParts already disposed by stopMock
    for (const at of Object.values(this._automationLanes)) at.dispose()
    this._automationLanes    = {}
    this._automationLaneCfgs = {}
    for (const { voice } of this._voices.values()) voice.dispose()
    this._voices.clear()
    Object.values(this._volumes).forEach(v => v.dispose())
    this._alertLayer?.dispose()
    this._netState?.dispose()
    if (this._netUpdateTimer) clearTimeout(this._netUpdateTimer)
  }

  // ── Internal helpers ─────────────────────────────────────────────────────────

  _evictOldestVoice() {
    let oldestId   = null
    let oldestTime = Infinity
    for (const [id, entry] of this._voices) {
      if (entry.lastUpdated < oldestTime) {
        oldestTime = entry.lastUpdated
        oldestId   = id
      }
    }
    if (oldestId) {
      this._voices.get(oldestId).voice.dispose()
      this._voices.delete(oldestId)
      this._fleet.delete(oldestId)
    }
  }

  _scheduleNetworkUpdate() {
    if (this._netUpdateTimer) return
    this._netUpdateTimer = setTimeout(() => {
      this._netUpdateTimer = null
      this._netState?.update(this._fleet, this._alertLayer)
    }, 5000)
  }
}
