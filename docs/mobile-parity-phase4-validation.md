# Mobile parity Phase 4 verification

Verified on 2026-11-18, on `feature/mobile-parity-phase4`.

## Functional checks

- `npm test`: 636 passed. New pure tests cover source/relative-index inversion at every
  offset, 16-step playback timing, source pages and wraparound, legacy velocity cycling,
  drum diagnostics, and empty modern selections versus legacy snapshot recovery.
- `npm run build`: passed.
- Headless Chrome, 390×844 with touch: master/pad mute, all four velocity levels and source
  pages, nonzero/wrapping offsets, volume/filter/send edits, autosave/reload, and drum-only
  saved songs. Controls meet the 44px floor and fit in light and dark themes.
- Drum Machine clipboard sync works both ways, including changed offsets. Removing Map drums
  retains the clipboard; re-import restores the authored pattern and resets master mute.
- At 1440×900, desktop step edits affect the same source slots and velocities. At 820px and
  390px there was no horizontal overflow. No page errors occurred.
- While playing, Pads adds exactly one ticker subscriber; Mix and close restore the baseline.
  Repeated open/close/tab cycles leak no subscribers, and stopped cursors/page markers clear.
- Drum-only playback produced a measured output peak around −22 dBFS. This is signal
  verification, not subjective listening; phone-hardware listening remains pending.

Account, storage and entitlement endpoints were mocked. No real account songs were created.

## Performance method

The metrics collector from `scripts/perf_bench.mjs` was run through a temporary adapter that
selects installed Chrome, fixes the song fixture, supports the phone viewport and opens the
new drum sheet. It preserves the script's CDP WebAudio render-capacity sampling and animation
frame/Long Animation Frame measurements.

Baseline: a separate production build of `develop` at `e973e314428cac057632411a7d4fcf897ad69ff8`.
The feature build also contains the pending Phase 3 UI changes. Both builds use the same
local environment and dependencies.

Each case uses 4× main-thread CPU throttling and 10-second samples after warm-up.
The desktop and closed-phone cases have three independent completed samples each; the
open-sheet case has one completed sample. The workload is 120 BPM, six enabled Synth transit lanes (four metro plus two tram), and the same
six-pad drum pattern. Pads have different offsets, including a window wrapping from slot
64 to slot 1. The drum reverb send is 15%. Desktop is 1440×900; phone is 390×844 with touch.
The open-sheet case uses the default source page, 49–64. No other browser tests or builds
ran concurrently with these measurements.

Results below report median FPS/p95 and the range of each run's mean audio-render capacity.
They describe steady playback on this machine, not an assurance about physical phone hardware.


| Build / view | Completed runs | Median FPS | p95 frame time | Audio render load: range of run means | Long frames, total |
| --- | ---: | ---: | ---: | ---: | ---: |
| develop, desktop | 3 | 60 | 17 ms | 30.8–33.7% | 0 |
| Phase 4, desktop | 3 | 60 | 17 ms | 28.8–32.6% | 1 |
| develop, phone | 3 | 60 | 17 ms | 28.0–29.2% | 0 |
| Phase 4, phone, sheet closed | 3 | 60 | 17 ms | 28.9–32.0% | 0 |
| Phase 4, phone, Pads open | 1 | 60 | 17 ms | 30.5% | 0 |

Audio render load is the fraction of the audio deadline consumed (lower is better).
The single Phase 4 desktop Long Animation Frame was 62 ms; measured blocking time was
zero in every completed sample. No steady frame-time regression appeared in these samples.
The audio ranges vary between runs; no DSP performance improvement is claimed.

Additional open-sheet attempts completed measurement but stalled at Chrome process shutdown,
even after stopping playback, detaching the audio inspector and closing the page. Those
attempts are excluded from the table because they did not produce a completed result record.
The open-editor performance evidence is consequently limited to one completed sample. The
functional ticker subscription/cleanup tests passed separately.
