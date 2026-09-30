# Resonator DSP

`bridge.cc` is a small C ABI over the vendored Rings DSP (`vendor/rings`).
It holds a pool of up to four monophonic `rings::Part`s, renders fixed
24-sample blocks at 48 kHz, and has no imports and no allocation.
`reference.cc` is a native renderer for the same code.

## Rebuilding

The built module is committed (`public/wasm/resonator-<sha8>.wasm` plus
`resonator.manifest.json`, and the generated `lib/resonatorAsset.js`), so normal
app builds never compile C++. Rebuild only after changing `bridge.cc` or the
vendored sources:

```bash
npm run build:resonator        # downloads the pinned wasi-sdk once into dsp/.toolchain/
node scripts/build_resonator.js --check   # fails if committed assets don't match sources
npm run compare:resonator      # native vs wasm, writes WAVs to .build/renders/
npm test                       # resonator-dsp / -worklet / -plan tests use the wasm
```

The toolchain is wasi-sdk 34 (clang 23), with SHA-256 digests pinned per host in
the build script. The plan originally named Emscripten; wasi-sdk was chosen
because the module has to instantiate inside an AudioWorklet with no JS glue.
`WASI_SDK_PATH` points the build at a local install instead of downloading.

## Measurements (2026-09-30)

Measured on an Apple Silicon Mac with Node 24 (V8, the same wasm engine as Chrome):

| Model | 1 voice | 2 voices | 4 voices |
| --- | --- | --- | --- |
| Modal | 0.49 % | 0.80 % | 1.58 % |
| Sympathetic | 0.47 % | 0.88 % | 1.76 % |
| String | 0.23 % | 0.48 % | 0.87 % |

Values are the share of one core, with a strike 8 times per second. Voices idle
below −90 dBFS stop rendering, so real lanes cost less than this.

- Native vs wasm on arm64 macOS: bit-identical in all scenarios in
  `scripts/lib/resonatorScenarios.js`, including model switches, panic,
  0/1 parameter extremes, and (since 2026-10-01) the enveloped/bowed ones.
- Artifact: 65,073 bytes (61,216 before the envelope).
- Tuning is within ±10 cents at 44.1, 48 and 96 kHz host rates.
- Scheduled onsets land within ±0.25 ms of their timestamp
  (`test/resonator-worklet.test.js`).
- Chrome desktop (dev server, 44.1 kHz): all three models play through the lane
  mixer next to the true-peak limiter worklet, and stop and restart work.
- Not yet measured: Firefox, Safari, iPhone, Android, multi-lane load and
  10-minute runs, Song Chainer crossfades. The default of two voices is
  provisional until that data exists and someone has listened.

## Envelope and bow (2026-10-01)

`rs_set_envelope(enabled, attack, decay, sustain, release, bow, strike)` turns on
an ADSR per voice; `rs_trigger_held(note, velocity, holdSamples)` strikes a note
that releases after `holdSamples` (`rs_trigger` holds until `rs_release(note)`,
where a negative note releases every voice). While a voice's envelope is open it
feeds `bow × kBowGain[model] × velocity × env × noise` into its `Part` in place
of silence, and its output is multiplied by `env`. Attack is linear, decay and
release are exponential (−60 dB over the set time), and a released voice that
falls below −80 dB is reset so its next note starts clean.

- **Off is bit-identical.** Every pre-envelope scenario renders to the same bytes
  as the build before this change, and `test/resonator-dsp.test.js` pins that
  setting the envelope off changes nothing.
- **Per-voice mode.** A voice keeps the mode it was struck in, so turning the
  envelope on or off never re-levels a sounding note, and `rs_release` never
  cuts a voice struck without it.
- **`kBowGain` calibration** (default patch, one voice, MIDI 57, bow 1, sustain 1,
  strike off): sustained RMS 0.051 / 0.091 / 0.063 for modal / sympathetic /
  string against a strike's first-half-second RMS of 0.046 / 0.090 / 0.016. The
  gains are `{ 0.15, 0.06, 0.15 }`; the string model is left a little louder
  because its strike dies away much faster.
- **CPU** (same method as the table above, notes held 0.25 s at 8 per second, bow
  0.7): modal 0.39 / 0.80 / 1.55 %, sympathetic 0.46 / 0.92 / 1.88 %, string
  0.23 / 0.45 / 0.96 % for 1 / 2 / 4 voices. Per voice it's the same cost as a
  strike; bowed voices simply stay busy until they're released.

