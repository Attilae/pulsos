# Vendored Clouds DSP

The Clouds granular layer's DSP (`NEXT_PUBLIC_GRANULAR_ENGINE=clouds`). Only
the files the granular grain player needs are vendored: `Grain`, `AudioBuffer`,
the resource tables and the stmlib helpers they include. `granular_processor.cc`
is **not** vendored — it pulls in the phase vocoder, WSOLA, looper and the
hardware `debug_pin.h`. The Leið scheduler in `dsp/clouds/bridge.cc` is derived
from `clouds/dsp/granular_sample_player.h` at the revision below instead (see
that file's header for what changed and why).

| Upstream | Revision | Licence | Path here |
| --- | --- | --- | --- |
| [pichenettes/eurorack](https://github.com/pichenettes/eurorack) | `08460a69a7e1f7a81c5a2abcc7189c9a6b7208d4` (2023-08-16) | MIT (STM32F projects) | `src/clouds/` |
| [pichenettes/stmlib](https://github.com/pichenettes/stmlib) | `e3bd7c9cc00e4364166f9905c0509b6ffd0535ec` (2023-05-30, the submodule revision pinned by the eurorack commit) | MIT | `src/stmlib/` |

The same revisions as `vendor/rings`; the stmlib files both use are
byte-identical. Copyright Emilie Gillet. The licence notices are in
`LICENSE-eurorack.txt` and `LICENSE-stmlib.txt`, and on the app's `/licenses`
page. Per upstream's guidelines for derivative works, the app does not use the
Mutable Instruments product name for the feature.

`manifest.json` records the SHA-256 of every vendored file.
`scripts/build_clouds.js` refuses to build if a file differs from it.

## Local patches

None. The files are byte-identical to upstream. If a patch is ever needed, set
`patched: true` and `patchedSha256` on the file in `manifest.json` and describe
the change here.

Portability comes from build flags only: `-DTEST` selects upstream's portable
math paths instead of ARM inline assembly.
