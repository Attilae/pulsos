# Phase 7 validation: phone automation

## Build and behavior

- `npm test`: 648 passed, zero failures. New pure tests cover authored zero/hash defaults,
  source-grid placement, padded coordinate conversion, hit columns, bounded point nudges,
  immutable point edits, shared keyboard behavior and independent subloop timing with an exclusive end.
- `npm run build`: passed.
- Production-browser checks used touch-enabled Chrome at 390×844, plus 320px, 820px and
  1440×900 layouts. Account/preset endpoints were mocked; audio and engine handlers were real.
- Adding/removing automation, session-only source choices, grouped targets, speed/glide resets,
  inherited source loops, explicit loop edits and Reset to source all reached autosave.
- Real touch taps, pointer-down/vertical drag, all four ±5%/±1% buttons, keyboard limits, stop selection
  and visible point resets were checked. Values survived save/reload and appeared on desktop;
  desktop target/keyboard edits returned to the phone correctly.
- Armed controls lock while stopped. During playback Tone attack and Mix cutoff values changed,
  and volume automation locked the sheet level and the list fader. Stopping restored manual
  values. Pan/reset and send locks also applied, and clearing the source released the lock.
  Three open/close cycles each restored the shared ticker subscriber baseline.
- Inactive Poly voice, Texture model and filter model notices were checked with saved targets.
  Switching Basic → FM re-armed modulation index; switching Classic → Analog locked drive,
  and switching back restored its inactive notice.
- New sheet controls met the 44px touch target floor. Light/dark layouts had no horizontal overflow or uncaught page errors. Source lanes retain
  their audible/editable controls and carry a Data badge, following current engine behavior.

## Performance comparison

Base: `develop` at `5558a92` (Phase 6 merged). Both production builds used the same environment,
Chrome executable and machine. Runs were sequential, with CPU throttled to 4×.

Desktop used the existing `scripts/perf_bench.mjs --lanes 6 --cpu 4 --runs 3` benchmark,
adapted only to resolve temporary Playwright and the installed Chrome. Each sample was 10 seconds.
Phone samples used a fixed six-lane Budapest snapshot (M1–M4, D14 and tram 1), three automation
curves on M1 (attack from M2, cutoff from M3 and pan from M4), and 8 seconds per view across
three reloads. Every phone run explicitly asserted six enabled lanes before sampling. The same
snapshot ran on the base, which has no Auto segment or live phone mirror.
The map module was loaded once for its ticker diagnostic, then hidden during samples.

| Build / view | FPS | Frame p95 | Long frames | Median mean audio capacity | Max audio capacity | Shared ticker subscribers |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Base desktop | 60 | 17 ms | 0 | 8.7% | 14.3% | n/a |
| Phase 7 desktop | 60 | 17 ms | 0 | 8.8% | 13.2% | n/a |
| Base phone, closed | 60 | 17 ms | 1 | 7.60% | 11.59% | 0 |
| Phase 7 phone, closed | 60 | 17 ms | 0 | 7.01% | 10.28% | 0 |
| Base phone, Tone | 60 | 17 ms | 0 | 7.64% | 11.26% | 0 |
| Phase 7 phone, Tone | 60 | 17 ms | 0 | 6.40% | 9.72% | 1 |
| Phase 7 phone, Auto | 60 | 17 ms | 0 | 6.26% | 9.13% | 1 |

Desktop's largest frame was 33 ms on base and 17 ms on Phase 7. Phone base had one 50 ms frame
with 13 ms blocking time in the closed-sheet samples; all other phone frame maxima were 17 ms
and had no long-frame blocking. The table sums long-frame counts across the three runs.
Audio capacity is noisy on a shared machine;
these results show no measured regression, not an audio optimization. Desktop/phone fixtures
differ, so their audio percentages should only be compared within each pair.

Raw samples: [mobile-parity-phase7-perf.json](mobile-parity-phase7-perf.json).
No extra phone map markers were enabled. Existing source polylines remain available.

## Audio and release check

With automation armed and six lanes explicitly enabled, sound diagnostics reported six audible
lanes and a nonzero -33.4 dBFS peak. Human listening on phone hardware remains required;
automated signal and UI checks do not establish perceived sound quality.
