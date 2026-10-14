# Vendored Beads DSP

Texture Mk II's DSP, the second model of the Texture insert (see
`docs/texture-mk2-plan.md`). Only the files `beads::Processor` needs in its
granular and delay modes are vendored: the processor, its grain, delay and
trigger engines, the reverb and wow/flutter effects, the resource tables and
the stmlib helpers they include. Hardware files (`beads.cc`, the drivers, the
UI, CV reading, gain control, settings) and the wavetable synth mode
(`synth.cc`, `wavetable_*`) are **not** vendored. `dsp/beads/bridge.cc`
re-creates the part of `beads.cc` and `cv_reader.h` that turns a panel into
the processor's inputs; see that file's header.

| Upstream | Revision | Licence | Path here |
| --- | --- | --- | --- |
| [pichenettes/eurorack](https://github.com/pichenettes/eurorack) | `d8f473915232af74347762b6365202bfd26f73f6` (2026-10-11, "Beads code/sch") | MIT (STM32F projects) | `src/beads/` |
| [pichenettes/stmlib](https://github.com/pichenettes/stmlib) | `e3bd7c9cc00e4364166f9905c0509b6ffd0535ec` (2023-05-30, the submodule revision pinned by the eurorack commit) | MIT | `src/stmlib/` |

The stmlib revision is the same as `vendor/clouds`, `vendor/plaits` and
`vendor/rings`; every stmlib file they share is byte-identical. Copyright
Emilie Gillet. The licence notices are in `LICENSE-eurorack.txt` and
`LICENSE-stmlib.txt`, and on the app's `/licenses` page. Per upstream's
guidelines for derivative works, the app does not use the Mutable Instruments
or module name for the feature ("Texture Mk II").

Upstream's README says the Beads code "builds on a Desktop platform but not
verified to build and run on a module". Nothing here depends on the module:
the build uses the same desktop (`-DTEST`) path as upstream's own test harness
(`beads/test/`).

`manifest.json` records the SHA-256 of every vendored file.
`scripts/build_beads.js` refuses to build if a file differs from it.

## Local patches

None. The files are byte-identical to upstream. If a patch is ever needed, set
`patched: true` and `patchedSha256` on the file in `manifest.json` and describe
the change here.

Portability comes from build flags only: `-DTEST` selects upstream's portable
math paths instead of ARM inline assembly, and `-DNDEBUG` drops
`delay_line.h`'s asserts.
