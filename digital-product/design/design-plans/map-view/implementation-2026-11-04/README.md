# Map improvement implementation plan

4 November 2026 · proposed implementation · no product code changed.

Baseline: `7ec8c80b18b13212d7fc7486c85411962d942146`, plus the uncommitted research documents. Recheck source contracts before execution if the baseline changes. This is the execution plan for [the November research](../research-2026-11-04.md); it supersedes conflicting implementation proposals in the October README/handoff, especially high trail counts and replacement of an already imperative playhead path.

## Outcome and scope

Make Leið's map feel like a spatial musical score: quieter geography, crisp route identity, deliberate route focus and brief feedback where notes sound. Design serves the product; preserve the Night Timetable system. The signature is the relationship between a musical lane and a place.

Deliver phases 0–3 as the core release. Phase 4 improves path accuracy separately. Expanded listening view and automatic performance adaptation are deferred.

Preserve Leaflet/MapLibre, authentic route colours, map gestures, attribution, mounted-tab state, audio scheduling, persistence and mock-only operation. Map focus and motion preferences are UI state, not song state. No new animation dependency or map-stack migration.

Evidence: current CodeGraph-backed source inspection, November primary-source research, and October rendered screenshots. Visual findings from October must be reconfirmed in phase 0; this plan does not certify the current rendered UI or promise performance gains. Mobbin references guide composition only; no full motion flows were verified.

## Sequence and release gates

| Phase | Deliverable | Dependency | Completion gate |
| --- | --- | --- | --- |
| 0 | Fresh UI and performance baseline | None | Saved reproducible workload, screenshots and traces |
| 1 | Quiet geography, route hierarchy, control composition | 0 | Both themes/readable routes; no measured regression |
| 2 | Visual route focus and progressive stop detail | 1 | Keyboard/touch usable; focus never changes sound |
| 3 | Bounded musical motion and reduced-motion fallback | 2 | Effect caps/lifecycle correct; no repeatable audio regression |
| 4 | Cached shape-following playheads | Core release stable | Geometry/timing parity and performance gate pass |

Each phase should be an independently reviewable commit. Core release can ship before phase 4. Do not retain two active renderers while transitioning.

## Phase 0: establish the actual baseline

1. Check the worktree and preserve unrelated edits. Use the current project instructions and existing map research as context; do not assume October defects still reproduce.
2. Run the app and capture the map in both themes: desktop, 820px tablet and 390px phone. Include all-off, stopped with enabled lanes, and playback. Confirm legend/zoom placement, map sizing and current camera behavior. Reproduce any tablet zero-size issue before fixing it.
3. Stop Next dev before `npm run build`, then run `npm run start` for the benchmark. Do not build and run dev against the same `.next` simultaneously.
4. Save fixed Berlin and NYC workloads at 6 and 24 mapped lanes, including the same instruments/effects, tempo, viewport, zoom and camera. Create the 24-lane fixture explicitly and verify the actual count; if product limits prevent it, record the highest supported count. Preserve a song snapshot or documented repeatable setup. Record browser/hardware, output device, power mode and screen refresh rate.
5. After 20 seconds of warmup, collect three 60-second runs per primary baseline/candidate workload. Reset cumulative monitoring between runs. Use the existing `?perf=1` HUD and `window.leidPerf` reporting plus browser Performance traces. The existing benchmark script is supplementary; do not assume it exercises the map unless its scenario is confirmed.

Save results beside this plan in `validation/`: workload description, baseline/candidate metrics, screenshots and trace locations. Do not commit audio recordings or large traces by default.

Gate: a developer can repeat the same workload. Label historical findings separately from current reproductions.

## Phase 1: improve the map while it is still

### Theme-aware geography

- In `components/MapView.jsx`, connect `BaseMap` to `useTheme()` from `lib/shared/ThemeContext.jsx` (`{theme, setTheme, toggleTheme}`, theme is `dark` or `light`). Retain the same Leaflet instance and camera when changing theme. Update the existing layer through `getMaplibreMap()` and preserve its ResizeObserver calls to both Leaflet invalidateSize and MapLibre resize.
- Add `public/maps/leid-dark.json` and `public/maps/leid-light.json` as attributed, locally versioned style definitions derived from compatible OpenFreeMap styles. Retain source tile/glyph/sprite URLs and provider attribution. Verify redistribution terms before copying style assets.
- Hide POIs, minor-road labels and 3D/extrusion layers. Retain rivers, major roads, districts and restrained city labels. Tune neutral land/water contrast independently for dark and light.
- Avoid CSS filters over the whole map and crossfading duplicate map canvases. Theme changes use the existing MapLibre style lifecycle, with readiness/error handling and cleanup of superseded loads.
- On background failure, routes remain usable over `--bg`; show “Map background unavailable” and a Retry action. Do not block music or map controls. If MapLibre creation itself fails, the Leaflet route surface must still work.

### Route hierarchy and control layout

- Replace wide coloured static underlays with a 3px active route stroke. Use a 5px neutral casing only where separation/contrast requires it. No static coloured glow.
- Keep inactive route identity explicit: dashed 1px preview at 0.25 opacity; avoid opacity on text. In all-off state increase route previews to 0.35 and show “Enable a lane to hear the city.” The associated “Show lanes” action opens existing lane controls, without enabling anything.
- Remove decorative legend grid backgrounds. Desktop legend: upper left, 12px inset, width 192px, 32px rows and 8px panel padding. Cap height to available map height and scroll internally. Long route names ellipsize with full accessible name/title.
- Put zoom and fit controls upper right, 12px inset with 8px gaps. Reserve attribution at the bottom; do not obscure it with composer or transport overlays.
- At 768–1023px start with the legend collapsed. Below 768px use a 44px-high “Lanes” disclosure with selected route badge; full controls live in the existing sheet pattern. Respect safe areas and existing phone transport.
- Use `(pointer: coarse)` to enlarge controls/rows to at least 44px even on tablets; do not infer touch from width alone.
- Preserve initial city/song framing, but do not reset a user-panned camera during lane enable/disable, focus changes or map return. Reset to city framing on an actual city change. Explicit Fit mix fits audible mapped routes, falling back to selected previews then city bounds. Fit route fits the focused geometry. Account for visible overlay bounds and cap fit zoom at 14 for degenerate/single-stop routes.

Gate: both themes preserve visible route identity and readable controls; no overlap with attribution; user framing survives editing. Recheck 767/768/820/1023/1024px transitions.

## Phase 2: let the user watch one route

### Focus interaction and state

- Add map-local `focusedLaneId` with stable lane identity. Do not use route name as a key. The current MapView receives base routes only; add an explicit `mapLanes` descriptor prop from MixerTab for lane identity/source geography. Reuse `lib/songLanes.js` descriptors: duplicates carry `sourceId`; merged lanes carry `sourceIds`/`sourceRoutes`. Never parse synthetic IDs. Deduplicate physical polylines while preserving distinct selectable lane rows.
- Make legend focus targets real buttons, with `aria-pressed` and an accessible label such as “Focus M2 on map”. Selecting the same lane toggles focus off. Keep audio Enable/Solo actions separate and reuse their authoritative handlers where exposed.
- Clicking an interactive route focuses its lane. For shared geography, retain a selected matching lane if possible; otherwise choose the first visible matching lane and expose duplicate identities in the legend. Never infer that clicking a line should solo it.
- Restore pointer events on the currently noninteractive desktop legend. Stop map propagation only within controls; retain map drag/scroll everywhere outside the panel. Preserve the existing mounted map and `active` lifecycle from MixerTab.
- Selected route: 4px stroke, full route colour and optional 6px neutral casing. Other enabled routes remain visible at 0.5 opacity; off previews retain off styling. Selection also appears in text and the button border, so colour alone is insufficient.
- Desktop focus details appear below the legend, max width 240px: route badge/name, existing role label, “Fit route” and “Clear focus”. Include selected stop name when the user selects a stop. Do not add live per-frame text readouts.
- Route/stop selection is event-driven React state. If a sounding-stop highlight updates during playback, use existing refs/ticker and a stable HTML readout, coalesced to at most two changes/second. Never announce each note with `aria-live`.
- Clear focus on city change, song replacement or removal of that lane. Keep it when a lane is disabled and label it “Off”; visual inspection does not imply audibility.
- For merged lanes, focus the existing source-route group. For duplicate lanes, show the shared route but preserve the chosen lane's name/role. Drums or unavailable geography show “No map geometry” and disable Fit route with visible explanation; music remains playable.

### Stop detail

- Below zoom 13 show no passive stop markers; selected/current stop indication can remain.
- At zoom 13 and above render only the focused route/group's visible stops. Filter by viewport on `moveend`/`zoomend`, not on each frame. Use the existing route Canvas path on phones; avoid all-city DOM markers.
- Cap passive stop rendering at 80 markers desktop / 24 phone. Above capacity sample by stop order while always retaining selected stop and endpoints; the full ordered station list remains available in focus details. No collision engine or per-frame label layout.
- Show one selected-stop label, rather than labels for every station. Full names wrap in details. A keyboard-accessible “Stops” disclosure provides the ordered list; selecting an item highlights that stop without moving the camera automatically. Expose an explicit “Show stop” action if it is offscreen.
- Phone: opening Lanes uses existing `Sheet` (`open`, `title`, `onClose`, `children`, optional `toolbar`/`footer`) and its built-in modal ownership. Selecting focus closes the sheet and returns focus to its trigger; a compact selected-route summary remains on the map. Escape closes the top sheet; Clear focus clears only visual selection. Preserve `components/mobile.css` inset-driven map positioning between the top and thumb bars.

Gate: mouse, keyboard and touch can focus, inspect a stop and return to the mix. Confirm audio volumes, solo/disabled sets and playback position do not change through visual actions.

## Phase 3: keep animation musical and bounded

Refine the existing imperative heads, Canvas trails and note ripple path. Do not replace working rendering simply to introduce a new abstraction.

- Remove independent breathing pulses; automation paths use static dashes by default. Keep automation value/target semantics.
- Keep dynamic map updates at the existing approximately 30fps ceiling; trail samples remain at most 10 per head desktop / 5 phone. Use the shared ticker; no extra frame loop and no per-frame React state.
- Note rings: 220ms lifetime; diameter 12px → 28px; opacity 0.65 → 0; scale easing `cubic-bezier(0.22, 1, 0.36, 1)`, opacity linear. Animate an inner node so Leaflet retains control of its outer positioning transform. Keep one effect per lane+stop, coalescing repeated attacks to maximum velocity within a flush.
- Bound simultaneous rings to 8 desktop / 4 phone. At capacity replace the oldest visual effect. Preserve musical events and event-log delivery; limits apply only to visuals.
- Consume actual emitted-note events, respecting rests/chance/disable/solo behavior. Preserve existing lookahead alignment initially; do not call it sample-accurate. Drop events older than 220ms in the visual clock. Do not add engine timing fields in this release unless manual comparison demonstrates a sync defect requiring them.
- Merged engine events currently lack source-stop geographic identity. Show the focused source-route group, but suppress station-specific rings unless a real coordinate/source-stop mapping is present. Do not match a guessed location from a stop name. Nongeographical drum events never produce map rings.
- On stop, map deactivation, document hidden, city/song replacement or relevant route removal: cancel pending visual events and clear effects. On return draw current phase, never historical attacks. Dynamic subscriptions must be absent while hidden/stopped; CSS loops must also stop.
- Add a “Reduce motion” control using OS preference as the default and a per-device opt-in. Effective reduction is OS reduce **or** user reduce; do not override the OS setting to increase motion. Subscribe to preference changes.
- Reduced mode suppresses travelling heads, trails, expanding rings and smooth camera moves. Retain static routes and selected/current-stop indication, coalesced to at most two visual changes/second. Hidden view still does no dynamic work.

HTML focus details enter with opacity 0→1 and translateY(4px)→0 over 160ms, using `cubic-bezier(0.22, 1, 0.36, 1)`; exit opacity over 100ms `ease-in`. No scale/press animation: preserve the design system's stable controls. Fit uses the existing Leaflet camera animation with 250ms duration, interruptible by gestures; reduced mode is instant. Motion values follow the design skill's [motion scale](/Users/attilaerdei/.agents/skills/design/references/motion.md).

Gate: inspect at 10% animation speed in DevTools; test preference changes while playing, rapid stop/start, tab switching and dense attacks. Confirm no stale attacks, detached layers, accumulating timers or extra ticker subscribers.

## Phase 4: improve path accuracy separately

- Add pure cached geometry helpers in `lib/mapGeometry.js`; consume them from existing MapView playheads/trails. Keep `lib/mapPlayhead.js` authoritative for ticks, speed, loops and wrap.
- Select a route shape compatible with stop order/direction; project stops monotonically onto it once. Map the existing musical distance domain to shape distance between projected stops. Cache by route, direction and geometry identity.
- Locate segments with binary search/cached segment indices; do not scan an entire route for every trail sample. Rebuild on geometry replacement, not camera movement or tempo changes.
- Handle partial loops, wrap discontinuities, duplicate coordinates, branches, missing shapes and negative longitude. Ambiguous/disconnected geometry falls back to current stop interpolation; no connections between unrelated segments.
- No GTFS regeneration, engine timing changes or change to when a stop sounds. Keep current trail/effect caps. Do not add following cameras or route-wide animated stroke effects.

Gate: meaningful pure tests establish interpolation stays on chosen geometry and musical phase is unchanged; manual pan/zoom and all-city spot checks show alignment; performance remains within budget.

## State and accessibility contract

| State | Required behavior |
| --- | --- |
| Loading | “Loading routes…”; neutral surface, no fake animated network |
| Empty song | “Add a lane to begin”; use existing lane-selection entry |
| All off | Dashed previews + enable guidance; no note effects |
| Enabled/stopped | Crisp routes, quiet controls; no continuous animation |
| Playing/rest/chance drop | Heads reflect phase; attack effects only for actual notes |
| Hover | Transient existing tooltip; never persistent selection |
| Keyboard focus | Existing 2px accent focus ring, not clipped by panel |
| Selected | Named lane + pressed button and stronger route; independent of audio |
| Disabled action | Fit disabled without geometry; adjacent reason visible |
| Data error | Existing retry/error surface; no fabricated stops |
| Background error | Routes remain available, readable status + Retry |
| Recovery | Clear error, preserve valid focus/camera; no success toast |
| Reduced motion | Static geographical view with bounded discrete stop indication |
| Hidden | No rendering subscription, pending attacks or CSS loops |

Reuse Inter and mono readouts. Text contrast ≥4.5:1, focus/control boundaries ≥3:1. Use readable tokens, never `--muted-line` for text. Icons come from `components/icons.jsx`; map-local overlays retain isolation and named app z-index rules. All sheet/dialog behavior uses `useModal` via existing primitives. Nonmodal focus details do not trap focus. Keep Leaflet keyboard pan/zoom working when the map owns focus.

## Token map

No global token redesign. Map-specific constants belong in scoped styles/helpers; a new global token needs wider consumers.

| Role | Value |
| --- | --- |
| Panel / control / border | `--surface` / `--surface2` / `--border` |
| Text / secondary / selection | `--text` / `--muted` / `--accent` |
| Body / readout / label | `--fs-sm` / `--fs-xs` + mono / `--fs-3xs` |
| Control / panel radius | `--radius-sm` / `--radius-md` |
| Floating panel elevation | `--elevation-overlay` |
| Spacing | 4, 8, 12, 16, 24px mapped to existing spacing tokens |
| Legend / detail width | 192px / 240px maximum |
| Row / coarse target | 32px / 44px minimum |

```json
{
  "baseUnitPx": 4,
  "spacingPx": [4, 8, 12, 16, 24],
  "colors": {"panel": "--surface", "control": "--surface2", "border": "--border", "text": "--text", "secondary": "--muted", "selection": "--accent", "route": "existing route colour"},
  "typography": {"body": "--fs-sm", "readout": "--fs-xs", "labelFloor": "--fs-3xs"},
  "radius": {"control": "--radius-sm", "panel": "--radius-md"},
  "shadow": "--elevation-overlay",
  "layout": {"legendWidthPx": 192, "detailsMaxWidthPx": 240, "rowPx": 32, "coarseTargetPx": 44},
  "motionMs": {"detailsEnter": 160, "detailsExit": 100, "noteRing": 220, "fit": 250}
}
```

## File-level implementation scope

Paths for new helpers are proposed; create only when extraction is justified by shared policy or independently testable logic. No files need deletion.

| File | Change | Preserve / verify |
| --- | --- | --- |
| `components/MapView.jsx` | Theme/style lifecycle, focus, camera ownership, filtered stops, bounded effects and reduced motion | Imperative ticker path, static memoization, mobile Canvas, resize/attribution, no audio mutations |
| `components/MapView.css` | Flat legend, route states, bounded overlay composition and scoped motion | Semantic tokens, isolation, focus visibility |
| `components/mobile.css` | Phone sheet/summary and safe-area spacing; tablet correction only if reproduced | Existing phone transport and stylesheet precedence |
| `components/app.css` | Map grid correction only if phase 0 proves one remains | DAW grid and route-specific layout |
| `components/tabs/MixerTab.jsx` | Supply authoritative lane identity/source mapping and existing handlers only as needed | Audio state ownership and all persistence paths |
| `lib/songLanes.js` | Reuse duplicate/merged descriptors; no ID parsing or new lane model | `sourceId`, `sourceIds`, `sourceRoutes` and existing lane identity |
| `components/Sheet.jsx`, `lib/shared/useModal.js`, `components/icons.jsx` | Reuse APIs; modify only if a required icon export is absent | Modal ownership and keyboard/focus contract |
| `lib/shared/ThemeContext.jsx` | Reuse context, no redesign expected | Theme persistence and app-wide behavior |
| `lib/mapVisualPolicy.js` (proposed) | Pure lane-to-map resolution, stop admission and effect queue policy if needed | Shared geography, deterministic bounds, independently testable rules |
| `lib/mapGeometry.js` (phase 4) | Cached projection/interpolation helpers | Musical distance domain and safe fallback |
| `public/maps/leid-dark.json`, `public/maps/leid-light.json` | Tuned style assets | Attribution, valid sources, no secrets |
| `lib/shared/playheadTicker.js`, `lib/shared/eventLogStore.js`, `lib/perfMonitor.js` | Reuse existing subscriptions/reports; no redesign planned | One ticker, low callback cost, monitoring privacy |
| `test/map-visual-policy.test.js`, `test/map-geometry.test.js` (if helpers created) | Behavioral edge cases | No tests mirroring CSS constants/layout |
| `CLAUDE.md` → generated `AGENTS.md` | Update only if architecture guidance becomes inaccurate | Regenerate; never hand-edit AGENTS.md |

## Performance acceptance and verification

Hard architecture limits: no new dependency, second rAF loop or per-frame React commits; trail samples ≤10/5 desktop/phone; ring counts ≤8/4; offscreen and stopped work cancelled. The heads' approximately 30fps update ceiling is not a 30fps target for the entire application.

Proposed measured targets: incremental dynamic-map callback p95 ≤2ms desktop / ≤4ms phone on the recorded hardware. Inspect total style/layout/paint/GPU work as well. Target no more than 10% worsening of session frame p95 in repeated matched runs; if baseline is already unstable, use traces and component costs rather than accepting an unstable candidate because the percentage passes. Any repeatable increase in audio dropouts or late notes blocks release. These are acceptance targets to measure, not achieved results.

Validation commands during implementation:

```bash
# Run only when corresponding new helpers/tests exist:
node --test test/map-playhead.test.js test/map-visual-policy.test.js
node --test test/map-playhead.test.js test/map-geometry.test.js

# Before release:
npm test
# Stop Next dev first:
npm run build
npm run start

# Supplementary startup map scenario (replace URL if needed):
node scripts/perf_bench.mjs --url http://localhost:3000/ --view map --lanes 6 --cpu 1 --secs 60 --runs 3
```

Benchmark caveat: the script enables the first N available controls using fresh startup picks; it cannot select a fixed city/preset, create missing lanes, or guarantee the requested count. Its audio capacity metrics do not establish audible dropout quality. Use manually loaded saved fixtures for matched-city/song runs, or add a narrowly scoped fixture-loading extension before relying on automated results. Optional CPU-throttled stress runs use `--cpu 4`; record them separately from normal-load runs.

If architecture docs change, run `npm run sync:agents` then `npm run sync:agents -- --check`. There is no lint/typecheck configured. A green build does not validate audio or perceived synchronization.

Manual release matrix: all seven cities in both themes; 320/390/414/768/820/1024/1440/1920px; long labels, all-off, city/song switching, duplicate/merged/automation/drum lanes, solo/disabled combinations, partial loops, pan/zoom during playback, theme/style failure and recovery, preference changes and hidden-tab return. Listen to real output at 60/120/180 BPM. Test keyboard-only and a screen reader; no per-note announcement flood.

Record before/after evidence and unresolved issues in `validation/results.md`. If target phone hardware is unavailable, explicitly report that gap rather than claim mobile performance passed. Optional five-person usability check: four can identify/focus a sounding route and restore the mix without guidance; this is a usability target, not a retention claim.

## Stop conditions and deferred scope

Reassess before expanding scope if geometry requires new GTFS preprocessing, musical clock changes, full renderer migration or unacceptable startup work. Preserve stop-to-stop fallback rather than block the core release. Resolve style asset licence/access issues before distributing copies. If visual effects exceed budget, remove rings first, then trails, before changing audio work.

Deferred: expanded listening/fullscreen mode, adaptive fidelity controller, live data, 3D, heatmaps, route-wide marching animation, camera follow/orbit and new audio-time event fields without demonstrated need.

Plan complete when its handoff is available; implementation complete only after the phase gates, production build, actual-audio checks and device evidence are recorded. This task produces documentation only.
