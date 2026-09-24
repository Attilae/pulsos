// Pure instrument/sound specs — plain data, no Tone import, so server code (the
// AI plan contract and plan → snapshot step the MCP server uses) can read the
// same vocabulary and defaults the engine plays. Re-exported by lib/engine.js.

import { PAD_DEFS } from './drumSpecs.js'
import { noteToMidi } from './mappings.js'

// Reserved pseudo-route id for the imported Drum Machine lane. It carries its own
// insert chain (gain/filter/eq/pan + FX sends) in _mockSynths so the drum lane can
// reuse every per-route mixer setter (setRouteVolume/Filter/EqState/SendLevel, …)
// and ride the existing snapshot maps (volumes/trackFilters/trackEqs/sendMatrix).
export const DRUMS_ROUTE_ID = '__drums__'

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
    license: 'CC BY-NC-SA 4.0', attribution: 'Casio sample set by Yotam Mann (2015)',
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

// ── Sidechain ducking ────────────────────────────────────────────────────────
// A lane's output dips whenever a trigger source fires. Web Audio has no key
// input on DynamicsCompressorNode, so this is not a compressor listening to a
// signal — it's a gain envelope *scheduled ahead of the audio clock*, which the
// engine can do because every trigger site already carries an exact `time` and
// a velocity. Deterministic, sample-accurate, and free when unused.
export const DEFAULT_SIDECHAIN = {
  enabled: false,
  source: '',        // see SIDECHAIN source-key format below
  amountDb: -9,      // 0 → -40: how far the lane dips at full velocity
  attack: 0.005,     // 0 → 0.2 s down to the floor
  release: 0.18,     // 0.02 → 1.5 s back to unity
}

// Source keys: '__drums__' = any pad, '__drums__:<padId>' = that pad only,
// anything else = an instrument lane's routeId.
export const SIDECHAIN_ANY_DRUM = DRUMS_ROUTE_ID
export const SIDECHAIN_PAD_SOURCES = PAD_DEFS.map(p => ({
  value: `${DRUMS_ROUTE_ID}:${p.id}`,
  label: p.label,
}))

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
    // voice1OscType absent → voice 1 follows voice 0 (older songs had one control).
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

// FX buses a fresh session starts with, so `send.*` automation targets exist
// immediately. MixerTab seeds and resets to this; a new MCP-created song does too.
export const DEFAULT_FX_TRACKS = ['reverb', 'delay', 'chorus', 'distortion']

// Every instrument a lane can play, in the order the DAW's lane picker lists
// them (DawView/engine/planContract re-export this as SYNTH_TYPES). Must hold
// exactly the keys of SYNTH_DEFAULTS — test/sound-policy pins that.
export const SYNTH_TYPES = [
  'Synth', 'MonoSynth', 'DuoSynth', 'FMSynth', 'AMSynth', 'PolySynth',
  'PluckSynth', 'MembraneSynth', 'MetalSynth', 'NoiseSynth', 'Sampler', 'Drums',
]

// Oscillator waveforms offered by the synth editors (and a plan's tone.oscillator).
export const OSC_TYPES = ['sine', 'triangle', 'square', 'sawtooth', 'fatsine', 'fattriangle', 'fatsquare', 'fatsawtooth', 'pulse', 'pwm']

// Which plan `tone` keys each synth type actually honours — mirrors which keys
// engine.js buildSynthOpts reads for that type. A key not listed is a no-op.
export const TONE_SUPPORT = {
  Synth:     ['oscillator'],
  PolySynth: ['oscillator'],
  MonoSynth: ['oscillator'],
  FMSynth:   ['oscillator', 'harmonicity', 'modulationIndex', 'modEnvelope'],
  AMSynth:   ['oscillator', 'harmonicity', 'modEnvelope'],
}

// The one recorded zone a sample-backed lane's granular layer is rendered from:
// the preset zone nearest `renderNote`, *with its real note name*. The render
// must key the Sampler by that name so Tone repitches it to `renderNote` —
// labelling it `renderNote` directly left grains detuned by the distance to the
// nearest zone (a semitone on bass-electric, whose nearest zone is C#4). A Drums
// one-shot has no pitch of its own, so it is taken as `renderNote`.
export function granularSourceZone(synthType, params = {}, renderNote = 'C4') {
  if (synthType === 'Drums') {
    const voice = DRUM_VOICES.find(v => v.id === params.drumVoice) ?? DRUM_VOICES[0]
    return { url: DRUM_BASE_URL + voice.file, note: renderNote }
  }
  const preset = SAMPLER_PRESETS[params.samplerPreset] ?? SAMPLER_PRESETS.piano
  const target = noteToMidi(renderNote)
  const note = Object.keys(preset.urls).reduce((best, n) =>
    Math.abs(noteToMidi(n) - target) < Math.abs(noteToMidi(best) - target) ? n : best)
  return { url: preset.baseUrl + preset.urls[note], note }
}
