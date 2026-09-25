// Pure FX bus/param specs — no Tone import, so server code (the AI plan
// contract the MCP server uses) can read them. Re-exported by fxTrack.js.

// Reverb IR presets. `synthetic` uses Tone.Reverb (noise-generated IR).
// All other presets convolve against a real recorded IR loaded from /irs/,
// ordered small → large. They are CC BY 4.0, from the OpenAIR library (University
// of York) — see public/irs/ATTRIBUTION.md.
// `custom` is a runtime-loaded user file (no URL; buffer set via setCustomIRBuffer).
export const REVERB_IR_PRESETS = [
  { id: 'synthetic',  label: 'Synthetic',    url: null },
  { id: 'room',       label: 'Room',         url: '/irs/room.wav' },
  { id: 'church',     label: 'Church',       url: '/irs/church.wav' },
  { id: 'cathedral',  label: 'Cathedral',    url: '/irs/cathedral.wav' },
  { id: 'sportshall', label: 'Sports Hall',  url: '/irs/sportshall.wav' },
  { id: 'reactor',    label: 'Reactor Hall', url: '/irs/reactor.wav' },
  { id: 'minster',    label: 'Minster',      url: '/irs/minster.wav' },
  { id: 'warehouse',  label: 'Warehouse',    url: '/irs/warehouse.wav' },
  { id: 'mausoleum',  label: 'Mausoleum',    url: '/irs/mausoleum.wav' },
  { id: 'custom',     label: 'Custom…',      url: null },
]

// IR ids that were removed, mapped to the closest current preset. Old songs and
// stale plans (or a composer skill a user installed earlier) still name them.
export const LEGACY_IR_ALIASES = {
  tunnel:    'reactor',
  cave:      'church',
  stairwell: 'room',
  hall:      'sportshall',
}

export function normalizeIrType(id) {
  return LEGACY_IR_ALIASES[id] ?? id
}

export const FX_BUSES = [
  { id: 'reverb',     label: 'Reverb',         defaults: { wet: 1.0, decay: 2.5, preDelay: 0.01, irType: 'warehouse' } },
  { id: 'jcreverb',   label: 'Spring Reverb',  defaults: { wet: 1.0, roomSize: 0.3  } },
  { id: 'delay',      label: 'Delay',          defaults: { wet: 1.0, delayTime: 0.25, feedback: 0.4, sync: '8n' } },
  { id: 'pingpong',   label: 'Ping-Pong',      defaults: { wet: 1.0, delayTime: 0.2,  feedback: 0.3 } },
  { id: 'chorus',     label: 'Chorus',         defaults: { wet: 1.0, frequency: 1, delayTime: 4.5, depth: 0.5, feedback: 0.4, spread: 180 } },
  { id: 'phaser',     label: 'Phaser',         defaults: { wet: 1.0, frequency: 0.5, octaves: 3, baseFrequency: 700, Q: 10 } },
  { id: 'tremolo',    label: 'Tremolo',        defaults: { wet: 1.0, frequency: 4, depth: 0.5, spread: 180 } },
  { id: 'vibrato',    label: 'Vibrato',        defaults: { wet: 1.0, frequency: 5, depth: 0.1 } },
  { id: 'autofilter', label: 'Auto Filter',    defaults: { wet: 1.0, frequency: 2, baseFrequency: 800, octaves: 2, depth: 1 } },
  { id: 'autopanner', label: 'Auto Panner',    defaults: { wet: 1.0, frequency: 1, depth: 1 } },
  { id: 'wah',        label: 'Auto Wah',       defaults: { wet: 1.0, frequency: 2, baseFrequency: 1000, octaves: 4, depth: 1 } },
  { id: 'distortion', label: 'Distortion',     defaults: { wet: 1.0, distortion: 0.4, oversample: '4x' } },
  { id: 'bitcrusher', label: 'Bit Crusher',    defaults: { wet: 1.0, bits: 8 } },
  { id: 'widener',    label: 'Stereo Widener', defaults: { wet: 1.0, width: 0.7 } },
]

// Parameter specs per bus (excluding `wet` — that has its own dedicated slider).
//
// Each entry shape:
//   { id, label, kind, min?, max?, step?, displayScale?, unit?, values? }
//
// kind:
//   'signal' — Tone Signal/Param; set via .rampTo(value, 0.05)
//   'number' — plain JS getter/setter on the effect node
//   'enum'   — string property; `values` lists allowed strings
//
// displayScale: multiplier from raw value to UI value (e.g. seconds → ms => 1000).
// unit: short string shown next to the value in the UI.

// Tempo-sync note divisions for time-based effects. `id` is the literal Tone
// transport-time notation (applied directly to a Signal's .value, which Tone
// converts against Tone.Transport.bpm); `'free'` keeps the raw ms/Hz slider.
export const FX_SYNC_DIVISIONS = [
  { id: 'free', label: 'Free' },
  { id: '1n',  label: '1/1' },  { id: '2n',  label: '1/2' },  { id: '2n.', label: '1/2.' },
  { id: '4n',  label: '1/4' },  { id: '4n.', label: '1/4.' }, { id: '4t',  label: '1/4T' },
  { id: '8n',  label: '1/8' },  { id: '8n.', label: '1/8.' }, { id: '8t',  label: '1/8T' },
  { id: '16n', label: '1/16' }, { id: '16t', label: '1/16T' }, { id: '32n', label: '1/32' },
]


// Which Signal each bus's Sync control drives (delay time, or LFO rate).
export const FX_SYNC_TARGETS = {
  delay: 'delayTime', pingpong: 'delayTime',
  chorus: 'frequency', tremolo: 'frequency', vibrato: 'frequency',
  autofilter: 'frequency', autopanner: 'frequency', phaser: 'frequency', wah: 'frequency',
}

// Shared Sync dropdown spec, spread into each syncable bus's param list.
const SYNC_SPEC = {
  id: 'sync', label: 'Sync', kind: 'enum',
  values:      FX_SYNC_DIVISIONS.map(d => d.id),
  valueLabels: Object.fromEntries(FX_SYNC_DIVISIONS.map(d => [d.id, d.label])),
}

export const FX_PARAM_SPECS = {
  reverb: [
    { id: 'irType',   label: 'IR',    kind: 'enum',
      values:      REVERB_IR_PRESETS.map(p => p.id),
      valueLabels: Object.fromEntries(REVERB_IR_PRESETS.map(p => [p.id, p.label])) },
    { id: 'decay',    label: 'Decay', kind: 'number', min: 0.1, max: 10,   step: 0.1,   unit: 's',  debounceMs: 200 },
    { id: 'preDelay', label: 'Pre',   kind: 'number', min: 0,   max: 0.2,  step: 0.001, displayScale: 1000, unit: 'ms', debounceMs: 200 },
  ],
  jcreverb: [
    { id: 'roomSize', label: 'Room',  kind: 'signal', min: 0, max: 1,   step: 0.01 },
  ],
  delay: [
    SYNC_SPEC,
    { id: 'delayTime', label: 'Time', kind: 'signal', min: 0.01, max: 1.5,  step: 0.001, displayScale: 1000, unit: 'ms' },
    { id: 'feedback',  label: 'FB',   kind: 'signal', min: 0,    max: 0.95, step: 0.01 },
  ],
  pingpong: [
    SYNC_SPEC,
    { id: 'delayTime', label: 'Time', kind: 'signal', min: 0.01, max: 1.5,  step: 0.001, displayScale: 1000, unit: 'ms' },
    { id: 'feedback',  label: 'FB',   kind: 'signal', min: 0,    max: 0.95, step: 0.01 },
  ],
  chorus: [
    SYNC_SPEC,
    { id: 'frequency', label: 'Rate',   kind: 'signal', min: 0.1, max: 20,   step: 0.1,  unit: 'Hz' },
    { id: 'delayTime', label: 'Time',   kind: 'number', min: 1,   max: 20,   step: 0.1,  unit: 'ms' },
    { id: 'depth',     label: 'Depth',  kind: 'number', min: 0,   max: 1,    step: 0.01 },
    { id: 'feedback',  label: 'FB',     kind: 'signal', min: 0,   max: 0.95, step: 0.01 },
    { id: 'spread',    label: 'Spread', kind: 'number', min: 0,   max: 180,  step: 1,    unit: '°' },
  ],
  phaser: [
    SYNC_SPEC,
    { id: 'frequency',     label: 'Rate', kind: 'signal', min: 0.05, max: 10,   step: 0.05, unit: 'Hz' },
    { id: 'octaves',       label: 'Oct',  kind: 'number', min: 0,    max: 8,    step: 1 },
    { id: 'baseFrequency', label: 'Base', kind: 'number', min: 50,   max: 5000, step: 10,   unit: 'Hz' },
    { id: 'Q',             label: 'Q',    kind: 'signal', min: 0.1,  max: 20,   step: 0.1 },
  ],
  tremolo: [
    SYNC_SPEC,
    { id: 'frequency', label: 'Rate',   kind: 'signal', min: 0.1, max: 20,  step: 0.1, unit: 'Hz' },
    { id: 'depth',     label: 'Depth',  kind: 'signal', min: 0,   max: 1,   step: 0.01 },
    { id: 'spread',    label: 'Spread', kind: 'number', min: 0,   max: 180, step: 1,   unit: '°' },
  ],
  vibrato: [
    SYNC_SPEC,
    { id: 'frequency', label: 'Rate',  kind: 'signal', min: 0.1, max: 20, step: 0.1, unit: 'Hz' },
    { id: 'depth',     label: 'Depth', kind: 'signal', min: 0,   max: 1,  step: 0.01 },
  ],
  autofilter: [
    SYNC_SPEC,
    { id: 'frequency',     label: 'Rate',  kind: 'signal', min: 0.1, max: 20,   step: 0.1,  unit: 'Hz' },
    { id: 'baseFrequency', label: 'Base',  kind: 'number', min: 50,  max: 5000, step: 10,   unit: 'Hz' },
    { id: 'octaves',       label: 'Oct',   kind: 'number', min: 0,   max: 8,    step: 1 },
    { id: 'depth',         label: 'Depth', kind: 'signal', min: 0,   max: 1,    step: 0.01 },
  ],
  autopanner: [
    SYNC_SPEC,
    { id: 'frequency', label: 'Rate',  kind: 'signal', min: 0.05, max: 20, step: 0.05, unit: 'Hz' },
    { id: 'depth',     label: 'Depth', kind: 'signal', min: 0,    max: 1,  step: 0.01 },
  ],
  wah: [
    SYNC_SPEC,
    { id: 'frequency',     label: 'Rate',  kind: 'signal', min: 0.1, max: 20,   step: 0.1,  unit: 'Hz' },
    { id: 'baseFrequency', label: 'Base',  kind: 'number', min: 50,  max: 5000, step: 10,   unit: 'Hz' },
    { id: 'octaves',       label: 'Oct',   kind: 'number', min: 0,   max: 8,    step: 1 },
    { id: 'depth',         label: 'Depth', kind: 'signal', min: 0,   max: 1,    step: 0.01 },
  ],
  distortion: [
    { id: 'distortion', label: 'Drive', kind: 'number', min: 0, max: 1, step: 0.01 },
    { id: 'oversample', label: 'OS',    kind: 'enum',   values: ['none', '2x', '4x'] },
  ],
  bitcrusher: [
    { id: 'bits', label: 'Bits', kind: 'signal', min: 1, max: 16, step: 1 },
  ],
  widener: [
    { id: 'width', label: 'Width', kind: 'signal', min: 0, max: 1, step: 0.01 },
  ],
}
