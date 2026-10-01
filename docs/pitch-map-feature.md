# Pitch mapping stages 1 and 2

Feature branch: `feature/pitch-map-consistency`.

## Try it

Open a lane's Pitch map controls on desktop or the phone Sound sheet. Choose
**Geometry**, **2 octaves**, and a **2-step leap** as a starting point. Compare
against Demand and Geo while keeping the instrument, key, BPM, and rhythm fixed.

Geometry projects the static stop coordinates into local meters, then follows the
route's principal geographic axis. Pitch uses 80% geometry and 20% normalized
demand. Missing demand uses geometry alone; missing coordinates use a neutral
geometric value. Variation stays repeatable for the same lane and stops.

Range limits the generated note map to 1/2/3 scale octaves starting at the lane's
root in octave 3. Auto restores each contour's original register, including the
older Geographic/Walk/Arch behavior with high variation. Octave and chromatic
transpose move the resulting map afterward.

Maximum leap is measured in **scale steps**, not semitones. Off preserves the
original contour. Limits apply to generated notes surviving grid snapping inside
the selected loop, including its final-to-first edge. The cyclic limiter uses the
midpoint of upper/lower movement envelopes, avoiding a one-way clamp that pushes
the whole melody toward lower notes. Trimming a constrained loop can reshape
its notes. Your authored stop edits take priority; chance gating can skip notes.

## Consistency fixes

- Every played lane's selected scale is included at Start, AI auto-start, and Song
  playback, even when its legacy sound-mode map is empty.
- Engine stop notes, desktop/phone displays, and loop MIDI share a pure resolver.
- Root/scale, degree edits, octave, and semitone shifts follow one order.
- Engine octave/transpose/stop edits remain dynamic at note-trigger time.
- Merged lane MIDI includes all source voices in the merged lane's key; merged
  playback also reads octave/transpose changes at callback time.
- The dormant known-stop Live callback uses the same note map. Live transport
  remains disabled; this feature does not reconnect feeds.
- New pitch settings survive song JSON and composer/MCP schema, validation, and
  description round trips. No database or song schema migration is required.

Existing contour output is unchanged when the new controls are absent. Old-song
Geographic migration and fresh-song Demand defaults remain intact.

## Verification

`node --test test/lane-pitch.test.js` covers legacy note fixtures, selected-scale
startup maps, every scale/contour/range/leap combination across several grids and
trimmed loops, missing/coincident coordinates, authored edits, display/MIDI
parity, merged chord voices, and song/composer round trips.

Verification completed on 2026-10-01:

- All nine new pitch tests passed. The full suite passed 319 of 320 tests; the
  unchanged Clouds worklet test, "stale triggers after a stall are dropped,
  slightly late ones still fire", also failed when run alone. Its expected late
  trigger was dropped. Neither its test nor its worklet was changed here.
- `npm run build` passed.
- In the production browser, M1 was set to D minor while stopped, then played
  with Geometry, two octaves, and a two-step leap. Every event-log stop pitch
  matched its displayed note across repeated loops. The synth EQ spectrum also
  showed audio activity. This verifies triggering and pitch agreement; it is
  not a listening assessment of musical preference.
- Desktop light/dark and 820px layouts were inspected. At 390px, the phone sheet
  retained the desktop settings, and changing range/leap updated their selected
  states. New phone choices measured 44px high, with no horizontal page overflow.
  The browser reported no uncaught errors.

### Real-data comparison

Budapest slim route data, C major rooted at C3, variety zero, default grid,
full loop. Geometry uses two octaves and a two-step leap. Counts include the
final-to-first loop edge; maximum jumps below are **semitones**.

| Route | Events | Demand unique / max jump | Geographic unique / max jump | Geometry unique / max jump |
| --- | ---: | ---: | ---: | ---: |
| M1 metro | 11 | 2 / 6 | 8 / 35 | 6 / 3 |
| M2 metro | 11 | 3 / 6 | 9 / 26 | 6 / 4 |
| Tram 4 | 19 | 5 / 9 | 9 / 14 | 10 / 4 |
| Bus 197, returning to its first stop | 12 | 5 / 16 | 10 / 14 | 7 / 4 |

Geometry distinguishes tied demand scores while limiting large loop jumps in
these examples. This does not establish that it sounds better: audition with a
fixed instrument and rhythm. Auto/Off retain the original alternatives.

The comparison routes suggested by the research are Budapest M1, M2, Tram 4,
and a route with repeated/circular stops. See `docs/pitch-map-research.md` for
the baseline observations and research sources.
