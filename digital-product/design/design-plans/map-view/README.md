# Make Leið's map a spatial score

Research and implementation plan, 9 October 2026.

Written against commit `00a846727d94f3cf354b7630358d1b18ede5bdb1`. Status: proposed implementation, ready for engineering estimation. This package contains a specification and current-state evidence; it does not implement or visually validate the proposed design.

## Outcome and direction

Make the city worth watching while it plays, and make the relationship between a sound, its lane and its station immediately understandable.

**Design read:** a dense musical instrument with a geographical performance surface, using Leið's existing Night Timetable language. Design serves the product. Keep Inter, monospace readouts, quiet controls, neutral surfaces and real route colours.

**One signature move:** a bright musical playhead travels along each enabled route's actual geometry; the station that produces a note briefly responds at the scheduled audio time. The city becomes a spatial score, with each lane retaining its independent cycle.

Everything supports that move: subdued streets, useful framing, readable station hierarchy and explicit lane focus. Avoid permanent neon underglows, global beat flashes, ornamental particles, new colour palettes, 3D buildings and an automatically roaming camera.

Assumptions: this improves the existing Map surface on desktop and phone; playback remains mock-only; lane selection, music generation and audio behavior remain authoritative. Map preferences are per-device UI state, not song state. The first release needs no new map library, provider or feed service.

## Research: relevant patterns

These are primary-source references, reviewed on 9 October 2026. The design takeaways are recommendations inferred from the examples, not measured evidence that a feature will improve Leið.

| Reference | What the source demonstrates | Application to Leið |
| --- | --- | --- |
| [Mini Metro, Dinosaur Polo Club](https://dinopoloclub.com/games/mini-metro/) and its [press kit](https://old.dinopoloclub.com/press/sheet.php?p=mini_metro) | An animated subway network with a deliberately minimal diagram language and dynamic soundtrack. | Make routes and stations the main composition. Borrow visual restraint; retain real geography rather than build a schematic-layout engine. |
| [TransitFlow, Will Geary](https://willgeary.github.io/portfolio/projects/transitflow/) | Animated scheduled transit flows; its documented implementation interpolates between stops. | Borrow the sense of motion revealing a city's structure. Use Leið's musical clock and existing GTFS shapes, rather than copy its historical Processing pipeline or straight-line interpolation. |
| [MTA Live Subway Map, Work & Co](https://work.co/clients/mta/) and [launch case study](https://work.co/news/mta-new-live-subway-map/) | Geographic context combined with clear routes, moving trains and greater detail at closer zooms. | Reveal station detail progressively and make route focus explicit. This is a historical design reference; the plan does not depend on the original live site being available today. |
| [Mini Tokyo 3D, official overview](https://minitokyo3d.com/docs/master/user-guide/overview.html) | Smooth vehicle motion, official line colours, symbolic vehicle shapes and optional train tracking. | Borrow continuity and legibility. Keep the first release flat and camera-stable; defer following a moving lane until there is a demonstrated need. |
| [Patatap](https://patatap.com/) and [its creator's account](https://jonofyi.substack.com/p/looking-toward-an-anniversary) | Sound and animated visual output are produced from the same interaction. | Treat note response as musical feedback, triggered by emitted notes. Do not transplant its large colour changes or flashing compositions into a DAW. |

The project's original inspiration, trainjazz.com, was also checked, but its page could not be retrieved by the research tool. No new design claims here depend on inspecting it.

Technical references: [OpenFreeMap custom styles and Leaflet integration](https://openfreemap.org/quick_start/), [Tone getDraw](https://tonejs.github.io/docs/15.0.4/functions/getDraw.html), and [deck.gl TripsLayer](https://deck.gl/docs/api-reference/geo-layers/trips-layer). TripsLayer is an example of time-indexed trails, not a proposed dependency. OpenFreeMap documents the hybrid stack already in use and supports a hosted custom style JSON.

## Current map: observed evidence

Inspected the local `/` route with Budapest data, initially all lanes disabled, then M1 and M2 enabled during playback. Screenshots are current-state captures, not mockups:

- [Desktop, all disabled, 1280 × 577](evidence/desktop-all-disabled.png).
- [Desktop, playing, 1280 × 577](evidence/desktop-playing.png).
- [Desktop, light theme, 1280 × 577](evidence/desktop-light.png).
- [Phone, stopped, 390 × 844](evidence/phone.png).
- [Tablet, blank map, 820 × 900](evidence/tablet-layout-failure.png).

| Before | After proposed | Why / evidence chain |
| --- | --- | --- |
| All-disabled routes occupy a small part of a large dark canvas; the expanded composer covers the lower right. | A composed resting view, explicit lane-enable guidance and fit padding that accounts for overlays. | `/` → `MixerTab` → `MapView` → `CityView`; all-disabled screenshot. Silence is intentional, but should read as a usable starting state. |
| The lane legend occupies the same upper-left area as zoom controls. | Legend left, zoom and map controls right, attribution reserved below. | Playing screenshot; `.map-track-status` in `MapView.css` uses `top:10px; left:10px`, competing with Leaflet's default zoom placement. |
| Enabled routes have broad static underglows; roads and labels compete when zoomed in. | Crisp route strokes over quieter geography; light belongs to the moving head and the sounding station. | Playing screenshot and route-layer/CSS implementation; aligns with DESIGN.md's Earned Glow Rule. |
| Light application chrome surrounds an unchanged black basemap. | A separately tuned light map palette. | Light screenshot; `BaseMap` hardcodes the OpenFreeMap dark style. |
| Trails and ripples already exist. | Improve their geometry, timing and hierarchy instead of adding redundant effects. | `MapView.jsx`, `mapPlayhead.js` and `NoteRipples`; confirmed during playback. |

Confirmed tablet prerequisite: resizing this session to 820 × 900 left the content area blank with Map selected, while 390px and 1280px rendered. Browser inspection found `.map-wrapper` and `.leaflet-container` at `x:820, y:900, width:0, height:0`. The resolved `.daw--map` grid was `"header" "tracks" "footer"`, although the map child still used `grid-area: map`. `components/mobile.css:187` overrides all `.daw` grids at 768–1023px, replacing the `"header" "map" "footer"` areas in `components/app.css:182`. Scope that tablet override to the lane view, or add a matching tablet map grid. This is a layout defect to resolve before judging tablet visual improvements.

**Current verdict: improvement needed.** The rendered map already has a useful musical foundation. Its composition, control placement and theme treatment weaken that foundation.

## Scope and technical constraints

Keep the existing Leaflet 1.9.4 / React Leaflet 5 / MapLibre 5 hybrid. MapLibre supplies the OpenFreeMap basemap; Leaflet owns the interactive route layers. Preserve resize handling, attribution, map isolation, mounted tab state and native map gestures.

Important implementation facts:

- `MapView.jsx` currently updates playhead positions through React state about 30 times per second. Replace that path before increasing effects. The repository requires imperative per-frame updates.
- Static route geometry is memoized to prevent previous large-city freezes. Keep it separate from dynamic drawing.
- `positionAlongRoute()` interpolates stop coordinates, while the displayed route follows detailed polylines. A path adapter must align the two.
- `lib/mapPlayhead.js` already resolves transport ticks, per-lane speed and loop regions. Extend its consumers, not its musical meaning.
- Engine note callbacks pass route/stop/velocity data after note gates, but omit scheduled audio time. The event log batches notifications through rAF; current ripples add a fixed look-ahead delay. Do not mistake this for exact synchronization.
- Map inputs are base routes. Duplicates, merged lanes, drums and automation need explicit visual semantics; they cannot all be treated as ordinary transit vehicles.

Out of scope: restoring Live, changing chance/rest behavior, synthesizer work, new GTFS downloads, ridership heatmaps, weather, schematic generation, 3D rendering, new analytics infrastructure and MIDI/WAV visual export.

## Implementation sequence

The estimates below are rough engineering planning ranges, including verification, not delivery commitments. Ship stages 1–3 as the core improvement; stage 4 is optional.

### 1. Compose the resting and playing map (1–2 days)

**Result:** the map looks intentional before playback and routes dominate when playing.

- Fix the confirmed tablet grid collision first. Verify direct load and resize across 767, 768, 820, 1023 and 1024px; the map rectangle must be nonzero and occupy the intended content row.
- Replace static active-route glows with a 3px solid route stroke and a 5px neutral casing for separation where needed. Disabled routes are hidden in the normal playing view. When every lane is off, show the existing selected routes as 1px dashed previews at 0.35 opacity, explicitly labelled as off.
- Add a restrained playback-empty message: “Enable a lane to hear the city.” Supporting copy: “Each route becomes a musical lane.” Its “Show lanes” button expands the legend; it never auto-enables a lane or starts audio.
- Fit only selected lane geometry when all lanes are disabled, or mapped enabled/solo lanes when active. Do not include the city's entire route catalogue. Retain the current fallback to city bounds if no usable selected geometry exists. Avoid tight-framing a single point; cap automatic fit at zoom 14.
- Tune two basemap styles: dark based on OpenFreeMap Dark, light based on Positron. Use neutral water/land contrast, remove POIs and minor-road labels, retain district names and major roads. Copy source styles into local, attributed style assets so tuning does not depend on unstable external layer IDs. Keep remote tile/glyph/sprite references intact.
- Connect `BaseMap` to `useTheme()`. Update style without reconstructing Leaflet or losing camera position. Preserve resize observers and handle style-load failure.
- Move zoom to the upper right; place the map toolbar beside it in a single stack. Place the legend at the upper left with its own bounds. Reserve attribution at bottom right and provider/city attribution at bottom left.

**Acceptance:** no legend/zoom overlap; all-off is understandable; active geometry fills the usable viewport; light mode has a light map; both themes retain city identity and readable route contrast.

### 2. Make motion accurate and inexpensive (2–3 days)

**Result:** movement follows routes and visible note attacks track the musical clock without frame-rate React rendering.

- Add an imperative Canvas layer for moving heads, trails and note rings. Static route geometry stays memoized and interactive. Canvas is pointer-transparent and `aria-hidden`; accessible controls remain in HTML. Subscribe to `subscribePlayhead()`, unsubscribe when the map is hidden, and stop drawing in a hidden document.
- Introduce a pure geometry adapter. Select a shape matching the playback stop order; project stops onto that shape with monotonically increasing distance; retain the existing musical `stop.dist` domain and interpolate between projected stop positions. Cache per route/direction/geometry identity. Do not replace musical distances with physical length and thereby change note timing.
- Preserve loop-start/end boundaries, wrap behavior and negative longitude. For ambiguous branches, disconnected shapes or absent geometry, use the existing stop-to-stop fallback rather than join unrelated segments. Label this as a fallback in developer diagnostics only.
- Add optional `audioTime` to relevant mock note-event payloads using the already supplied scheduled callback time. Preserve every existing field, the event-log API and gate order. Consume events idempotently; start visual attacks using that audio timestamp and the same audio clock, accounting for time spent in the event batch. `Tone.getDraw()` is a candidate scheduling adapter, subject to the installed version and cancellation behavior.
- Reset visual queues on Stop, city/song change and route replacement. Late events older than their visual lifetime are dropped; do not replay a backlog when returning to the tab. No timer or animation may schedule sound.
- Keep one head per mapped enabled lane, with a two-beat tail clipped to its own loop. Trail points are sampled from current tick phase, not accumulated wall-clock frame history.
- Bound work: DPR at most 2, 64 trail samples per head on desktop / 32 on phone, at most 48 simultaneous note rings desktop / 16 phone. Coalesce overlapping attacks by route+stop within a frame, keeping maximum velocity. Drop oldest visual rings at capacity, never musical events.

**Acceptance:** heads stay on the route; tempo changes do not shift lane phase; rest/chance drops never produce attack rings; no React state updates occur per animation frame; Stop/hidden view stops dynamic work; no audio scheduling or export behavior changes.

### 3. Add route focus and station feedback (1–2 days)

**Result:** users can watch a particular musical line and understand which station produced a note.

- Upgrade the legend into compact lane rows with a route badge, optional role label, focus action and separate enable action. Route colour stays route colour; role tags keep their own existing palette. Use existing enable handlers, never a second disable-state store.
- Clicking a route or its row selects a visual focus. Hover gives a transient emphasis; keyboard focus gives the same preview. Selection persists until cleared. Focusing never changes audio solo, lane enablement or transport state.
- Dim other enabled routes to 0.35 opacity during focus; retain their heads so the mix remains visible. Selected route gets a 4px stroke, selected chip border, route name and explicit selected state. Clear focus with Escape when no modal is open, an empty-map click, or a labelled “Clear focus” button.
- Show station dots progressively: zoom below 12 shows route endpoints and the sounding station; zoom 12–13 adds focused-route stops; zoom 14+ allows all focused-route stop labels subject to collision checks. Use actual shared stop IDs for interchange marks; proximity alone does not prove an interchange. Missing IDs mean ordinary stop symbols.
- Prioritize label collision order: selected station, sounding station, endpoints, remaining focused-route stops. Limit persistent labels to 12; a selected label replaces the lowest-priority label. Tooltip/accessible station list exposes the full name, including long Budapest and Zürich stop names.
- Add a quiet readout tied to the focused lane: route name, most recent sounding station and note. At rest use “Ready”; during a loop-rest use “Resting”. Readout history is per route, not whichever event arrived last globally. Keep high-frequency updates imperative; do not announce each note through a screen reader.
- Add explicit “Fit mix” and “Fit route” actions. Auto-fit on city/song load; after the user pans/zooms, route membership changes do not seize the camera. Explicit fit resets the manual-camera flag. Focusing changes emphasis immediately; camera movement requires “Fit route”.

**Acceptance:** users can identify a sounding route and station without opening DAW; route selection is keyboard-operable; focus never changes the sound; disabled lanes can be enabled deliberately from the map; camera never fights a manual gesture.

### 4. Optional expanded listening view (about 1 day)

Add “Expand map” to hide secondary DAW chrome and give the existing map more space within the application. Retain Play/Stop, tempo, city access and a visible “Exit expanded map” control. Escape exits unless a modal owns it. Preserve focus and camera; call the existing resize path after layout changes. This is an inline application view, not a new browser-fullscreen dependency or modal.

Do not add camera orbit, route following or new effects here. The extra space should make the already improved map more compelling. Implement only after stages 1–3 pass their performance and accessibility checks.

## Visual and interaction specification

Values below are initial implementation targets to verify with rendered evidence, not measured properties of the current map.

| Element | Specification |
| --- | --- |
| Map chrome | Existing `--surface`, `--surface2`, `--border`, `--text`, `--muted`, `--accent`; 1px borders, `--radius-sm`; no new font or accent. |
| Desktop legend | Top/left 12px; 176px wide; maximum height `min(360px, available map height - 96px)`; internal scroll; 32px rows, 44px for coarse pointer. Hide secondary role label before shrinking route names. |
| Right toolbar | Top/right 12px; 32px controls with 8px group gap; 44px controls for coarse pointer. Accessible names include “Fit mix”, “Fit route”, “Reduce map motion”. |
| Bottom readout | Left 12px above city attribution; at most 320px wide; 8px × 12px padding; mono values at `--fs-xs`, text at `--fs-sm`; compact 1-row version at short heights. |
| Overlay-safe fitting | Calculate padding from actual legend, toolbar, composer and phone bar rectangles; preserve at least 24px between fitted geometry and reserved chrome. Do not keep a stale fixed `[110,30]` padding. |
| Route / head | Route 3px, focused 4px. Head core radius 4px with 1px neutral separation; active-only halo radius 8px at 0.2 opacity. Trail fades from 0.65 to 0 over two beats, uses route colour, width 3px. No static route glow. |
| Station response | Core radius 3px; one ring expands from radius 4px to `8 + 8 × velocity` px and fades to zero. Lifetime one beat clamped to 150–300ms. Position and brightness encode an actual emitted note, not a simulated beat. |
| UI motion | Focus/hover emphasis 120ms; panel enter 180ms and exit 120ms; easing `cubic-bezier(0.22,1,0.36,1)`. Travel/phase interpolation linear. Fit camera 250ms, interruptible; reduced motion uses immediate fit. Controls keep the existing no-growth pressed behavior. |

Reuse `DESIGN.md`, `app/globals.css`, the segments in MixerTab, `components/icons.jsx`, `LaneTagEditor` role vocabulary and the existing MapView legend. New Canvas and geometry helpers are justified by per-frame drawing and shape interpolation, responsibilities the existing React route tree and stop-coordinate interpolator cannot express efficiently.

Structured token map (references existing semantic roles; these are not new global overrides):

```json
{
  "baseUnitPx": 4,
  "spacingPx": [4, 8, 12, 16, 24],
  "colors": {
    "panel": "var(--surface)",
    "control": "var(--surface2)",
    "border": "var(--border)",
    "text": "var(--text)",
    "secondaryText": "var(--muted)",
    "selection": "var(--accent)",
    "route": "existing route color",
    "automation": "existing automation status tokens"
  },
  "typography": {"body": "--fs-sm", "readout": "--fs-xs", "labelFloor": "--fs-3xs"},
  "radius": {"controls": "--radius-sm", "panel": "--radius-md"},
  "shadow": {"floatingPanel": "--elevation-overlay"},
  "layout": {"legendWidthPx": 176, "rowPx": 32, "touchTargetPx": 44},
  "motionMs": {"feedback": 120, "enter": 180, "exit": 120, "fit": 250}
}
```

## State and accessibility contract

| State | Behavior |
| --- | --- |
| Loading routes | Neutral map surface and “Loading routes…” status; no decorative animation or fake progress. |
| Routes available, all lanes off | Dashed preview network and enable guidance; no moving heads or note effects. |
| Enabled, stopped | Crisp routes, “Ready” readout, no looping animation. |
| Playing | Moving heads reflect timeline phase; attacks reflect actual emitted notes. A cursor alone never claims a note sounded. |
| Chance drop / loop rest | No attack ring for skipped notes. During a rest, head is a hollow timing cursor without a luminous trail; focused readout says “Resting”. Chance-only gaps retain the timing cursor. |
| Hover / keyboard focus / selection | Distinct transient preview and persistent selection, visible focus ring, `aria-pressed` on row focus and enable controls. |
| Disabled controls | Fit route disabled until a mapped route is focused; explain via adjacent hint. Provider-level Live availability remains unchanged. |
| Tile/style error | Continue drawing routes over a token-coloured background; “Map background unavailable” with a Retry button. No blocking modal or interruption of music. |
| Route-data error / missing geometry | Show existing data error and retry mechanism. A lane lacking coordinates stays in the legend with “No map geometry”; it remains playable. |
| Empty song | City context, “Add a lane to begin”, and navigation to the existing lane-selection workflow; no fabricated transit activity. |
| Successful load / recovery | Replace loading/error status with usable map; no success toast. Preserve camera and selection where valid. |
| Reduced motion | Default from OS preference; map control can further reduce motion. Suppress travelling heads, trails, expanding rings and smooth camera motion. Retain static routes and gently updated selected-station indication, coalesced to at most 2 visual changes/second. |
| Hidden map / hidden browser tab | Unsubscribe ticker; cancel pending visual attacks. Audio remains controlled by existing tab behavior. |

Ensure text contrast at least 4.5:1 in both themes, focus/control boundaries 3:1, and use neutral casings for yellow/pale routes on light land. Route identity is always available by name and selected state, not colour alone. Keep Leaflet keyboard pan/zoom. Supply a focused-route station list, so Canvas hit-testing is not the only way to discover stops. No per-note `aria-live` flood.

Below 768px reuse the phone map/lane navigation and transport. Replace the crowded strip with a compact 44px-high “Lanes” disclosure, opening the existing sheet pattern; the sheet provides separate Focus and Enable actions. Keep controls clear of safe areas and the bottom transport. Put phone layout rules in `components/mobile.css`, which loads last. Use `useModal` and the existing Sheet contract if adding this sheet. At 768–1023px keep desktop map behavior with a collapsed legend by default; fix the confirmed grid collision before sign-off.

## Mapping special lane types

- **Duplicates:** resolve source geography, but keep lane identity. A soloed duplicate makes its source route visible even when the base lane is disabled. Multiple voices at the same station coalesce the ring; their names remain available in the focused-route details. Do not fabricate a second physical line.
- **Merged chords:** map constituent source routes as one selected group. Highlight the group on a chord attack, using source stop locations only when the event actually carries them. Otherwise emphasize the source routes briefly without inventing a station. Suppress consumed source-lane cursors that would imply independent sounding notes.
- **Automation:** retain the existing control-path distinction and status hue; show its source/target relationship in the legend. It never gets an instrument note ring. Decorative continuous marching dashes should stop when transport stops.
- **Imported drums:** remain non-geographical. They can appear in mix details, but do not cause fake station attacks, global flashes or invented route heads.
- **Future Live:** explicitly deferred. Snapshot markers remain snapshots; no continuous vehicle tracking is promised. A later live implementation needs event identity/location/time metadata and a data-freshness treatment.

## File-level handoff

Exact new filenames are proposed; verify local naming conventions before creation. No production files are changed by this planning task.

| Path | Planned change | Preserve / verify |
| --- | --- | --- |
| `components/MapView.jsx` | Theme-aware `BaseMap`, revised `CityView`, visual focus, composed legend, replace state-driven playhead/trail rendering. | Memoized static layers, map isolation, resize observers, attribution, mounted view state. |
| `components/MapView.css` | Route hierarchy, non-overlapping overlays, semantic states, reduced-motion styling. | Token roles and light theme. Remove obsolete glow/ripple CSS only after replacement parity. |
| `components/app.css`, `components/mobile.css` | Restore the map grid at tablet sizes; phone overlay/disclosure and tablet space handling. | Map content row, safe areas, bottom transport, 44px targets, rotation and map gestures. |
| `components/tabs/MixerTab.jsx` | Pass existing enable callbacks, lane→geography descriptors, merge/duplicate state and activity status into MapView. | Existing handlers as source of truth; no per-frame state, no audio changes on visual focus. |
| `components/map/MapPerformanceLayer.jsx` (new) | Imperative Canvas layer lifecycle, event subscriptions, bounded drawing queues. | Pointer transparency, ticker unsubscribe, stale-event cancellation, accessible HTML counterpart. |
| `lib/mapGeometry.js` (new) | Pure stop-to-shape projection and interpolation adapter. | Existing musical distance domain, coordinate ordering, negative longitude, fallback cases. |
| `lib/mapVisualState.js` (new) | Pure lane/source mapping and visual timing/gate classification. | Duplicate/merge/automation/chance/rest semantics; avoid duplicating the engine's random gate. |
| `lib/mapPlayhead.js` | Reuse current phase resolver; add only necessary returned metadata. | Existing speed, loop and wrap semantics and existing tests. |
| `lib/engine.js` | Add optional scheduled `audioTime` to existing note events. | Gate order, audio callback cost, note scheduling, MIDI events, export paths. |
| `lib/shared/playheadTicker.js`, `lib/shared/eventLogStore.js` | Reuse existing subscription APIs; no change expected. | One shared ticker; newest-first event ordering and identity-based deduplication. |
| `public/maps/leid-dark.json`, `public/maps/leid-light.json` (new) | Locally hosted tuned style definitions. | Provider licences/attribution and valid sprite/glyph/tile URLs. No credentials. |
| `test/map-playhead.test.js`, `test/map-geometry.test.js`, `test/map-visual-state.test.js` | Meaningful pure-logic regression coverage. | Shapes, time conversion, gating classification, special lanes; no tests that merely mirror CSS values. |
| `CLAUDE.md` → generated `AGENTS.md` | Update map architecture guidance only if changed implementation makes existing instructions stale. | Edit CLAUDE.md, regenerate with `npm run sync:agents`; never edit AGENTS.md directly. |

## Validation and completion gates

Validation already performed: primary-source research, CodeGraph-backed architecture inspection, rendered local desktop/phone review, theme toggle and two-lane mock playback inspection. Audio was not listened to or measured, and no proposed changes were rendered. No build/tests were run for this documentation-only task.

Implementation checks:

1. `node --test test/map-playhead.test.js test/map-geometry.test.js test/map-visual-state.test.js`: shape interpolation stays on the selected polyline; degenerate/ambiguous shapes fall back safely; tick phase survives tempo changes; trail wrap stays inside the loop; old events expire; duplicate solo resolves geography; merged/drum events do not invent stops.
2. `npm test`: existing pure-logic suite passes. If guidance changes, run `npm run sync:agents` then `npm run sync:agents -- --check`.
3. Stop the development server, then `npm run build`: production compile succeeds. Never build concurrently with Next dev because they share `.next`.
4. Restart dev for manual review: Budapest, Helsinki, Berlin, Prague, New York, Zürich and Warsaw; both themes; 320, 390, 414, 768, 820, 1024, 1440 and 1920px widths. Check stopped/all-off, 1/12/24 mapped lanes, dense city routes, long labels, missing geometry, style failure, composer expanded/collapsed, city switch, pan/zoom, tab return and phone rotation.
5. With actual audio output, compare visible station attacks to sound at 60/120/180 BPM, varied lane speeds, partial loops, note chance, rests, solo, duplicates, merged chords and automation. Proposed target: attack drawing within one display frame of its scheduled audio timestamp under normal foreground load; report hardware/output latency separately. A build alone cannot verify this.
6. Profile a production build with NYC/Berlin and 24 mapped lanes. Proposed targets: at least 55fps on the agreed desktop at 60Hz; at least 30fps on an agreed midrange phone; dynamic overlay drawing p95 ≤4ms desktop / ≤8ms phone; zero frame-driven React commits; zero ticker subscriptions when hidden. Record hardware, browser, lane count and baseline before claiming these targets passed. Reduce visual samples before changing audio work if over budget.
7. Manual keyboard and screen-reader pass: all map actions and station information reachable without pointer hit-testing, meaningful accessible names, focus restored after sheet/expanded view, Escape respects modal ownership. Verify reduced motion, browser zoom and contrast in both themes.

Release stages independently. Keep the new dynamic renderer behind a temporary implementation flag until geometry and timing parity pass; remove the old renderer after validation to avoid maintaining two active paths. Roll back visual changes if audio stability regresses.

Stop and reassess scope if solving shapes requires regenerating GTFS or changing musical timing, if the proposed layer cannot stay synchronized during Leaflet zoom, if style assets cannot be redistributed under their licences, or if acceptable performance requires a full map-stack migration. Report the measured issue before expanding the work.

## Recommendation

Start with stage 1, then implement stages 2 and 3 as the core upgrade. The most valuable change is a map with clear composition and trustworthy musical feedback. Treat the expanded listening view as an enhancement after that foundation is proven.
