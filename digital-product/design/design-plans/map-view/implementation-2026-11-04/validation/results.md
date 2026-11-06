# Phase 0 baseline: map view

5 November 2026 · code at `7ec8c80` (feature/map-exploring fast-forwarded to the plan's baseline) · no product code changed.

Status: **Phase 0 baseline done; Phase 1 and Phase 2 results added at the end.** Remaining gaps are listed under "Not yet done" and in the Phase 1 section.

## Environment

| Item | Value |
| --- | --- |
| Hardware | Apple M4 Pro, 24 GB, built-in Retina 3024×1964 |
| OS / browser | macOS (Darwin 25.3.0) · Google Chrome 156.0.8078.80, headless, driven by Playwright 1.56.1 |
| Server for screenshots | `next dev` (Next 15.5.28) on :3011, fresh `.next` |
| Server for performance | `npm run build` + `next start --port 3012` (dev server stopped first) |
| Power | Battery at 19% discharging during the first attempt; on charger (100%) by the end of capture. Performance runs must record power state again. |
| Output device / refresh | Performance runs: headed Chrome window on the external 5K main display; `requestAnimationFrame` measured at 100 fps (macOS didn't report the panel's refresh rate). Audio muted with `--mute-audio`; the graph still renders in real time at 44.1 kHz with a 100 ms lookahead. |
| Account | Signed out (Free plan, `activeLanes` 6) |

## Workloads

Built by `build-fixtures.mjs` from the committed city presets (`public/presets/<city>.json`), so they're reproducible from the repository. `capture.mjs` serves a fixture in place of `/presets/<city>.json` and loads it through the app's own "Load city preset" dialog (`MixerTab.applyPreset`).

| Fixture | Lanes on map | Audible | BPM | Lanes |
| --- | --- | --- | --- | --- |
| `berlin-6` | 6 | 6 | 128 | 98, X5, 93 (preset) + U7, U8, U5 |
| `berlin-24` | 24 | 6 | 128 | above + U6 U3 U9 U2 U4 U1 and 12 trams (off) |
| `newyork-6` | 6 | 6 | 92 | A, 3, G (preset) + 2, F, 4 |
| `newyork-24` | 24 | 6 | 92 | above + 18 more subway lines (off) |

Added lanes copy every per-track setting of preset lane `i % 3` (instrument, envelope, filter, arp, granular, sends, loop region…), so the sound load is fixed. Viewport: 1440×900 desktop, 820×1180 tablet (touch), 390×844 phone (mobile, touch). Camera: whatever the app frames on load; nothing pans or zooms.

**24 audible lanes were not measured.** Signed out, the Free plan caps audible lanes at 6. The 24-lane fixtures put 24 routes on the map with 18 of them showing as off previews. Measuring 24 audible lanes needs a Pro or superadmin session.

Reproduce:

```bash
node digital-product/design/design-plans/map-view/implementation-2026-11-04/validation/build-fixtures.mjs
# Playwright installed outside the repo; Chrome must be installed
NODE_PATH=<dir>/node_modules node capture.mjs --url http://localhost:3011/ \
  --fixtures berlin-6,newyork-6,berlin-24 --out screenshots
```

Output (`.gitignore` keeps PNGs and traces out of git): `screenshots/<fixture>_<theme>_<viewport>_{stopped,alloff,playing}.png` (54 files, ~34 MB, **not for commit**), plus `screenshots/probe.json` with the measured boxes of the map, legend, zoom control and attribution, and route path/canvas counts per state.

## Current reproductions (7ec8c80)

All 18 configurations (3 fixtures × 2 themes × 3 viewports) loaded, toggled lanes and played without script failures. The only console error was one `ERR_CONNECTION_REFUSED` per load, most likely the feed/snapshot origin (not running); source not confirmed.

1. **The tablet map is 0×0 at 820px (reproduced, both themes, every fixture).** `.map-container` measures 0×0 at (820, 1180), which is outside the viewport. The legend and zoom control are positioned off-screen with it. The map area renders empty under the header: see `berlin-6_dark_tablet_stopped.png`. This confirms the October `tablet-layout-failure.png` finding, so phase 1's tablet grid fix is justified.
2. **On desktop the zoom control sits on top of the legend.** Both are anchored at (10, 114). The +/− buttons cover the first two legend rows (route names "U7"/"U8" are clipped to "7"/"8"). Reproduced in both themes and both cities.
3. **The desktop legend has no pointer events** (`pointer-events: none`), which matches the plan's phase 2 premise.
4. **The legend grows with lane count and doesn't scroll.** At 24 lanes it's 676px tall inside a 796px map, about 120px from overflowing. It shows 18 "OFF" rows at reduced opacity, with the role badges dimmed along with the text.
5. **In the light theme only the app chrome turns light.** The basemap stays dark (`berlin-24_light_desktop_playing.png`, `berlin-6_light_phone_*`), which confirms that the map isn't theme-aware.
6. **All-off is nearly invisible and gives no guidance.** On the phone in Berlin, the off previews are faint dashed fragments at regional zoom and there's no "enable a lane" message (`berlin-6_light_phone_alloff.png`).
7. **The phone frames a whole region.** Berlin opens at a zoom that shows Neuruppin to Jüterbog, so the routes take up a small central area of the 390×685 map.
8. **Phone attribution collides.** The data attribution (`Data © Verkehrsverbund…`) and Leaflet/OpenFreeMap attribution overlap at the bottom of the map, with the second covering the first.
9. **Desktop route styling is as October described**: wide coloured glows under the routes, and stop dots on every enabled route at city zoom. On desktop the AI Composer panel covers the bottom-right of the map (about 570×390px).
10. **Phone legend is a horizontal strip** of 37px chips above the map, and the layers button covers its right end.

Desktop route rendering: SVG paths (103 in Berlin-6, 233 in NYC-6, 194 in Berlin-24 while playing, 12 with all off). Phone: one Canvas, no SVG paths. No Leaflet DOM markers in any state.

## Performance baseline (desktop, no CPU throttling)

`perf.mjs`, one command: `NODE_PATH=<dir>/node_modules node perf.mjs --trace 1` against `next start`. Each run gets a fresh headed Chrome window, loads the fixture through "Load city preset" and shows the map. It then presses Play, waits **20 s**, resets `window.leidPerf` and its own counters, and measures for **60 s**. Raw results, one JSON line per run including the full `leidPerf.report()`: `perf/desktop_cpu1_2026-11-05T11-34-31.jsonl`.

| Workload | Run | SVG route paths | fps | Frame p50 / p95 / p99 (ms) | Frames >33 ms | LoAF / blocking ms | Audio render capacity mean / p95 / max % | Dropout ms | Late ticks (max ms) | Heap MB | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| berlin-6 | 1* | 103 | 100 | 10 / 10.8 / 11 | 1 | 1 / 137 | 17.1 / 32.6 / 55.5 | 0 | 1 (101) | 97 | late-notes* |
| berlin-6 | 2 | 103 | 100 | 10 / 10.7 / 11 | 0 | 0 / 0 | 15.6 / 26.8 / 39.3 | 0 | 0 | 103 | ok |
| berlin-6 | 3 | 103 | 100 | 10 / 10.7 / 11 | 0 | 0 / 0 | 14.8 / 22.7 / 26.5 | 0 | 0 | 87 | ok |
| berlin-24 | 1* | 139 | 100 | 10 / 10.8 / 11 | 1 | 1 / 166 | 18.6 / 25.7 / 56.8 | 0 | 1 (143) | 121 | late-notes* |
| berlin-24 | 2 | 139 | 100 | 10 / 10.8 / 11 | 0 | 0 / 0 | 17.5 / 25.2 / 27.2 | 0 | 0 | 115 | ok |
| berlin-24 | 3 | 139 | 100 | 10 / 10.9 / 11 | 0 | 0 / 0 | 20.1 / 27.3 / 36.1 | 0 | 0 | 118 | ok |
| newyork-6 | 1* | 233 | 100 | 10 / 10.9 / 11 | 1 | 1 / 102 | 15.7 / 22.1 / 23.6 | 0 | 1 (68) | 52 | late-notes* |
| newyork-6 | 2 | 233 | 100 | 10 / 10.9 / 11 | 0 | 0 / 0 | 15.9 / 22.8 / 27.4 | 0 | 0 | 70 | ok |
| newyork-6 | 3 | 233 | 100 | 10 / 10.9 / 11 | 0 | 0 / 0 | 14.8 / 21.0 / 25.1 | 0 | 0 | 67 | ok |
| newyork-24 | 1* | 269 | 100 | 10 / 10.9 / 11 | 1 | 1 / 117 | 18.3 / 25.8 / 38.2 | 0 | 1 (119) | 57 | late-notes* |
| newyork-24 | 2 | 269 | 100 | 10 / 10.9 / 11 | 0 | 0 / 0 | 20.3 / 38.1 / 70.4 | 0 | 0 | 73 | ok |
| newyork-24 | 3 | 269 | 100 | 10 / 10.9 / 11 | 0 | 0 / 0 | 19.2 / 27.8 / 66.0 | 0 | 0 | 62 | ok |

\* **Run 1 of each workload also records a Performance trace, and starting the trace causes its one stall.** In every trace the only long task (150–215 ms) falls where recording begins. Runs 2–3 have none. **Use runs 2–3 as the baseline** and compare candidates against untraced runs only.

Main-thread cost while the map plays, from the 10 s traces (`traces/`, ~250 MB, gitignored):

| Workload | All rAF callbacks per call p50 / p95 / p99 (ms) | rAF ms per second | Style recalc ms/s | Paint ms/s | Busy main thread ms/s |
| --- | --- | --- | --- | --- | --- |
| berlin-6 | 0.01 / 0.25 / 0.31 | 31.7† | 10.7 | 1.9 | 97.8 |
| berlin-24 | 0.01 / 0.23 / 0.33 | 12.9 | 10.1 | 2.0 | 93.4 |
| newyork-6 | 0.01 / 0.26 / 0.35 | 29.4† | 10.7 | 1.9 | 90.0 |
| newyork-24 | 0.01 / 0.28 / 0.39 | 32.3† | 11.0 | 1.9 | 93.7 |

† Includes the single 150–185 ms trace-start stall, which lands inside a rAF callback. Without it, every workload is about 13 ms/s.

What this baseline says:
- **The current map is cheap on this machine.** Every rAF callback in a frame together (map heads/trails/ripples, the shared ticker, the perf monitor, the benchmark's own frame recorder) costs **p95 ≈ 0.25 ms**, against the plan's ≤2 ms target for map callbacks alone. The main thread is about 9–10% busy. Frames hold 100 fps with p95 under 11 ms, and runs 2–3 have no long frames.
- **Audio has headroom.** Render capacity is 15–20% mean, and no run had a dropout. The occasional p95/max spikes (up to 70% in newyork-24 run 2) didn't cause dropouts or late notes.
- **24 lanes on the map add little.** Berlin's SVG paths go from 103 to 139 and NYC's from 233 to 269 (18 dashed previews). Frame and callback costs don't measurably change. Audio capacity rises 2–4 points, but only 6 lanes are audible in both, so treat that as noise until runs are repeated.
- **Variation between runs:** frame p95 varies by ≤0.2 ms. Audio capacity mean varies by about ±2.5 points and its max by much more, so use the mean and dropout/late counts as gates, not the max.
- **This is an M4 Pro.** These numbers don't tell us how a slow laptop or a phone behaves. The plan's ≤4 ms phone target needs real phone hardware or at least `--viewport phone --cpu 4` runs, recorded separately.

Gate status: the workload is repeatable (fixtures + `capture.mjs` + `perf.mjs`, one command each), and historical findings are labelled separately from current reproductions. **Phase 0 gate met for desktop.**

## Side finding (not map scope)

In `next dev`, a stored light theme is reset to dark on load. React StrictMode runs `ThemeProvider`'s mount effects twice, and on the second pass `readInitialTheme()` reads `data-theme` after the reflect effect has already written `dark` to it. `localStorage` keeps `light` and `<html data-theme>` ends up `dark`. **Checked in the production build (`next start`): light is kept, so the bug is dev-only.** Fixed in phase 1: `readInitialTheme()` now reads `localStorage` before the attribute, and `capture.mjs` only warns if the theme doesn't apply.

## Historical vs current

October evidence (`../../evidence/`) is historical. Findings 1, 2, 5 and 9 above are **current reproductions** at 7ec8c80. The October performance observations haven't been rechecked.

## Not yet done

- Throttled stress runs (`perf.mjs --cpu 4`) and phone-emulation runs (`--viewport phone`), to be recorded separately from the normal-load baseline.
- 24 *audible* lanes (needs a Pro/superadmin session).
- A map-only callback timer. The trace figure above covers *all* rAF callbacks. Phase 3 needs one around MapView's ticker subscriber to report its own p95.
- Interactive checks: legend/zoom keyboard behaviour, camera behaviour after a user pan, and 767/768/1023/1024px transitions.
- Real phone hardware: none available in this session. Phone results come from desktop Chrome emulation only.

## Phase 1 results

5 November 2026 · candidate = working tree on top of `a847fe8` (quiet theme-aware basemap, route hierarchy, control composition, tablet grid fix). Baseline for matched runs = `a847fe8` (product code identical to `7ec8c80`).

### UI checks

`capture.mjs --out screenshots-phase1` (PNGs gitignored; `screenshots-phase1/probe.json` committed): 18 configurations (berlin-6, newyork-6, berlin-24 × both themes × desktop/tablet/phone), all loaded, toggled and played without script failures. The one console error per load is the same `ERR_CONNECTION_REFUSED` as in phase 0.

| Phase 0 finding | Phase 1 |
| --- | --- |
| 1. Tablet map 0×0 | **Fixed.** 820×1036 at 820px in every configuration (`.daw.daw--map` grid areas in `mobile.css`). |
| 2. Zoom control over the legend | **Fixed.** Zoom/Fit controls top-right (1396,116 desktop); lanes panel top-left (12,116). No overlap at any width. |
| 3. Legend has no pointer events | Panel is now interactive (collapsible, scrolls). Clicking a row to focus a route is phase 2. |
| 4. Legend grows, doesn't scroll | Panel is capped by the map height and scrolls: 732px for 24 lanes in a 796px map, ending above the attribution (y 848 vs 862). Off rows use a hollow dot and `--muted` text, not opacity. Tablets start collapsed (192×46). |
| 5. Basemap dark in light theme | **Fixed.** OpenFreeMap `positron` in light, `dark` in dark, both filtered by `quietBasemapStyle`. Theme switch keeps the camera. |
| 6. All-off gives no guidance | **Fixed.** "Enable a lane to hear the city." + Show lanes in every all-off configuration; off previews are a little stronger (0.35) when everything is off. |
| 7. Phone frames a whole region | Framing now targets audible routes, then previews, then city, with overlay-aware padding. Further phone framing tuning is not in scope. |
| 8. Phone attribution collides | **Fixed.** One attribution line (Leaflet control, bottom-left) carrying the city credit; 374px wide on a 390px phone. |
| 9. Glows; Composer covers bottom-right | Glow removed: 3px active line, 5px neutral casing only below 3:1 contrast, 1px dashed off lanes. The Composer still covers the bottom-right; Fit padding doesn't account for it yet. |
| 10. Phone legend strip | Replaced by a "Lanes" button opening a `Sheet`. |

Interactive checks (Playwright, `next dev`):
- Widths 320–1920: no horizontal scroll; the panel/sheet switch at 767/768 and the tablet/desktop switch at 1023/1024 are correct.
- Camera: a user pan survives a lane toggle, Map ⇄ DAW, and a theme switch (within 1px). Fit mix reframes.
- Blocked style request: "Map background unavailable" + Retry over `--bg`, routes still drawn; Retry recovers.
- Lanes panel toggle works from the keyboard and shows the 2px focus ring.
- `npm test` 582/582 (new `test/map-visual-policy.test.js`); `npm run build` passes.

### Performance (desktop, matched A/B)

Baseline and candidate production builds ran side by side (`next start` on :3013 and :3012) and were measured **alternately on the same machine in one session**, one 60 s run at a time after 20 s warmup, swapping which build went first each round. No traces. Raw data: `perf-phase1/ab-{6,24}lane-{base,cand}.jsonl`.

| Workload | Build | Runs | SVG paths | Frame p95 (ms) per run | Long frames / LoAF | Audio capacity mean % per run | Dropout ms | Late ticks |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| berlin-6 | baseline | 3 | 103 | 10.8 / 10.8 / 10.8 | 0 / 0 | 17.4 / 20.0 / 16.6 | 0 | 0 |
| berlin-6 | phase 1 | 2 | 95 | 10.9 / 10.8 | 0 / 0 | 18.8 / 17.5 | 0 | 0 |
| newyork-6 | baseline | 2 | 233 | 10.8 / 10.8 | 0 / 0 | 18.6 / 17.7 | 0 | 0 |
| newyork-6 | phase 1 | 2 | 221 | 10.9 / 10.8 | 0 / 0 | 18.3 / 19.5 | 0 | 0 |
| berlin-24 | baseline | 2 | 139 | 10.9 / 10.8 | 0 / 0 | 20.4 / 21.1 | 0 | 0 |
| berlin-24 | phase 1 | 2 | 131 | 10.9 / 10.8 | 0 / 0 | 20.9 / 21.3 | 0 | 0 |
| newyork-24 | baseline | 2 | 269 | 10.8 / 11.8 | 0 / 0 | 20.6 / 21.9 | 3 (one run) | 0 |
| newyork-24 | phase 1 | 2 | 257 | 10.9 / 11.6 | 0 / 0 | 19.9 / 21.5 | 0 | 0 |

(A sixth 6-lane candidate run was killed mid-run when the session paused and is excluded.)

What this says:
- **No measured regression.** Frame p95 is within 0.1 ms of the baseline in every matched pair. The one 11.6–11.8 ms pair (newyork-24, round 2) moved both builds together, so it's machine state, not the change. Audio capacity differs by under 1.5 points, inside the ±2.5-point run-to-run spread. No long frames, no late notes; the only dropout (3 ms) was on the baseline.
- **The earlier unmatched candidate session** (`perf-phase1/unmatched_desktop_cpu1_2026-11-05T12-27-47.jsonl`, 3 runs × 4 workloads, an hour after the phase 0 baseline) read frame p95 11.4–11.8 ms, up to +10% against phase 0. The matched runs show the baseline drifting the same way, so that comparison was session drift and is superseded.
- Route paths drop by 8–12 per workload because the glow layer is gone; casings are added only for low-contrast colours.
- The basemap's own GPU cost (MapLibre restyle on theme change) isn't in these numbers; the runs don't switch theme.

**Phase 1 gate**: both themes render readable routes and controls; nothing overlaps the attribution; user framing survives editing; 767/768/820/1023/1024 checked; no measured desktop regression. **Met for desktop.** Open:
- Screen reader pass over the panel, sheet and notices (not done).
- Real phone hardware, and `--viewport phone --cpu 4` stress runs (not done, as in phase 0).
- Fit padding ignores the AI Composer panel on desktop.

## Phase 2 results

6 November 2026 · candidate = working tree on top of `124d7e4`. Visual route focus and progressive stop detail.

### What changed

- **Lanes, not routes, in the legend.** MixerTab passes `mapLanes` (`lib/mapLanes.js` `buildMapLanes` over the DAW's visible lanes). Duplicates resolve to their `sourceId` line, merged lanes to their `sourceIds`; synthetic ids are never parsed. Each physical line is still drawn once. A line draws as audible when any lane on it is audible, which also drives Fit mix and the playheads (before, a merged lane's source lines looked active while gated silent, and a duplicate playing over a disabled base looked off).
- **Focus.** Legend rows are `aria-pressed` buttons labelled "Focus U7 on map (Bass, on)"; pressing the focused row again clears it. Clicking a line focuses a lane on it (a focused lane sharing that line stays focused). The focused line is 4px in a `focus` pane above the others, other audible lines drop to 0.5, off previews are unchanged, and a focused lane that is off stays dashed and says "Off".
- **Details card** under the legend (desktop/tablet, ≤240px): name, role label, state as text, duplicate/merged/shared-line notes, the selected stop, Fit route, Clear focus and a "Stops" disclosure with the ordered stop list. "No map geometry" disables Fit route with the reason shown.
- **Stops.** The passive metro stop markers are gone. Only the focused lane's stops are drawn, at zoom ≥13, filtered to the viewport on `moveend`/`zoomend` and sampled by stop order to 80 (desktop) / 24 (phone), keeping endpoints and the selected stop. One label: the selected stop. Picking a stop in the list doesn't move the camera; "Show stop" appears when it's off screen.
- **Phone.** The Lanes sheet rows focus and close the sheet; focus returns to the Lanes button; a compact card (name, state, Fit route, Clear focus) sits under it. Focused lines are raised with `bringToFront` rather than a separate pane, because a canvas in a higher pane would swallow taps meant for lines below.
- Focus clears on a city change, a new song/route set, or removal of the lane; it stays when the lane is disabled.

### Checks

- `npm test` 590/590, including `test/map-lanes.test.js` (8 tests: geometry resolution without parsing ids, lane-aware activity, click and toggle rules, reconcile on removal, merged stop order, zoom gate/viewport/cap with endpoints and selection kept, focus styles, predicate fit). `npm run build` passes.
- `focus-check.cjs` against `next dev` (berlin-6, playing, 1440×900 and 390×844 touch):
  - Mouse: row focus, Fit route, zoom-in shows the focused lane's stops only, stop selection labels one stop, a pan hides it and "Show stop" brings it back.
  - Keyboard: Tab to a row, Enter focuses, Enter again clears.
  - Line click focuses the clicked line's lane (U8).
  - Phone: the sheet lists the 6 lanes; tapping one closes it, focus returns to the Lanes button and the compact card appears; Fit route and Clear focus work.
  - **Audio state unchanged:** the lane view's enable/solo pressed states and volume values are identical before and after every visual action (desktop and phone), and playback ran throughout.
- Crowded layout: berlin-24 at 1440×900 dark (legend 116–617, card 625–848, attribution from 862) and 820×1180 light/touch (collapsed legend, card 210–594). No horizontal scroll.

**Phase 2 gate** (mouse, keyboard and touch can focus, inspect a stop and return to the mix; volumes, solo/disabled sets and playback don't change): **met in Chrome desktop and phone emulation.** Open:
- Screen reader pass (VoiceOver) over the focus buttons, card and stop list.
- Real touch hardware.
- No sounding-stop highlight (optional in the plan; not built).
- Performance not re-measured for this phase. The map draws fewer layers than before (passive metro stop markers removed; focus adds at most 80 markers), so no regression is expected; phase 3 re-measures.
