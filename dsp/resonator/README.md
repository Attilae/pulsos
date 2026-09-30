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
npm run build:resonator        # downloads the pinned wasi-sdk once into .toolchain/
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

- Native vs wasm on arm64 macOS: bit-identical in all five scenarios in
  `scripts/lib/resonatorScenarios.js`, including model switches, panic, and
  0/1 parameter extremes.
- Artifact: 61,216 bytes.
- Tuning is within ±10 cents at 44.1, 48 and 96 kHz host rates.
- Scheduled onsets land within ±0.25 ms of their timestamp
  (`test/resonator-worklet.test.js`).
- Chrome desktop (dev server, 44.1 kHz): all three models play through the lane
  mixer next to the true-peak limiter worklet, and stop and restart work.
- Not yet measured: Firefox, Safari, iPhone, Android, multi-lane load and
  10-minute runs, Song Chainer crossfades. The default of two voices is
  provisional until that data exists and someone has listened.
