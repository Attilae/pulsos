# Impulse Response Attribution

All impulse response files in this directory are derived from the
[Open Acoustic Impulse Response (OpenAIR) Library](https://www.openair.hosted.york.ac.uk/),
University of York, and are licensed under
[Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/).

All files are the stereo (ORTF or stereo-pair) versions of each space.

**Changes made:** `room`, `church`, `sportshall`, `reactor`, `minster` and
`mausoleum` were resampled to 48 kHz and saved as 24-bit WAV. Their tails were
trimmed where the energy decay falls 60 dB below the start of the file, and each
ends with a 250 ms fade-out. The file names differ from the originals.
`cathedral` and `warehouse` are unchanged.

The OpenAIR website was offline when the six newer files were added (September
2026). They were taken from audEERING's mirror of the library,
[`openair` 1.0.0](https://audeering.github.io/datasets/datasets/openair.html), which
also lists the dataset as CC BY 4.0. Their credits come from archived OpenAIR room
pages. Those older pages list Creative Commons Attribution-ShareAlike for most of
these rooms, and Public Domain for St. George's.

| File             | Space                             | Original file                                   | Credits                                                                                                                      |
| ---------------- | --------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `room.wav`       | Terry's Typing Room, York         | `terrys_typing_ortf.wav`                        | www.openairlib.net; Audiolab, University of York; Dr. Damian T. Murphy                                                       |
| `church.wav`     | St. George's Episcopal Church     | `st_georges_medium.wav`                         | www.openairlib.net; Adam Townsell                                                                                            |
| `cathedral.wav`  | Lady Chapel, St Albans Cathedral  | (see OpenAIR page_id=595)                       | www.openairlib.net; Audiolab, University of York; Marcin Gorzel; Gavin Kearney; Aglaia Foteinou; Sorrel Hoare; Simon Shelley |
| `sportshall.wav` | Sports Centre, University of York | `sportscentre_ortf.wav`                         | www.openairlib.net; Audiolab, University of York; Aglaia Foteinou; Simon Shelley                                             |
| `reactor.wav`    | R1 Nuclear Reactor Hall, Stockholm | `r1_ortf-48k.wav`                              | www.openairlib.net; Audiolab, University of York; Dr. Damian T. Murphy                                                       |
| `minster.wav`    | York Minster                      | `minster1_000_ortf_48k.wav`                     | www.openairlib.net; Audiolab, University of York; Damian T. Murphy                                                           |
| `warehouse.wav`  | Terry's Factory Warehouse, York   | (see OpenAIR page_id=735)                       | www.openairlib.net; Audiolab, University of York; Dr. Damian T. Murphy                                                       |
| `mausoleum.wav`  | Hamilton Mausoleum, Scotland      | `hm2_000_ortf_48k.wav`                          | www.openairlib.net; Audiolab, University of York; Damian T. Murphy                                                           |
