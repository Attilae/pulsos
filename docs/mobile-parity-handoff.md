# Handoff: phone ↔ desktop parity for the Map/DAW tab (phases 1–8)

For: Codex (or any agent) picking this up. Read `AGENTS.md` first, especially the **Mobile**,
**Architecture → The main DAW** and **Verifying a change** sections. This file covers only what
`AGENTS.md` doesn't.

## Goal

The phone layout should have the desktop's full functionality (the user chose "full parity"),
using touch-native controls rather than desktop gestures. That means no hover, no
drag-only interaction, no Cmd/Ctrl-click, and no double-click as the only way to reset.
Ship it as **phased PRs, one area per PR**, each releasable on its own. Branch every phase from
`develop` (or from the previous phase's branch if that hasn't merged yet). PRs target `develop`.

## Where things stand

- **Phase 0 is done**: PR #128 (`feature/mobile-parity-phase0`).
  - `components/mobile/LaneSheet.jsx` is now a thin shell. Its tabs live in
    `components/mobile/lane/{ToneSegment,RhythmSegment,MixSegment,NotesSegment}.jsx`, and
    `fields.jsx` holds the shared `Field`, `GroupHead` and `panLabel`.
  - Every segment receives one `ctx` object: LaneSheet's props plus the values it derives
    (`trackScale, pv, ag, laneChance, pattern, snl, snlStatus, setSnlBound, svm, svmStatus,
    setSvm, resonatorStatus`). **To add a prop, do three things:** add it to LaneSheet's
    signature, add it to the `ctx` literal, and destructure it in the segment.
  - The mode switch, the BPM/Re-pick lock while playing, WAV gating with %, the aria-live
    transport status and `SongMenu inline` are all aligned with desktop.

- **Phase 1 is merged**: PR #129 (`feature/mobile-parity-phase1`):
  - Desktop and phone share `components/lane/EnvelopeFields.jsx`, `SynthFields.jsx`, and
    `GranularFields.jsx`; `lib/automationControl.js` shares the automation value conversion.
  - Tone now exposes envelopes, sampler presets/base-note uploads (Pro gated), drum voices,
    glide, legato, Texture (Classic/Mk II), and the original GrainPlayer editor when configured.
  - Sheet controls have visible resets. Armed automation locks apply; live value mirroring
    is still Phase 7 work.
  - Verified: 619 tests, production build, all twelve instrument editors at 390×844, no
    horizontal overflow/page errors, autosave/reload through mocked account storage, and
    resize to 1440×900. Custom uploaded sample buffers remain session-only, as on desktop.
  - Human listening on phone hardware remains a release check.

- **Phase 2 is merged**: PR #130 (`feature/mobile-parity-phase2`, stacked on Phase 1):
  - `lib/loopRegionEdit.js` shares desktop clamp/pointer/keyboard maths with the phone’s
    grid-stepping editor. Loop windows remain integer canonical cells (0–64); triplet/fine
    grids round to the same positions the engine supports.
  - Rhythm has start/end steppers, a stop/window strip, and Full loop. Full loop sends
    `{startCell: 0, endCell: 64}` explicitly because the engine ignores a null region.
  - Mix has per-lane MIDI/WAV export through the existing entitlement and recording handlers,
    including playback/busy gating and recording percentage.
  - Verified: 625 tests, production build, 390×844 browser save/reload/reset and grid edits,
    real MIDI/WAV downloads (4 MIDI notes; nonzero WAV PCM), desktop loop drag/keyboard controls, dark theme, and 820px/1440px layouts.

- **Phase 3 is implemented** on `feature/mobile-parity-phase3` (from updated `develop`):
  - The pinned lane toolbar has a native Line actions menu: base-lane Change/Remove,
    Duplicate with transpose, Remove this copy, and Un-merge. Playback locks match desktop.
  - Section headers offer Add line and non-metro Re-pick; the general Add line remains
    available in an empty song.
  - `lib/linePickerProps.js` shares desktop/phone picker dispatch and the complete selected
    route set includes hidden automation sources. `SnapshotBar.jsx` is also shared.
  - Existing LinePicker/DuplicateLaneDialog overlays retain `useModal`; their 390px layout
    and scoped 44px controls are verified. MixerTab changes only pass existing state/handlers.
  - Verified: 628 tests, production build, phone add/change/remove/duplicate/un-merge and
    re-pick flows, sound settings through save/reload, sidechain remap/drop, playback and
    plan-cap guards, light/dark dialog layouts, desktop picker actions, and 1440px/820px layouts.
    Browser checks used mocked account/storage/entitlements and had no page errors or
    horizontal overflow. The snapshot refetch/loading check used a mocked live-mode callback;
    the app-wide mock-only Live configuration is unchanged.
  - **Next is Phase 4: Drum lane on the Map tab.** Phases 4–8 are not implemented yet.

### How the phone is wired

- **Rendering.** Below 768px, `MixerTab` renders `<MobileDaw controls={…} lanes={…}>`, found by
  searching `{isPhone && (` and `<MobileDaw`. It renders this instead of `.daw-header` +
  `<DawView>`.
- **State.** MixerTab owns all state. The phone gets two prop bundles: `controls` (session,
  transport and sheets) and `lanes` (per-lane state and handlers).
- **Lane props.** `MobileDaw` passes per-lane slices into `LaneSheet`. Look at how it maps
  `lanes.*[openLane.id]`.
- **Sheet tabs.** The lane sheet's tabs are `SEGMENTS` in `LaneSheet.jsx`, and their ids are
  `sound|rhythm|mix|notes`.

## Ground rules (every phase)

1. **No new state in MixerTab.** Every phone control calls an existing handler. A phase should
   change MixerTab only in the `controls`/`lanes` bundles.
2. **Extract and share, don't fork.** Move a card body out of `components/DawView.jsx` into its
   own component with a `variant` prop. Render it from DawView *and* the phone, so the two can't
   drift.
   - The repo already does this with `LaneFilterFields` (`LaneFilterEditor.jsx`),
     `LaneTagFields` (`LaneTagEditor.jsx`), `SidechainSourceOptions` (exported from DawView) and
     `ResonatorControls`/`MacroControls` (`variant="sheet"`).
   - After extracting, DawView must render and behave identically.
3. **Touch rules** (`AGENTS.md` → Mobile → Touch conventions).
   - 44px floor, set in `components/mobile.css` with scoped `:not()` exclusions.
   - Explicit `::-webkit-slider-thumb` sizing.
   - Every reset needs a visible button.
   - Every overlay uses `components/Sheet.jsx`, never a new modal primitive.
   - Anything per-frame goes through `lib/shared/playheadTicker.js` with `transform`, never React
     state.
4. **Sizing CSS goes in `components/mobile.css`**, which loads last and wins at equal specificity.
   Phone component styles live in `components/mobile/MobileDaw.css`. A different component
   *tree* means a `useIsPhone()` branch.
5. **Pure logic goes in `lib/` with a `node --test` file**, as the rest of `test/` does.
6. **Desktop-only gates still apply on the phone:**
   - Pro-gated uploads go through `useCustomUploadGate` (DawView).
   - Lane locks come from the plan cap (`lockedIds`).
   - Controls driven by automation are locked (`autoCtl` in DawView).
7. **Keep `FirstRunNotice` and the Tone footer note truthful as phases land.** These are
   `components/FirstRunNotice.jsx` and the `lsheet-note` at the end of `ToneSegment.jsx`.
   Remove each "on desktop for now" claim in the phase that makes it untrue.

## Phases

Line numbers are approximate as of PR #128; search by symbol. M = `components/tabs/MixerTab.jsx`,
D = `components/DawView.jsx`.

### Phase 1: Lane sound (Tone segment)

- **Envelope.**
  - Extract `EnvPanelBody` (D ~2818) and its `envBlock` helper (D ~2904) into
    `components/lane/EnvelopeFields.jsx`. It covers every synth editor: Synth, MonoSynth
    (osc + filter env), FM, AM, Duo, Pluck, Noise, Membrane, Metal, and the PolySynth voice
    editor.
  - In the sheet variant, curve selectors become `<select>`s and sliders get reset buttons.
  - Wire it through `onADSR`, which is already in `lanes`.
  - Remember: DuoSynth has no top-level envelope, so writes go through `setAmpEnvelope`. MonoSynth's
    cutoff *is* its filter envelope. Both are in AGENTS.md; don't break either.
- **Sampler and Drums.**
  - Sampler: preset select plus file upload with base note, Pro-gated through
    `useCustomUploadGate` (D ~2543). Export the hook.
  - Drums: voice select plus the licence link.
  - Handlers: `handleSamplerPreset` (M ~1147), `handleSamplerUpload` (~1172) and
    `handleDrumVoice` (~1155). Add them to `lanes` as `onSamplerPreset`, `onSamplerUpload`,
    `onDrumVoice`.
- **Expression.**
  - Glide slider: hidden for Resonator/Macro, locked when automated.
  - Legato toggle, next to the existing Octave stepper in `ToneSegment`.
  - Handlers: `handleGlide` (~1312) and `handleLegato` (~1317). Also pass `glides` and confirm
    `legatos` is already in `lanes`.
- **Granular.**
  - When `TEXTURE_ENABLED`, use `components/TextureControls.jsx` with a new `variant="sheet"`
    (it already uses the shared `PanelKnob`).
  - Otherwise extract the classic GrainPlayer card (D ~1689–1780) into
    `components/lane/GranularFields.jsx`.
  - Keep the "Not available" note for synths where `supportsGranular` is false.
  - Handler: `handleGranular` (~1180).
- **Automation lock.** Pass `automationLanes` so phone sliders show the same lock and
  "automated" state that DawView computes.
- **Tone footer.** Once the above lands, delete the "Envelope and granular controls are on
  desktop" note in `ToneSegment`.

### Phase 2: Loop region and per-lane export

- **Loop region.**
  - Move the clamp/snap maths out of `useLoopHandles` (D ~177) into a pure
    `lib/loopRegionEdit.js` with tests. DawView keeps its drag handles on top of it.
  - On the phone, add a Loop group to `RhythmSegment`:
    - start/end steppers in grid cells, snapped to the lane's grid resolution
    - a "Full loop" reset
    - a non-interactive mini strip showing the window over the stops
  - Handler: `handleTrackLoopRegion` (~1357).
  - A loop region selects material; it never delays the lane (AGENTS.md).
- **Per-lane export.**
  - MIDI and WAV buttons in `MixSegment`. WAV is enabled only while playing, as on desktop
    (`runAudioExport` refuses otherwise).
  - Handlers: `handleExportRouteMidi` (~1981) and `handleExportRouteAudio` (~2012).

### Phase 3: Line management

- **Line menu in the lane sheet's header.** Actions:
  - **Change line** and **Remove**: base lanes only, not while playing, via
    `components/LinePicker.jsx`.
  - **Duplicate**: via `components/DuplicateLaneDialog.jsx`.
  - **Remove this copy**: duplicates.
  - **Un-merge**: merged lanes.
- **Section headers in `MobileLaneList`:**
  - "Add line" per section, plus one at the end of the list.
  - "Re-pick" for every section except metro.
- **Live-mode snapshot bar.** Put the bar with **Refetch** at the top of the lane list.
- **Handlers:** `handleAddLine` (~560), `handleChangeLine` (~578), `handleRemoveLine` (~678),
  `handleRepickType` (~537), `handleDuplicateTrack` (~1465), `handleRemoveDuplicate` (~1551),
  `handleUnmerge` (~1667) and `fetchSnapshot` (~845).
- **`linePicker` payload.** DawView assembles it; move that into a shared helper.
- **Dialogs at 390px.** Make both dialogs work there, either via `Sheet` below 768px or by
  verifying their layout.
- **Merge mode** is hidden on desktop too (D ~458). It's out of scope.
- **Sidechain sources.** Changing or removing a line must keep `remapSidechainSource` and
  `dropSidechainSource` working. They do if you call the same handlers.

### Phase 4: Drum lane on the Map tab

- **Lane list.** Add a `MobileDrumStrip` when a drum pattern is loaded, with mute-all, volume
  and a "more" button. Today `visibleInstrumentRoutes` excludes `DRUMS_ROUTE_ID`.
- **`DrumLaneSheet`.** It has three parts:
  - **Pads.** Each pad has a mute. The step grid is paged 16 steps at a time over the 64 steps,
    with 4 page tabs.
    - Tapping a step cycles its velocity: use `cycleStepValue` and the `vel-*` classes from
      `lib/engines/drumEngine.js`, as the Drum Machine tab does.
    - Highlight the page and step under the playhead via `playheadTicker`.
  - **Mix.** Reuse the filter and send fields from `MixSegment`, keyed to `DRUMS_ROUTE_ID`.
  - **Remove drum lane.**
- **Handlers:** `handleToggleDrumsMute` (~820), `handleToggleDrumStep` (~826),
  `handleToggleDrumPadMute` (~838) and `handleClearDrums` (~814). Volume, filter and sends reuse
  `handleVolume`, `handleFilter` and `handleSendLevel` with `DRUMS_ROUTE_ID`.
- **Reference:** the desktop version is `DrumLane` at D ~782.

### Phase 5: FX buses and master

- **New "Mixer" sheet.** Open it from `MoreSheet`, and add a transport-bar entry if it fits.
- **Buses.** Extract `FxTrackCard` (D ~2496), `FxParamControl` (~2645) and `FxAddButton` (~2690)
  into `components/fx/`.
  - Each bus is an expandable row with mute, solo, return level, remove and its params.
  - Reverb also gets custom IR loading. It's Pro-gated, and Free never lists the "Custom" IR.
  - A tempo-synced bus disables its synced param (D ~2498).
- **Master.**
  - A master volume slider (`MasterStrip`, D ~2373).
  - Extract `MasterChainCard` (D ~2400) into `components/MasterChainCard.jsx`. Its 100 ms meter
    poll must run only while the sheet is open.
- **Handlers:** `handleAddFxTrack` (~1705), `handleRemoveFxTrack` (~1709), `handleFxBusMute`
  (~1263), `handleFxBusSolo` (~1288), `handleFxBusWet` (~1258), `handleFxBusParam` (~1271),
  `handleFxBusCustomIR` (~1279), `handleMasterVolume` (~1296) and `handleMasterChain` (~1301),
  plus the FX bus and master state they read.
- **Bus creation.** FX buses are built on demand (`_ensureFxBus`), so the phone must never touch
  `engine._fxTracks` directly.

### Phase 6: EQ on touch

- **Why a separate editor.** weq8's `<weq8-ui>` needs a fine pointer; `EqPanel` (D ~3107) shows a
  stub on phones.
- **`components/lane/TouchEqEditor.jsx`.**
  - A band list. Each band has on/off, type, frequency, gain and Q, each a slider with a reset.
  - It writes to the same `WEQ8Runtime` returned by `getEqRuntime(routeId)` (M ~1204).
  - Above the list, draw a read-only response curve on a canvas.
- **Check the runtime's setter API first** in `node_modules/weq8`.
- **Autosave.** Edits must reach React through the existing `setOnRouteEqChange` mirror, so
  autosave keeps working.
- **Where it goes:** the lane `MixSegment` and the drum sheet. It also replaces the "needs a
  pointer" stub.
- **weq8 leaks.** Read the weq8 lifecycle notes in AGENTS.md before mounting anything weq8.

### Phase 7: Automation lanes

- **"Auto" segment.** Add it as the fifth tab in `SEGMENTS`. It lists the automation lanes
  attached to this lane. Each one gets:
  - a source line select and a target select, with targets grouped by
    `availableAutomationTargets`
  - the inactive notices (filter model, poly voice, Texture model), as at D ~1957
  - speed, glide and remove
  - loop-region steppers that reuse Phase 2's helper, including "reset to source"
- **Curve editing.**
  - `AutomationCurveEditor` is full width. Tapping or dragging vertically sets a point, using
    pointer events and column-sized hit areas.
  - The selected point gets ±5% and ±1% steppers.
  - Share the point maths with DawView's `AutomationLane` (D ~1881) through a pure
    `lib/automationPoints.js` with tests.
- **Add button.** "+ Automation" calls `handleAddAutomationLane` (~1720).
- **Handlers:** `handleUpdateAutomationLane` (~1739) and `handleRemoveAutomationLane` (~1730).
- **Source lanes in the list.** Automation source lanes are filtered out of
  `visibleInstrumentRoutes`. Show them in the lane list as compact read-only "Data" rows.
- **Lock display.** Use the live value mirror (D ~324) for controls under automation.
- **Phone map links.** The phone map skips automation links (`MapView.jsx` ~858). Turn them on
  only if `?perf=1` shows no frame cost.

### Phase 8: Leftovers and docs

- **Activity sheet.** Add an "Activity" sheet to `MoreSheet` that reads
  `lib/shared/eventLogStore.js`.
- **Reference loop.** Put the waveform with its playhead (`ReferenceLane.jsx` ~280) in the More
  sheet's "Your loop" section. Add the stored-loops list and cloud notes too, if
  `ReferenceControls` lacks them.
- **Tour.** Update `MOBILE_TOUR_STEPS` (`lib/tourSteps.js` ~158) for the new segments and the
  Mixer sheet.
- **Notices.** Do a final pass on `FirstRunNotice`.
- **Docs.** Update the CLAUDE.md "Mobile" section, then run `npm run sync:agents`. Never
  hand-edit `AGENTS.md`. Things that go out of date:
  - the list of `useIsPhone` branches
  - the lane sheet description ("Sound/Mix/Notes" is now Tone/Rhythm/Mix/Notes/Auto)
  - the `components/mobile/lane/` split
  - the "phone has no granular controls" line

## Verification (per phase)

1. Run `npm test`.
2. **Build.**
   - **Stop any dev server for this repo first**, then run `npm run build` (it shares `.next/`).
   - Afterwards, `rm -rf .next` before running `npm run dev` again.
   - Another project's dev server on :3001 is harmless; check a process's cwd with
     `lsof -a -p <pid> -d cwd`.
3. **Phone UI check.**
   - Chrome can't be resized to phone width here, and the app can't be iframed (it sends
     `frame-ancestors 'none'`). Use headless Playwright at `{ viewport: { width: 390,
     height: 844 }, isMobile: true, hasTouch: true }`.
   - Playwright isn't in `package.json`. Install `playwright@1.56.1` into a temp dir, and launch
     with `executablePath` pointing at the cached
     `~/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`.
     That avoids a browser download.
   - **Two things block taps in dev:**
     - The Next dev-tools badge sits over the phone's Play button. Inject
       `nextjs-portal{display:none!important}`.
     - The driver.js tour auto-starts. Click `.driver-popover-close-btn` until it's gone.
     - On phones, dismiss the first-run notice with "Got it".
   - **What to assert:**
     - each new control changes state the same way its desktop twin does
     - the value survives save/reload
     - the value shows the same at 1440px
     - no horizontal scroll (`scrollWidth > innerWidth`)
     - no `pageerror`
   - A console `ERR_CONNECTION_REFUSED` is the feed service on :3005. It's expected in mock
     mode.
   - Also note: new sessions start with every lane **disabled**, so mix export stays disabled
     until you enable a lane.
4. **Desktop regression.** At 1440×900, every extracted card must still work in DawView.
5. **Audio.** Phases 1, 4, 5, 6 and 7 change sound. A green build doesn't verify sound; it has
   to be played and listened to.
6. **Performance.** After Phases 4 and 7 (which add per-frame work), compare
   `scripts/perf_bench.mjs --cpu 4` (against a running prod build) with `develop`.

## Commit / PR conventions

- Branch per phase: `feature/mobile-parity-phase<N>`. PR into `develop`.
- Commit subject style: `feat(mobile): …`.
- Stage only your phase's files. The working tree often has unrelated uncommitted marketing
  files (`digital-product/`, `output/`).
