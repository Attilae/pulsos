# Vendored Rings DSP

The Resonator instrument's DSP. Only the files the three exposed resonator
models need are vendored; drivers, UI, bootloader and the string-synth/FM
"bonus" paths' UI code are not.

| Upstream | Revision | Licence | Path here |
| --- | --- | --- | --- |
| [pichenettes/eurorack](https://github.com/pichenettes/eurorack) | `08460a69a7e1f7a81c5a2abcc7189c9a6b7208d4` (2023-08-16) | MIT (STM32F projects) | `src/rings/` |
| [pichenettes/stmlib](https://github.com/pichenettes/stmlib) | `e3bd7c9cc00e4364166f9905c0509b6ffd0535ec` (2023-05-30, the submodule revision pinned by the eurorack commit) | MIT | `src/stmlib/` |

Copyright Emilie Gillet. The licence notices are in `LICENSE-eurorack.txt` and
`LICENSE-stmlib.txt`, and on the app's `/licenses` page. Per upstream's
guidelines for derivative works, the instrument is called "Resonator" in the app
and the Mutable Instruments name is not used.

`manifest.json` records the SHA-256 of every vendored file.
`scripts/build_resonator.js` refuses to build if a file differs from it.

## Local patches

None. The files are byte-identical to upstream. If a patch is ever needed, set
`patched: true` and `patchedSha256` on the file in `manifest.json` and describe
the change here.

Portability comes from build flags only: `-DTEST` selects upstream's portable
math paths (the switch its own desktop test build uses) instead of ARM inline
assembly.
