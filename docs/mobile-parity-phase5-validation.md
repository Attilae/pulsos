# Phase 5 validation: FX buses and master

Validated on a production build with headless Chrome, touch enabled at 390×844, plus
320px, 820px and 1440×900 layouts. Account, entitlement and preset endpoints used in-memory
fixtures; audio decoding, playback, downloads and master DSP used the real browser engine.

## Automated checks

- `npm test`: 639 passed, zero failures.
- `npm run build`: passed.
- `git diff --check`: passed for Phase 5 files.
- New removal tests cover drums, stale sends, colon-containing route IDs, immutable matrix
  updates and selective invalidation of removed-send automation.

## Browser checks

- More closes before Mixer opens. FX view starts no master meter interval.
- All 14 bus cards expand and fit the phone viewport. Shared desktop cards remain usable.
- Sync disables the relevant raw parameter and its reset. Free restores editing; parameter
  resets restore bus defaults. Return level, mute, master volume and mastering edits autosave.
- Master values survive reload and appear on desktop. Individual and full resets work.
- The Master section adds one 100 ms interval. Close, FX view and mastering Off remove it;
  reopening does not accumulate intervals.
- Free custom IR loading opens the upgrade dialog without opening a file chooser. Pro loads
  a generated WAV through the real decoder. A saved Custom selection is retained disabled on
  Free; resetting the IR removes that option. Uploaded buffers remain session-only, matching desktop.
- Removing a soloed bus clears its solo flag, transit/drum sends and its automation targets.
  Unrelated inactive automation targets remain intact.
- Light/dark layouts inspected; no horizontal page overflow or uncaught page errors.

## Audio evidence and remaining release check

Real drum playback reached -13.0 dBFS peak in sound diagnostics. The master bus reported
-4.8 dB glue gain reduction with the true-peak worklet active (228 samples limiter latency).
These measurements confirm signal flow and processing, not perceived sound quality.
Human listening on phone hardware remains a release check.
