# Stop-driven note length

Status: implemented (v1: Demand on PolySynth lanes, including duplicate and
merged lanes). The plan below is kept as written; the notes in this section
record where the implementation settled a choice the plan left open.

- **Module**: `lib/stopNoteLength.js`. Stored as `trackStopNoteLengths`; plans
  use `stopNoteLength` with `source: 'demand' | 'fixed'` (`fixed` switches back
  and leaves `noteLength` alone).
- **Repeated pitches**: verified against Tone 15.1.22's `PolySynth`: a release
  takes the oldest unreleased voice of its pitch, so a gate that outlives a newer
  same-pitch onset would release the newer voice. Each mapped gate is therefore
  ended no later than the next scheduled onset of the same resolved pitch
  (wrapping the loop, counting chance-skippable onsets). Under that bound release
  order equals attack order per pitch, so every release finds its own voice; no
  voice-specific cancellation was needed. Chord gates are per note.
- **Voice ceiling**: Tone's default 32 is now passed explicitly. When exceeded,
  Tone drops the new note with a console warning; with the bound above, the
  dropped note's release finds no other same-pitch voice to cut.
- **Live mode**: live arrivals carry no stop, so they keep the fixed gate.
- **Merged lanes**: created by the existing merge flow with PolySynth defaults,
  so they start Fixed, like every new lane.
- **Preview**: the desktop stop rail draws each in-loop stop's hold as a faint
  bar (already cut by same-pitch protection; grey for the fixed fallback); the
  stop editor shows the requested hold, demand, and any cut. The phone Notes list
  shows the hold per stop. Merged lanes show the max-demand rule as text only.
- **WAV export**: unchanged. It captures one pass of the real engine, so release
  tails and holds past the capture window are cut at its end.
- **Not verified by tests**: how it sounds, and dense merged lanes over minutes
  of play. Those need listening in `npm run dev`.

## Product outcome and v1 scope

Let a PolySynth lane turn stop demand into note hold time. A quieter stop holds a
shorter note; a busy interchange sustains longer. Different pitches can overlap,
so a pad's harmony and density evolve while its envelope opens and releases.

Ship one deliberate mapping first: **Demand**, including duplicate and merged
PolySynth lanes. Keep the feature off in every existing and newly created lane
until explicitly selected. Other instruments retain their current fixed-length
behavior; switching away from PolySynth preserves the mapping but makes it
inactive. Sampler support can follow after its release and voice behavior is
auditioned. Do not describe this as actual passenger counts or live occupancy.

Proposed v1 controls:

| Control | Default when Demand is selected | Meaning |
| --- | --- | --- |
| Length source | Fixed until explicitly changed | Fixed uses the existing note-length control; Demand enables the mapping |
| Shortest | `4n` / 1/4 | Lower musical bound |
| Longest | `1n` / 1 bar | Upper musical bound |
| Invert | Off | Higher demand normally means a longer hold |

Use the existing `NOTE_LENGTHS` vocabulary in `lib/noteLength.js`: `16n`, `8n`,
`8n.`, `4n`, `4n.`, `2n`, `1n`. V1 introduces neither multi-bar lengths nor a
second duration vocabulary. Quantize the mapped result to the nearest allowed
length between the selected bounds, with ties resolved toward the shorter
length. Equal bounds produce a constant length. Normalize reversed bounds into
ascending order and show that normalized order in the UI.

## Existing behavior to preserve

- `lib/engine.js` stores sparse `_noteLengths`; `setNoteLength` reads a validated
  division. `_buildRoutePart` reads the duration at callback time and calls
  `_triggerSynth`. Ordinary notes default to a quarter note in harmonic mock
  playback. `_buildMergedRoutePart` supplies one duration for the whole chord.
- Arpeggiator steps use their own gate; legato bypasses ordinary stop-note
  length. Drone playback also bypasses this path. Pluck ignores note duration.
- Hold time ends the sustained part of the amplitude envelope. ADSR release
  happens afterwards; gate length is not the total audible duration.
- The ordinary playback path does not clip a note at the next onset or loop end.
  That permits pads to overlap but does not provide an explicit policy for
  repeated same-pitch gates.
- `lib/midiEvents.js` already uses fixed note lengths. `fitToLoop` clips exports
  to one loop and prevents same-pitch overlap. These are existing export rules.
- `lib/songState.js` persists `trackNoteLengths` sparsely. Its `buildSnapshot`,
  `applySnapshot`, and `_applyToEngine` restore the UI and engine. Song Chainer's
  `playSnapshotOnEngine` in `lib/snapshotPlayer.js` reuses `applySnapshot`.
- `lib/lanePitch.js`'s `buildMergedPitchCells` currently returns chord notes and
  a display name, without the contributing stops. Demand cannot be recovered
  reliably from that name.

## Phase 1: pure mapping and a validated configuration

Add a small pure module, proposed as `lib/stopNoteLength.js`. The names below
describe new responsibilities, not existing APIs:

1. Normalize a per-lane mapping configuration and a sparse route-to-config map.
2. Read a valid normalized demand value from a stop.
3. Resolve demand plus musical bounds into a division and beats, or return the
   lane's fixed/legacy fallback with a reason suitable for the UI.
4. Resolve the aggregate input for a merged chord.

Proposed stored shape: `trackStopNoteLengths[routeId] = { source: 'demand',
min: '4n', max: '1n', invert: false }`. Absence means Fixed. Keep
`trackNoteLengths` intact as the fixed setting and missing-data fallback; selecting
Demand must not overwrite it. Returning to Fixed removes the mapping entry.

Treat saves, share links and AI inputs as untrusted. Accept known source and
duration strings only; normalize bounds, require a boolean inversion, and drop
malformed configurations. Use the same normalizer at every input boundary.

Demand is already a city-normalized 0–1 signal in `stop.signals.demand`; use it
directly. Do not normalize again over a lane or its currently trimmed loop:
changing the loop window should not change the duration assigned to a stop.
Accept finite numeric values, clamp finite out-of-range values to 0–1, and
preserve zero as meaningful data. Missing values, strings, NaN and infinity use
the fixed/legacy gate. A stop without demand must not silently become a quiet
stop. No additional GTFS preprocessing or network request is required.

Mapping is deterministic: invert the valid value if selected, interpolate in
beats between the bounds, then quantize to the permitted divisions. Resolve
tempo through the existing division/beat conversions. Keep the existing behavior
that lane speed changes onset spacing but does not scale note hold time.

For merged chords, preserve contributing source route/stop identity and demand
alongside the deduplicated pitches in `buildMergedPitchCells`. Use the **maximum
valid demand among contributing stops** as the chord's input, giving a hub the
longest influence on the shared chord gate. Ignore missing contributors; use
the fixed fallback if all are missing. Resolve once per chord, retaining the
existing one chance roll and one sidechain event per chord. Do not choose the
first stop or infer demand from the merged route's synthetic stops.

## Phase 2: playback, overlap, and resource bounds

Extend `TransitEngine` with a validated mapping map and setter, following
`setNoteLength`'s callback-time pattern. Integrate the shared resolver into
`_buildRoutePart` and `_buildMergedRoutePart` immediately before ordinary
`_triggerSynth` calls. Keep source data in scheduled events, rather than baking
resolved durations into a Part, so changing bounds/inversion affects subsequent
notes without restarting the lane.

Proposed precedence is explicit: drone path, then arp gate, then legato behavior,
then Demand for an eligible PolySynth, then the existing fixed/legacy gate.
Keep a selected mapping visible but inactive when arp, legato or an incompatible
instrument wins. Do not alter those modes or their gates as a side effect.

Allow different-pitch gates and release tails to overlap, including across the
loop boundary. Do not clip every note to the next stop; that defeats the pad
effect. Gate length does not alter attack, decay, sustain or release settings.

Before shipping, establish a repeated-pitch scheduling policy against the actual
installed Tone PolySynth implementation. Proposed v1 policy: end a mapped gate
no later than the next scheduled occurrence of the same resolved pitch, including
the loop wrap, while allowing its release tail to decay. The scheduling lookup
must use the current pitch offsets, transposition, merged pitches, grid, speed
and loop region. It may conservatively count a potential onset even when chance
later skips it; document and test this deterministic rule. Compute the bound in
the event path or invalidate its cache whenever these inputs change. Quantized
musical lengths are requested gates; this same-pitch bound can shorten them.

Validate that queued releases cannot release a newly triggered same-pitch voice,
especially after live pitch edits or repeated notes across the loop boundary.
If Tone's public scheduling behavior cannot satisfy that invariant, implement
voice-specific cancellation/retrigger handling before release. Do not mark the
feature complete on a duration-calculation unit test alone.

Audit PolySynth construction and the installed Tone voice limit before changing
it. Retain an explicit finite voice ceiling and handle exhaustion without an
uncaught error or a stuck gate. Release tails count toward load. Exercise dense
merged chords at the one-bar maximum and long release settings. Do not increase
the voice limit merely to mask accumulation. Stop, hidden-tab pause, rest loops,
lane removal, instrument replacement and engine disposal must release/cancel
mapped notes using the same lifecycle guarantees as existing playback.

## Phase 3: complete state lifecycle

Thread the sparse mapping map through the existing fixed-note-length lifecycle.
Use `trackNoteLengths` as the checklist in each module, rather than implementing
only the interactive setter.

| Surface | Required work |
| --- | --- |
| `components/tabs/MixerTab.jsx` | Own React state, handle updates, push configuration on play/engine initialization, and provide it to UI/export/snapshot contexts |
| Duplicate lane | Clone the mapping with sound settings; keep source stop data, including when pitch is transposed |
| Change lane / route remap | Move the configuration with the lane's sound, then derive durations from the replacement route's stops; remove the old engine key |
| Remove lane | Delete UI and engine entries; dispose any duration scheduling metadata |
| Merge/unmerge | Preserve source configurations for restored lanes; initialize a new merged lane from the sound settings chosen by the existing merge flow, including its mapping, and use chord demand aggregation |
| New song / session reset / city switch | Clear the map wherever fixed note lengths are cleared; do not let city-scoped route IDs inherit another city's configuration |
| `lib/songState.js` | Normalize/store in `buildSnapshot`; normalize/restore in `applySnapshot`; include mapping route IDs and explicitly clear absent settings in `_applyToEngine` |
| Older/shared/imported songs | Missing map means off; malformed entries are sanitized; loading an old song after a mapped song clears the previous mapping |
| `lib/snapshotPlayer.js`, `lib/songChainPlayer.js` | Confirm `applySnapshot` replays the map on every section and both engines; preserve existing fade/cleanup behavior |
| `lib/useSongPersistence.js` and persistence callers | Include the map in current snapshot inputs and dependencies so edits autosave and Save As/share round-trip it |

This is an optional additive field, so no schema-version bump is proposed.
The configuration lives in the existing song JSON state; no database schema
change or Drizzle migration is needed.
Do not create a migration that enables Demand for old saves. Audit route-ID
recovery and lane normalization utilities for any enumerated per-track maps;
include the new map where needed without making a stale setting create a new
lane. Derived demand caches never belong in song state.

## Phase 4: desktop and mobile controls and preview

Add the controls beside existing note length in `components/DawView.jsx` and
`components/mobile/LaneSheet.jsx`. Follow `DESIGN.md`, existing tokens, icons and
modal conventions. Reuse one control/resolver vocabulary across both surfaces.

Show Fixed/Demand, Shortest/Longest and Invert. Keep the fixed gate editable as
the fallback. Explain briefly: “Busier stops sustain longer.” Use “Demand is
estimated from scheduled service” in contextual help, with no claim of live
passenger counts. Inactive states must say why, such as “Arpeggiator controls
note length” or “Available for PolySynth.”

Expose a selected stop's requested hold as a musical label and its demand value,
with “Fixed fallback: demand unavailable” when appropriate. For merged chords,
show the chord's maximum-demand rule. If same-pitch protection shortens a gate,
distinguish the requested hold from the effective hold. Do not label release
tails as held notes.

Provide a lightweight stop-duration preview in the note/stop editing surface,
such as short bars or labels for scheduled stops. Establish the exact rendering
after inspecting the current rail; avoid a full piano-roll redesign. Precompute
preview data on configuration changes. Per-frame highlights must use the
existing ticker/DOM approach, never React state updates in rAF.

## Phase 5: exports, AI, and documentation

### MIDI and WAV

Update `lib/midiEvents.js`'s `buildLoopMidiEvents` to resolve per-stop/per-chord
gates with the same pure mapping module, before `applyDurations`/`fitToLoop`.
Include configuration in the export context assembled by MixerTab and its MIDI
writer callers. Preserve arp/legato precedence and exclusion of inactive lanes.

Keep the existing MIDI policy: export exactly one self-contained loop, clip at
loop end, and prevent same-pitch overlaps. Therefore an audible release tail or
a held note continuing across a playback loop boundary is not represented past
the exported clip boundary. Export help should state this plainly. Never change
MIDI to emit overlapping same-pitch note-on/off pairs to imitate audio tails.

WAV remains a recording of the real engine, so it inherits the actual variable
holds and release tails. Audit `lib/audioExport.js` capture length and stop
timing: preserve the current one-pass contract and explain any tail truncation;
do not silently extend the mix/stem export duration or promise a full decay.
Any later “include tail” option is a separate feature.

### AI and MCP

Make the configuration authorable and readable through the existing plan model,
with an optional lane-level object corresponding to the stored mapping. Final
field naming must follow `lib/ai/planContract.js` conventions. Extend
`lib/ai/planSchema.js`/`PLAN_INPUT_SCHEMA`, `validatePlan`, the interactive path
in `lib/ai/planApply.js`, and `applyPlanToSnapshot` in `lib/ai/planSnapshot.js`.
Both paths must yield equivalent song state, including a defined explicit way
to switch back to Fixed without erasing the fixed duration.

Update `lib/ai/planAdvisories.js` for incompatible instruments and overriding
arp/legato; avoid claiming that a gate shorter than attack necessarily reaches
its sustain level. Update composer prompt/guide material and the composer skill
examples under `skills/leid-composer/`. Inspect MCP tool schemas/summaries in
`lib/server/mcpTools.js` and composition-state readouts so the same vocabulary is
accepted and reported there. Preserve server purity: no Tone or React imports
from the shared resolver. Rebuild the distributable skill ZIP with the existing
script when the packaged skill changes.

Document the feature, data meaning, overlap policy and export limits. Update
`CLAUDE.md` for durable architecture changes and regenerate `AGENTS.md` through
`npm run sync:agents`; never edit generated `AGENTS.md` directly.

## Phase 6: validation and release acceptance

Add meaningful pure tests for normalization, zero/endpoints, inversion,
quantization/ties, equal/reversed bounds, missing/nonfinite input, all-missing
and partially missing merged demand, and fixed fallback. Pin deterministic
results independent of loop trimming and route ordering. Test ordinary and
merged MIDI durations, tempo scaling, speed-independent requested holds, loop
clipping, repeated pitches and arp/legato precedence.

Extend relevant existing suites: `test/note-length.test.js`,
`test/midi-export.test.js`, `test/song-snapshot.test.js`,
`test/song-migrate.test.js`, `test/song-lanes.test.js`, and plan/apply/snapshot,
composer-skill and server-purity coverage. Locate the actual test files before
editing; the list identifies the existing coverage areas and intended additions.
Test old-song-after-new-song clearing, duplicate/remap/reset behavior and Song
Chainer restoration. Use a focused scheduling harness where needed for repeated
pitch release ownership rather than claiming pure resolver tests cover audio.

Run focused tests, then `npm test`. Stop the dev server before `npm run build`
because dev and build share `.next`. A build is required for engine/UI edits,
but cannot verify sound. Restart development playback for desktop and phone UI
checks and audible verification.

Acceptance requires all of the following:

- Off reproduces existing fixed-note behavior, including old saved songs.
- Demand yields the documented lengths for known low/high stops and inversion
  reverses them; changing bounds while running affects subsequent notes without
  moving the playhead or restarting the lane.
- A slow-envelope PolySynth pad audibly overlaps different pitches and produces
  changing density; loop wrap and repeated same pitches do not cut a new gate
  unexpectedly or leave stuck notes.
- Dense duplicate/merged lanes remain bounded through several minutes of play,
  long releases, tempo/speed edits, chance/rest patterns and instrument switches.
- New song, city switch, save/reload, share import, duplicate/remap/remove and
  Song Chainer section transitions restore or clear the mapping correctly.
- Desktop and mobile controls, inactive reasons and duration previews agree with
  the resolver; exported MIDI agrees within its stated one-loop boundaries and
  WAV contains the actual playback for its stated capture window.
- AI and MCP apply/readback round-trip the same validated configuration.

## Deferred deliberately

Connectivity/centrality and normalized next-stop distance can become additional
sources using the same resolver contract. Gap normalization must use stable
route-wide values and defined units, not cross-city raw distances or the current
loop window. Actual dwell/travel time needs additional preprocessed GTFS fields
and should not be simulated from demand. Also defer continuous duration mode,
multi-bar bounds, arbitrary user curves, per-stop authored length overrides,
Sampler/other-instrument support and a WAV tail option until the core mapping
and scheduling behavior are validated.
