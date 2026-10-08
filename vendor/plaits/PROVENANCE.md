# Vendored Plaits DSP

The Macro instrument's DSP. Only the voice, its 24 engines, their DSP
dependencies and the generated resources are vendored. The firmware's drivers,
UI, settings, bootloader, user-data receiver and the resource generator scripts
are not.

| Upstream | Revision | Licence | Path here |
| --- | --- | --- | --- |
| [pichenettes/eurorack](https://github.com/pichenettes/eurorack) | `08460a69a7e1f7a81c5a2abcc7189c9a6b7208d4` (2023-08-16) | MIT (STM32F projects) | `src/plaits/` |
| [pichenettes/stmlib](https://github.com/pichenettes/stmlib) | `e3bd7c9cc00e4364166f9905c0509b6ffd0535ec` (2023-05-30, the submodule revision pinned by the eurorack commit) | MIT | `src/stmlib/` |

These are the same revisions as `vendor/rings` and `vendor/clouds`.

Copyright Emilie Gillet. The licence notices are in `LICENSE-eurorack.txt` and
`LICENSE-stmlib.txt`. Per upstream's guidelines for derivative works, the
instrument is called "Macro" in the app and neither the Mutable Instruments name
nor the module's name is used there.

`manifest.json` records the SHA-256 of every vendored file.
`scripts/build_macro.js` refuses to build if a file differs from it. The file
list is the include closure of `plaits/dsp/voice.cc` plus every `.cc` it links
against, computed with the host compiler's `-MM`.

## Local patches

None. The files are byte-identical to upstream. If a patch is ever needed, set
`patched: true` and `patchedSha256` on the file in `manifest.json` and describe
the change here.

Portability comes from build flags only:
- `-DTEST` selects upstream's portable math paths, the switch its own desktop
  test build uses, instead of ARM inline assembly.
- `-include stdio.h` is needed because in TEST mode `plaits/user_data.h` mocks
  the flash writer with `printf` without including `<stdio.h>`. The mock is
  never called; `UserData::ptr()` returns null under TEST, so every engine uses
  its built-in data.

## The 6-op FM patch banks

`plaits/resources.cc` includes `fm_patches_table`: three banks of 32 DX7-format
voices that engines 2–4 load. Upstream's generator
(`plaits/resources/fm_patches.py`, not vendored) picks them from SysEx
cartridge dumps, including Yamaha's factory ROM1A–ROM4B and several
third-party and user banks. Their redistribution terms aren't stated upstream
beyond the repository's MIT licence. Confirming them is a release gate in
`docs/plaits-macro-plan.md`. If they can't be cleared, the fallback is to ship
without engines 2–4.
