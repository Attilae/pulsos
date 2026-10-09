# Vendored DaisySP LadderFilter

The Analog lane filter's DSP (`trackFilters[id].model = 'daisy-ladder'`). Only
the files the ladder filter needs are vendored: `Source/Filters/ladder.h`,
`Source/Filters/ladder.cpp` and the `Source/Utility/dsp.h` helpers it includes.
Neither DaisySP-LGPL nor the older `moogladder` module is vendored.

| Upstream | Revision | Licence | Path here |
| --- | --- | --- | --- |
| [electro-smith/DaisySP](https://github.com/electro-smith/DaisySP) | `2c72eaf9eac5fc0dca1919d65d606da907832618` (2026-09-28) | MIT | `src/Source/` |

`ladder.h`/`ladder.cpp` are a port of the Teensy Audio Library ladder filter:
copyright (c) 2021 Richard van Hoesel, (c) 2024 Infrasonic Audio LLC, MIT, with
the notice kept in each file's header (upstream asks that the header be
retained). `dsp.h` is copyright (c) 2020 Electrosmith, Corp and Emilie Gillet.
The repository licence is in `LICENSE-daisysp.txt`, and the attribution is on
the app's `/licenses` page.

`manifest.json` records the SHA-256 of every vendored file.
`scripts/build_ladder.js` refuses to build if a file differs from it.

## Local patches

None. The files are byte-identical to upstream. If a patch is ever needed, set
`patched: true` and `patchedSha256` on the file in `manifest.json` and describe
the change here.

Two upstream portability notes, handled outside the vendored files:

- `LadderFilter::Init` calls `SetPassbandGain`, which reads `drive_` before
  `Init`'s own `SetInputDrive` assigns it. `dsp/ladder/bridge.cc`
  value-initialises every filter object (`f = LadderFilter{}`) before `Init`, so
  that read is a zero rather than indeterminate.
- `ProcessBlock` carries GCC's `__attribute__((optimize("unroll-loops")))`.
  clang ignores it (`-Wno-unknown-attributes` in the build), and the bridge
  never calls `ProcessBlock` anyway: it processes per sample so parameters can
  change inside a block. `dsp.h`'s `fmax`/`fmin` use their portable branch
  (`__arm__` is not defined for wasm32 or the host reference build).
