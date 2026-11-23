# Drum Sample Attribution

> **Placeholder kit.** These are stand-in samples for the **Drums** synth type
> (each track = one drum voice); they are intended to be swapped for a final kit
> later. To replace, drop new files into `cc-kit/` (keeping the same filenames)
> and update this file.

## `cc-kit/` — TR-808 (CC0 / public domain)

All files in `cc-kit/` are from Michael Fischer's **Roland TR-808 Rhythm Composer
Sound Sample Set 1.0.0** (1994), released into the public domain ("ABSOLUTELY
FREE", no attribution required). Distributed via the
[tidalcycles/sounds-tr808-fischer](https://github.com/tidalcycles/sounds-tr808-fischer)
and [tidalcycles/Dirt-Samples](https://github.com/tidalcycles/Dirt-Samples)
(`808*` folders) repositories under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).

| File          | Voice            | Source (Dirt-Samples) |
| ------------- | ---------------- | --------------------- |
| `kick.wav`    | Bass drum        | `808bd/BD5000.WAV`    |
| `snare.wav`   | Snare            | `808sd/SD0010.WAV`    |
| `hihat.wav`   | Closed hi-hat    | `808hc/HC00.WAV`      |
| `openhat.wav` | Open hi-hat      | `808oh/OH75.WAV`      |
| `crash.wav`   | Crash cymbal     | `808cy/CY0000.WAV`    |
| `tom-lo.wav`  | Low tom          | `808lt/LT00.WAV`      |
| `tom-mid.wav` | Mid tom          | `808mt/MT00.WAV`      |
| `tom-hi.wav`  | Hi tom           | `808ht/HT00.WAV`      |

## `808/` — the Drum Machine's "808 samples" kit (CC0 / public domain)

One file per pad of the six-pad kit (`lib/drumKit.js`, kit `tr808`). Same
source and licence as `cc-kit/`: Michael Fischer's **Roland TR-808 Rhythm
Composer Sound Sample Set 1.0.0** (1994), taken from
[tidalcycles/sounds-tr808-fischer](https://github.com/tidalcycles/sounds-tr808-fischer)
(licence: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/), in that
repository's `LICENSE`). Files are unedited (16-bit mono, 44.1 kHz).

In Fischer's names the two digit pairs are the 808's knob positions: `BD2550` is
bass drum Tone 25 / Decay 50, `SD2550` snare Tone 25 / Snappy 50, `CY5050`
cymbal Tone 50 / Decay 50.

| File        | Pad   | Source (sounds-tr808-fischer) |
| ----------- | ----- | ----------------------------- |
| `kick.wav`  | Kick  | `bd8/BD2550.WAV`              |
| `snare.wav` | Snare | `sd8/SD2550.WAV`              |
| `hat.wav`   | Hat   | `ch8/CH.WAV` (closed hi-hat)  |
| `rim.wav`   | Rim   | `rs8/RS.WAV` (rimshot)        |
| `ride.wav`  | Ride  | `cy8/CY5050.WAV` (cymbal; the 808 has no ride) |
| `clap.wav`  | Clap  | `cp8/CP.WAV`                  |
