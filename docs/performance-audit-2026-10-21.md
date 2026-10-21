# Performance on slow machines: audit and launch strategy, 21 October 2026

The app runs perfectly on an M4 MacBook Pro and badly on a budget Windows Dell. This
audit finds out why, fixes what was safe to fix without listening tests, adds field
monitoring, and lays out what has to happen before launch. It follows
`performance-audit-2026-10-15.md`, whose fixes (commit `8d803ae`) are in place; that audit
measured on the M4, which is exactly the machine that hides these problems.

## Summary

- **Two independent budgets fail on slow machines.** The audio render thread (every
  synth, filter, EQ and worklet in the graph runs on *one* real-time thread) and the
  main thread (React, the DAW's per-frame drawing, Tone's note scheduler). On an M4 both
  have huge headroom; a budget laptop has a fraction of its single-core speed, and
  single-core speed is what both budgets depend on.
- **The audio thread is the bigger risk.** On a 2.8 GHz cloud Xeon, playing six lanes uses
  about 45% of every audio deadline (peaks of 75–97%), and about 20% is spent before a
  single lane is enabled. A machine with half that single-core speed is at or past 100% at
  peaks, which is heard as clicks and dropouts. *Estimate, not measured on the Dell.*
- **The DAW view was spending half of the main thread on drawing**, mostly on disabled
  lanes. This change fixes most of that: at 4× CPU slowdown the DAW goes from about
  14 fps with 34 long frames per 10 s to about 25–29 fps with 3–4.
- **Monitoring now exists.** `?perf=1` shows a live readout (audio dropouts, late notes,
  frame rate, device, GPU), and every sampled session that plays for 30 s sends one
  `perf_session` analytics event, so launch traffic tells us which machines struggle.
- **Next step is measuring the Dell** (instructions below). Several fixes depend on what
  it shows, and the most promising audio fix (`?latency=playback`) is ready to A/B there.

## How this was measured

- Production build, served locally, driven by headless Chromium 141 (Playwright) on a
  4-core Intel Xeon @ 2.8 GHz cloud VM. `scripts/perf_bench.mjs` reproduces the
  playback numbers.
- **Audio load**: Chrome DevTools' WebAudio domain (`WebAudio.getRealtimeData`) reports
  *render capacity*, the share of each audio callback's deadline the graph used. Above
  100% the device plays silence. Readings on this shared VM wander by about ±5 points
  between identical runs, so every audio conclusion below comes from repeated,
  interleaved runs.
- **Main thread**: Long Animation Frames, rAF frame intervals, a Chrome trace with
  invalidation tracking, and a MutationObserver count of per-frame DOM writes. Slow
  machines are approximated with DevTools CPU throttling (`--cpu 4`), which slows the
  main thread only, not the audio thread.
- Scenario: fresh Budapest session (19 lanes, all disabled, as every new session starts),
  first six lanes enabled (the Free cap), mock playback.
- Headless Chromium renders with SwiftShader (software GL). The Dell probably has a GPU,
  so compositing costs below are likely pessimistic for it, unless Chrome has blocklisted
  its driver (see "GPU" below).

Not covered: audible quality (nothing here was listened to), Firefox and Safari, mobile,
and the flag-gated worklet instruments (Resonator, Macro, Texture, Analog filter).

## Findings: the audio thread

| Scenario (Xeon, 1× CPU) | Render capacity, mean |
| --- | --- |
| Page loaded, never played | 6–9% |
| Playing, 0 of 19 lanes enabled | 19–26% |
| Playing, 6 of 19 lanes enabled | 40–50% (peaks 74–97%) |
| Playing, 0 lanes, disabled lanes' nodes disposed | 8–10% |
| Playing, 6 lanes, 13 disabled lanes' nodes disposed | 36% (vs 40% with them) |

**A1. Disabled lanes cost audio time just by existing.** Pressing Play builds the full
chain for all 19 lanes (1,148 audio nodes, 218 of them `ConstantSourceNode`s, which is how
Tone implements every Signal). Disposing the disabled lanes' nodes takes the 0-lane case
from about 21% back to the 8–10% idle baseline: roughly 0.6 points per disabled lane on
this Xeon. Disposing their `Tone.Part`s changes nothing, and *disconnecting* the lanes
from the output changes nothing either (tested: cutting the duck → panner edge of all 19
lanes, and separately the lanes' synth outputs). The cost is in the nodes being alive,
not in rendering them. A raw Web Audio reproduction did not show this (19 disconnected
synthetic lanes cost 0.7%), so the mechanism is specific to Tone/standardized-audio-context
and is not yet understood. The fix is the same either way: don't keep disabled lanes'
nodes alive (A1 in the strategy).

**A2. An enabled lane costs about 3.5–4.5 points** on this Xeon (six lanes ≈ +22 points
over the 0-lane case). Per-lane contents worth measuring first: the four flat weq8
biquads that every lane's default EQ keeps connected (0 dB bands still compute), the
Classic filter at its default setting, about 11 Tone Signals, the synth voices, and the
sends. The true-peak master limiter (a JS worklet) is a few points at most: switching
the master chain to `legacy` moved the reading by less than the noise.

**A3. The audio thread never rests.** 6–9% is used before Play is ever pressed, and the
same after Stop: the master bus and its worklet run on an always-running context. That
costs laptop battery and fan noise and leaves less headroom for other tabs.

**A4. The output buffer is the smallest available.** Tone's default context asks for
`latencyHint: 'interactive'`: 10 ms in Chrome. Every note is already scheduled 100 ms
ahead (Tone's lookahead), so the small buffer buys nothing musically; its only effect
is that any render callback that runs late, for any reason (a busy CPU, a Windows audio
driver, a background process), is a click. `'playback'` gives a 23 ms buffer in Chrome on
this machine (larger on many Windows devices), which tolerates far more jitter. Knob
moves would reach the speakers 10–40 ms later, which is not noticeable on these controls.

## Findings: the main thread

**M1. The DAW animated every lane, including the disabled ones.** A MutationObserver
during six-lane playback, per 3 s:

| DOM writes per 3 s | Before | After this change |
| --- | --- | --- |
| Playhead `transform` writes | 3,325 (all 19 lanes, every frame) | 1,080 (the 6 enabled) |
| Stop-rail `class` attribute rewrites | 3,325 | 0 |
| Event-log text rewrites | ~1,200 (24 rows retyped per note batch) | 84 row insertions |

The trace attributed long frames to style recalc and layout (~60%) and other rendering
(~20%), not to JavaScript (~10%). With 4× CPU slowdown:

| DAW view, 6 lanes, 4× CPU | Before | After |
| --- | --- | --- |
| Frame rate | ~14 fps | 25–29 fps |
| Frame p50 / p95 | 67 / 133 ms | 33 / 67–83 ms |
| Long animation frames per 10 s | 34 (worst 242 ms) | 3–4 (worst 55–107 ms) |
| Blocking time per 10 s | 547 ms | 4–59 ms |

A 242 ms main-thread stall is more than Tone's 100 ms lookahead, so before this change a
slow machine also played **late notes** in the DAW view, not just a choppy UI.

**M2. What is still expensive in the DAW**, per 3 s of six-lane playback at 1×: Layerize
~500–600 ms and Paint ~170 ms (after the stop-dot fix; 330–425 ms before). Layerize did
not respond to `content-visibility: auto`, to dropping `will-change` on playheads, or to
hiding the master meters and the event log, so it seems to scale with the page's size
(~4,200 DOM nodes) more than with any single animation. `contain: layout paint` on
`.line-track` brings Paint to ~110 ms but would clip the stop-name hover labels, which
overflow the lane; it needs a visual pass first.

**M3. A stall right after Play.** The first 2 s after the transport starts contain a
55–104 ms main-thread stall on the Xeon (React re-rendering every lane with
`started=true`, first Part windows). At 3–4× slower that is 150–400 ms, enough to flam
the first notes. Separately, the graph build before the transport starts takes ~230 ms
here (that one cannot make notes late, but it is a frozen UI on click).

**M4. Startup.** Time until the DAW's lanes are visible, local server, no network:
0.7 s at 1×, **3.8 s at 4×**, with one 810 ms frozen frame. The previous audit's slim route
files and lazy tabs already help; the 4× number is the one to work on.

**M5. GPU.** Chrome falls back to software rendering when it blocklists a GPU driver,
common on older Windows laptops. Then every paint and composite above runs on the CPU too.
The monitor reports the GPU class; on the Dell check `chrome://gpu` as well.

## What this change does

1. **Disabled lanes no longer animate** (`components/DawView.jsx`: `StopRail` gets
   `started={started && !disabled}`). A disabled lane plays no notes (the engine gates
   them), so it now shows no moving playhead or active stop, consistent with the sound.
2. **Rail class writes only on change** (the `stop-rail--resting` toggle is tracked in a
   ref, reset after every render like `activeKeyRef`).
3. **Event-log rows keyed by event** (`lib/shared/eventLogStore.js` stamps a `seq`), so a
   note inserts one row instead of retyping 24.
4. **Stop-dot transitions on compositor properties only** (`components/DawView.css`):
   `transform` and `opacity` still animate; the active dot's colour and glow now switch
   instantly instead of fading over 150 ms. Halves paint time while playing.
5. **`Tone.Transport` / `Tone.Draw` replaced by `Tone.getTransport()` / `Tone.getDraw()`**
   everywhere. Tone's `index.js` binds those constants to the context that exists at
   import time; the getters follow the current context. Behaviour is identical unless the
   context is replaced, which item 6 needs.
6. **`?latency=playback|balanced|interactive|default`** (`lib/audioSession.js`) rebuilds
   Tone's context with that `latencyHint` before anything uses it, remembered per
   browser. The default is unchanged: this is an A/B switch for the Dell, not a decision.
7. **Performance monitor** (`lib/perfMonitor.js`, pure maths in `lib/perfStats.js`,
   tested in `test/perf-stats.test.js`):
   - *Audio dropouts*: how far the audio clock has fallen behind wall time. The render
     thread never skips frames; when it misses a deadline the device plays silence and the
     context clock falls behind. Verified in Chromium: a worklet burning 4 ms per 2.9 ms
     quantum produced 887 ms of lag in 3 s; an idle graph stayed within ±3 ms. Readings
     inside a noise floor of two output buffers + 10 ms are ignored, and rates need 20 s
     of data.
   - *Late notes*: gaps between Tone's scheduler ticks longer than its lookahead, after a
     2 s warm-up; the warm-up's worst gap is reported separately as the *Play stall*.
   - *UI*: frame-time histogram and Long Animation Frames while playing (attribution of
     the five worst frames is in the copied report).
   - *Device*: OS, browser, cores, memory, WebGL renderer and its class (software /
     integrated / discrete), power source.
   - *Workload*: active lanes, worklet lanes, view, city (from MixerTab).
   - Verified end to end: a healthy run reports 0 ms dropouts; with an injected
     audio-thread overload it reports 11.2 s of dropouts in 24 s and the verdict
     `audio-dropouts`.
8. **HUD** (`components/PerfHud.jsx`): `?perf=1` (remembered; `?perf=0` or Close hides it)
   shows the numbers live, with Copy report (full JSON) and an output-buffer picker that
   reloads with `?latency=`.
9. **Field event**: one `perf_session` event per page load, after 30 s of playback, with
   two properties (the Vercel Analytics Pro limit): `verdict` (`ok`, `audio-dropouts`,
   `late-notes`, `janky-ui`, `software-gpu`) and `profile`, a ≤255-character line such as
   `v1 os:win br:chrome c:4 m:8 gpu:integrated bat:bat sr:48 lh:inte bl:10 lanes:6 wk:0
   view:daw play:61s drop:0 late:0 st:55 fps:60 p95:17 lf:0 blk:0`.
   `NEXT_PUBLIC_PERF_SAMPLE_RATE` (0–1, default 1) sets the share of page loads that report.
10. **`scripts/perf_bench.mjs`**: the playback benchmark used above, for before/after
    comparisons and a future CI gate.

Tried and reverted: detaching silent lanes from the output (one edge per lane). It was
measurably worthless (19.1% → 19.2%) because of A1's mechanism, so it isn't shipped.

## Strategy before launch

### Phase 0: measure the Dell (an hour, do this first)

On a preview deployment of this branch, in Chrome or Edge on the Dell:

1. Plug in the charger and set Windows power mode to *Best performance* for the first
   pass. Open `chrome://gpu` and note whether *Canvas*, *Compositing* and *WebGL* say
   *Hardware accelerated*.
2. Open the site with `?perf=1`. Enable six lanes, press Play, stay in the DAW view for a
   full minute. Note the HUD, press **Copy report** and save it.
3. Press Reset, switch to the Map view, play another minute, copy the report.
4. In the HUD's **Buffer** menu pick `playback` (the page reloads). Repeat steps 2–3.
5. Repeat the default-buffer run on battery, with Windows on *Best power efficiency*.
6. Optional: DevTools → More tools → WebAudio shows render capacity live, the same figure
   the benchmark reads.

How to read it: *Dropouts* above zero mean the audio thread is overloaded (A1–A4);
*Late notes* or a *Play stall* over ~100 ms mean main-thread stalls (M1–M3); a low frame
rate without the other two is purely visual. A software GPU explains slow drawing on its
own (M5).

### Phase 1: decisions and fixes that depend on the Dell

1. **If `playback` removes the dropouts, make it the default** (A4). One line in
   `lib/audioSession.js` (or `balanced` as a middle ground). Listen to the knobs and Drum
   Machine pads afterwards; they are the only latency-sensitive interactions.
2. **Suspend the audio context when nothing has played for a while** (A3): after Stop plus
   the longest release/reverb tail, `rawContext.suspend()`, and resume through the existing
   `unlockAudio()` path. Saves the idle 6–9% and battery. Watch the iOS session handling in
   `lib/audioSession.js`.
3. **Start the transport slightly in the future** (M3): `Tone.getTransport().start('+0.15')`
   in `startMock`/`startLive` lets the post-Play stall happen before the first note is due.
   150 ms of extra start latency is not noticeable; a flammed first beat is.

### Phase 2: structural work (largest gains)

1. **Build lane chains only for audible lanes** (A1; about 0.6 points per disabled lane on
   the Xeon, likely 1–2 on the Dell, so 13–25 points in a fresh session). Build a lane's
   chain when it is enabled or soloed in, dispose it after its release tail when disabled.
   It needs every per-lane setting the entry currently holds (synth type, envelope and
   synth params, harmony, glide, granular/Texture state) stored in engine-level maps so a
   rebuild reproduces it exactly, as the FX/filter/EQ state already is. Risky because 33
   call sites read `_mockSynths.get(routeId)`. Needs listening tests: enable/disable mid
   note, solo in/out, sidechain sources, Song Chainer handover, WAV stems.
2. **Cut the per-lane cost** (A2). Measure, one at a time with `perf_bench.mjs --runs 3`:
   skip 0 dB weq8 bands (make the default EQ spec flat `noop` bands and add filters when
   the user raises one), bypass the Classic filter while it is fully open, and count what a
   default Tone synth contributes. Pro users will run more than six lanes, so this decides
   how far the app scales.
3. **A Performance mode** for weak machines, offered automatically when the monitor sees
   dropouts or late notes (the verdict is available client-side): `playback` buffer,
   no stop/playhead glow, static rails for lanes off screen, master meters off, and a
   warning before enabling more lanes. Keep it a user-visible toggle; never change the
   music silently.
4. **DAW drawing** (M2): try `contain: layout paint` on lanes after moving the hover
   labels into a portal or making them fit inside the lane, then measure Layerize again.
   Reducing DOM per lane (stop labels rendered only on hover) is the other lever.
5. **Startup** (M4): profile the 810 ms frame at 4×; candidates are the initial render of
   19 lanes and the route JSON parse.
6. **Worklet instruments**: before turning on `NEXT_PUBLIC_RESONATOR_ENABLED`,
   `NEXT_PUBLIC_MACRO_ENABLED` or the Texture flags for launch, benchmark each with six
   lanes in the browser. They are by far the most expensive per-lane DSP.

### Phase 3: monitoring and launch gates

- **Field data**: Vercel Analytics custom events need the Pro plan; filter `perf_session`
  by `verdict` and read the `profile` values to see which devices fail. If two properties
  prove too coarse, add a `/api/perf` beacon into Postgres with the same abuse defences as
  `/api/feedback` and store the full report. Add Vercel Speed Insights for load metrics
  (LCP, INP), which this monitor does not cover.
- **Budgets** live in `PERF_BUDGETS` (`lib/perfStats.js`): dropouts ≤ 20 ms/min, late-note
  gaps < 1/min, frame p95 ≤ 50 ms, long frames ≤ 10/min. Change them there; the HUD,
  verdict and tests follow.
- **Launch gate on a reference machine**: keep the Dell (or a similar ~€400 Windows
  laptop) as the reference. Before launch, on it, six lanes for two minutes in both views:
  zero dropouts, zero late notes after warm-up, Play stall under 100 ms, frame p95 under
  50 ms, DAW usable within 3 s of load.
- **Regression check in CI**: `perf_bench.mjs --cpu 4 --runs 3` against a production build,
  failing on frame rate or long frames beyond a stored baseline. Keep audio capacity as a
  reported trend rather than a gate on shared runners; it is too noisy there.
- **Publish a minimum spec** once the reference results are in (for example: Chrome or Edge,
  4 cores, hardware graphics acceleration on, plugged in for large sessions).

## Reproducing

```bash
npm run build && npm run start          # production build on :3000
npm i --no-save playwright@1.56.1       # or have Playwright installed globally
node scripts/perf_bench.mjs --lanes 6 --cpu 4 --runs 3
node scripts/perf_bench.mjs --lanes 6 --view map --latency playback
```

In the browser: `?perf=1` for the HUD, `window.leidPerf.report()` for the full report,
`window.leidPerf.profile()` for the analytics line.
