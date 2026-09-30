# Clouds granular DSP

`bridge.cc` is a small C ABI over the vendored Clouds grain code
(`vendor/clouds`): one lane's granular layer per module instance, a static
(frozen) mono source of up to 4 s held forwards and reversed, and a grain
scheduler derived from upstream's `GranularSamplePlayer`. It renders fixed
32-sample blocks at 32 kHz, has no imports and does not allocate.
`reference.cc` is a native renderer for the same code.

It is selected with `NEXT_PUBLIC_GRANULAR_ENGINE=clouds` (see
`lib/granularEngine.js`). The default, `grainplayer`, keeps the original
`Tone.GrainPlayer` layer (`lib/granularVoice.js`), which is unchanged.

## Rebuilding

The built module is committed (`public/wasm/clouds-granular-<sha8>.wasm` plus
`clouds-granular.manifest.json`, and the generated `lib/cloudsGranularAsset.js`),
so normal app builds never compile C++. Rebuild only after changing `bridge.cc`
or the vendored sources:

```bash
npm run build:clouds          # downloads the pinned wasi-sdk once into dsp/.toolchain/
node scripts/build_clouds.js --check   # fails if committed assets don't match sources
npm run compare:clouds        # native vs wasm, writes WAVs to .build/renders/
npm test                      # clouds-granular-dsp / -worklet and granular-engine tests
```

The toolchain (wasi-sdk 34) is shared with the Resonator build through
`scripts/lib/wasiSdk.js`.

## Parameter mapping

`lib/granularEngine.js` (`cloudsParamsFromGranular`) turns the saved granular
settings into DSP values. Saved songs are unchanged; only the sound differs.

| Leið setting | Clouds engine |
| --- | --- |
| `grainSize` | Grain length in samples (not the hardware knob, whose 32 ms floor would clamp short grains). |
| `overlap` | Target overlapping-grain count `2 × (1 + overlap / grainSize)`, capped at 32. A starting calibration, not an audited perceptual match. |
| `playbackRate` | Scan-head speed through the window, independent of pitch. |
| `loopStart`/`loopEnd` | Bounded source window; grains never read outside it or past the source end. |
| `reverse` | Reads a reversed copy of the source with the window mirrored. |
| `jitter` | Per-grain random position within ± jitter × window, and switches seeding from upstream's deterministic clock to its probabilistic mode. |
| `mix`, `attack`, `release` | Unchanged: the layer's outer envelope and gain on the main thread. |
| note pitch | Grain pitch in semitones from the C4 render; each note also seeds one grain at its timestamp. |

Fixed for now: window shape 0.75 (upstream TEXTURE ≈ 0.56) and stereo spread
0.5. No diffuser, reverb or feedback yet.

## Measurements (2026-09-30)

On an Apple Silicon Mac with Node 24 (V8):

- Native vs wasm on arm64 macOS: bit-identical in all six scenarios in
  `scripts/lib/cloudsScenarios.js`.
- Artifact: 34,534 bytes. About 1 MB of linear memory per lane.
- About 0.1 to 0.15 % of one core per lane, including 48 kHz resampling.
- At default settings the output RMS is about 0.93× the source RMS, so the
  layer uses GrainPlayer's -6 dB base level unchanged. Jitter > 0 (probabilistic
  seeding) is about 3 to 4 dB quieter.
- Note pitch within ±15 cents; note onsets within ±0.5 ms (block
  quantization) at 44.1, 48 and 96 kHz.
- Not yet measured: any browser, phones, multi-lane load, and a listening A/B
  against GrainPlayer.
