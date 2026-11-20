# Phase 8 validation: Activity, reference loop and tour

## Automated checks

- `npm test`: 649 passed, zero failures. A new pure test verifies that tour focus companions
  belong to one modal panel and clean up without disturbing another overlay.
- `npm run build`: passed.
- `npm run sync:agents -- --check`: passed after regenerating AGENTS.md from CLAUDE.md.

## Production-browser checks

Chrome ran with touch enabled at 390×844, plus 320px, 820px and 1440×900 layouts. Account,
preset and reference-library endpoints were mocked. The WAV fixture was generated locally;
its browser decoding, waveform peaks, playback and existing audio engine were real.
No real account uploads or deletions were performed.

- Activity opens after More closes, shows an empty state before playback, then displays the
  latest 24 real note events. Light/dark layouts wrap long station names without overflow.
- A restored account loop decodes into the shared phone waveform. Its playhead moves during
  playback and the ticker count returns to baseline after closing or opening Activity.
- Reference start/volume edits, visible resets, bars, Match BPM and WAV inclusion reach the
  existing autosave path and survive reload. Stored-loop names wrap at 320px.
- Deleting a mocked account copy retains device playback and reveals the device-only note.
  A full Free library shows the plan-limit message before any Blob upload request.
- The phone tour opens all five lane segments and Mixer, supports Back, keeps keyboard focus
  usable with open sheets, completes and restores the previous map view. Escape preserves
  a user-opened lane sheet and its original Mix tab; normal Escape works after the tour ends.
- Desktop keeps the shared EventLog, waveform and compact controls. The rack tour opens the
  first rack for its instrument steps and closes it on cancellation. Empty songs get an
  Add line tour step instead of unavailable lane editors.
- A simulated iPhone user agent verified the first-run notice and its seen/audio-unlock action.
- Measured reference, sheet-close and tour-close controls meet the 44px target floor. No horizontal page/sheet overflow or uncaught
  page errors occurred in the checked layouts.

## Release check

This phase adds no audio engine or persistence format. Human listening on phone hardware
remains the release check carried forward from the sound-related parity phases.
