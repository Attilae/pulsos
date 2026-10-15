# Performance audit, 15 October 2026

The reported symptom is sluggish controls and animation while experimenting with Macro,
Resonator, Analog/ladder filtering and the new Texture engines. The strongest finding is
a confirmed EQ visualisation lifecycle leak. Broad React updates on every control input
are the next target. This audit makes no application changes.

## Scope and evidence

- Reviewed the current working tree, including the existing uncommitted changes in
  `DawView.jsx`, `DawView.css` and `DeviceRack.jsx`; preserved those changes.
- Built production successfully, including a second build with
  `NEXT_PUBLIC_RESONATOR_ENABLED=true`, `NEXT_PUBLIC_MACRO_ENABLED=true`,
  `NEXT_PUBLIC_GRANULAR_ENGINE=clouds`, `NEXT_PUBLIC_TEXTURE_MK2_ENABLED=true`.
  These were command-local flags; no environment files were edited.
- Used isolated headless Chrome 148 against the local production server on an Apple
  M4 Pro, 12 CPU cores, 24 GB RAM. Browser tests were signed out, with six enabled lanes
  and 19 lanes present in the initial Budapest mix. Results are short desktop samples,
  not a mobile benchmark or an audio-quality test.
- Six-lane steady playback, ten seconds each in DAW and Map: 599 frame intervals in each
  sample, no intervals above 33.4 ms and no main-thread tasks above 50 ms.
- With Macro, Analog filtering and verified active Texture Mk II on M1, dispatched
  240 alternating ArrowUp/Down events to Macro Timbre, one per animation frame.
  The displayed value alternated between 0.50 and 0.51. Frame interval p95 was 16.9 ms,
  maximum 17.8 ms, with no long tasks or intervals above 33.4 ms. This exercises the
  normal knob change path, but does not simulate high-rate pointer input or many open racks.
- Ran the existing Beads host benchmark and an executable reproduction using the real
  TextureVoice source with mocked audio/loading dependencies.

These samples did not reproduce the full reported slowdown. They do establish a lifecycle
bug and several ways the workload grows during experimentation.

## 1. High: closing an EQ panel leaves its animation running

**Confirmed in the browser.** After closing the rack:

```text
retained WEQ8 element isConnected: false
retained analyser disposed: false
live weq8-ui elements in document: 0
detached analyser draw calls in 1.2 seconds: 72
filtersChanged listeners: 3 before removal, 3 after removal
```

`components/DawView.jsx:2819` binds the engine-owned EQ runtime to `weq8-ui`, without
unmount cleanup. Installed WEQ8 0.2.2 (`node_modules/weq8/dist/ui.js:16,28,34`) creates
an FFT-8192 analyser, reads 4096 bins and draws a 4096-point canvas path every frame.
Its UI subscribes to `filtersChanged` at line 449 but discards the unsubscribe, and has
no `disconnectedCallback`. Its loop only checks `disposed`, not DOM connection or visibility.

Opening/closing racks can therefore accumulate invisible analyser loops and listeners.
Instrument/column changes can also remount EQ panels when `DeviceRack` reparents cards.
Even an attached EQ runs while playback is stopped, its lane is disabled, or its panel
is offscreen. Initially closed racks do not create these visual resources.

**Improve first:** fix the dependency lifecycle with an upstream change or a committed
dependency patch. Retain the listener unsubscribe; dispose analyser/response observers
on removal and runtime replacement; disconnect the visual analyser branch; restore visuals
on reconnection. Keep the engine-owned EQ runtime, filter settings and audible route
connections intact. Simply setting the private analyser's `disposed` field is insufficient.
Add a browser lifecycle regression check: repeated rack cycles must not grow active visual
loops/listeners, and detached panels must make zero draw calls.

## 2. High: every knob movement invalidates the whole mixer

`components/PanelKnob.jsx:57` forwards every pointermove immediately. Macro/Resonator,
Texture and filter changes update top-level MixerTab maps at
`components/tabs/MixerTab.jsx:1072,1107,1121`. Every event can render MixerTab, DawView,
every un-memoized LineTrack, and the open device panels. Inline callbacks and newly created
per-lane objects prevent a simple shallow memo from solving this alone.

`components/DawView.jsx:275` also mirrors automation values in parent state, invalidating
the DAW on automation stop changes. StopRail rebuilds display arrays, grids, pitch maps
and sorted highlights on parent renders. `TextureControls.jsx:134` mounts both model bodies;
the inactive body's `visibility:hidden` still leaves its knobs in the React tree.

Persistence adds synchronous work: `lib/useSongPersistence.js:162` builds and stringifies
the complete snapshot during rendering on each persisted state change, before session or
autosave guards. Signed-out editing and disabling autosave do not avoid this calculation.
The 800 ms autosave debounce happens later.

**Improve:** give lane rows and device panels stable props/handlers and memoized boundaries;
make automation readouts subscribe at the affected control; memoize rail geometry;
coalesce pointer updates to at most one committed UI update per frame while preserving the
latest value and flushing the final value on pointerup. Keep audio updates responsive.
Move full snapshot serialization out of the input/render path and reuse the result for saving.
Render only the active Texture controls while preserving stable rack dimensions.

Normal Macro/Resonator knobs already update existing voices with small, diffed messages.
Ladder parameters ramp existing AudioParams. They do **not** recreate the audio graph on
each knob event. DeviceRack's layout-signature guard also avoids rerunning its layout
partitioning on ordinary knob changes. Do not rewrite those paths without measurement.

## 3. High: rapid Texture model switching can orphan a worklet

**Reproduced with the real class and mocked loading.** Classic -> Mk II while its loader
is pending -> Classic creates two Classic nodes. Disposing the voice disposes only the
new one; the original remains alive.

`lib/textureVoice.js:88` replaces the slot and carries the old slot inside an async closure.
The stale-build return at line 102 does not retire that carried slot; disposal at line 251
only reaches the latest slot. Repeated experimentation can retain DSP work and duplicate
the signal. Its severity for main-thread UI latency is not measured.

**Improve:** explicitly track and retire all superseded/current/pending slots, including
stale asynchronous completions. Verify rapid switching, loader failure and voice disposal
with pending loads. Reproduction helper used: `/tmp/transport-texture-leak-repro.mjs`.

## 4. Medium: map animation uses React on every frame

`components/MapView.jsx:405` computes positions and sets React state at about 30 fps.
Each ordinary desktop lane updates ten trail polylines and two CircleMarkers
(`:705,708,742`). Eight lanes imply roughly 2,880 dynamic layer update attempts/sec,
before automation lanes. This is a structural count, not measured CPU time. Static map
layers are already memoized; they are not all being reconstructed every frame.

**Improve:** update persistent Leaflet refs from the shared ticker; combine trails into a
canvas layer or fewer segments; suspend work when hidden. Preserve the existing memoized
static route geometry. The short six-lane test stayed smooth on this machine.

## 5. Medium: avoidable audio setup and edit work

- `lib/engine.js:1416` constructs all 14 FX buses on playback, regardless of sends.
  Several run LFOs; create buses only when required, including automation requirements.
- `lib/fxTrack.js:188,300` calls `generate()` after `new Tone.Reverb`. Installed Tone's
  constructor already calls it (`Tone/effect/Reverb.ts:72`), doubling offline IR rendering.
- `lib/engine.js:582,589,596` rebuilds route Parts for semitone, per-stop pitch and velocity
  edits, although callbacks already read those values dynamically. A rebuild also rebuilds
  dependent automation Parts. Remove only the proven redundant rebuilds.
- Disabled/unsoloed lanes mute after granular processing; Texture and GrainPlayer can
  continue working. Explore audibility-aware suspension with explicit tail semantics.
- Macro, Resonator and Beads worklets post warnings without rate limiting when counters
  increase (`public/worklets/macro-processor.js:246`, `resonator-processor.js:255`,
  `beads-processor.js:350`). Overload could amplify main-thread load through console warnings;
  coalesce diagnostics. This warning storm was not observed in the healthy runs.

The existing eight-lane Node DSP benchmark reported about 2.47% of one core for Classic
defaults, 5.91% for Mk II HiFi defaults, and 9.91% for HiFi delay mode, with zero faults,
dropped events, underruns or nonfinite samples. These are host-only relative results,
not browser audio deadline measurements. Scale plus sound-mode handling rebuilds a Part
once; the initially suspected duplicate scale rebuild was ruled out.

## 6. Separate startup and memory opportunities

`lib/shared/useRoutes.js:18` retains every visited city's full object in a module Map.
Local Node/V8 measurements, not browser parse timings:

| City | Full JSON / parse / retained heap | Slim JSON / parse / retained heap |
| --- | --- | --- |
| Berlin | 69.2 MiB / 90.9 ms / 64.6 MiB | 6.6 MiB / 14.8 ms / 14.5 MiB |
| Prague | 55.9 MiB / 60.5 ms / 53 MiB | 5.1 MiB / 13.4 ms / 13.3 MiB |
| Budapest | 23.3 MiB / 29.2 ms / 21.9 MiB | 1.8 MiB / 4.3 ms / 3.8 MiB |

All seven full objects retained 213.6 MiB together. The browser confirmed the initial
Budapest request decoded 24,451,546 bytes, despite about 2.1 MB transferred with compression.
Use slim data for DAW startup on desktop too, fetch detailed geometry on demand, and bound
the city cache. Preserve stop data and map geometry behavior deliberately.

`MixerTab.jsx:2281` mounts the hidden MapView during default DAW startup. It initializes
Leaflet, MapLibre/WebGL and geometry even while hidden. Its dynamic import group is about
1,179 KiB raw / 317 KiB gzip JavaScript. Mount it on first Map visit, retaining it afterwards.
`App.jsx:2` also statically imports tabs that are only mounted on first visit; dynamically
import those components. Next's small initial route JS figure does not include all this
subsequently requested application code.

`lib/sampleCache.js:23` retains decoded AudioBuffers without a byte budget, while prefetch
launches every sample concurrently and includes disabled instruments. Limit decode
concurrency and use a cache budget with active samples pinned.

## Recommended order and acceptance checks

1. Fix EQ lifecycle first. Exercise 20 rack open/close cycles, source changes and window
   resizing. Detached drawing must stop, listener counts must return to baseline, EQ sound
   and settings must survive reopening.
2. Fix the Texture async slot leak. Test delayed loaders and rapid model reversals.
3. Isolate lane/device rendering and remove render-time serialization. Profile real pointer
   drags at high event rates with several racks, automation and dense notes; unrelated lanes
   should not render for a local parameter change. Compare clean and long-running sessions.
4. Remove redundant reverb generation and scheduling rebuilds; lazily create unused FX.
5. Address map animation and data/cache/startup work as separate changes with before/after
   traces. Verify on the user's affected browser/device, especially if less powerful than
   the audit machine.

Temporary trace artifacts: `/tmp/transport-perf-startup.json` and
`/tmp/transport-macro-controls.json`. Automated builds passed; no audible sound verification
or mobile performance claim is made by this audit.
