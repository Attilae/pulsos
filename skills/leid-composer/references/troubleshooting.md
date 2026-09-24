# Troubleshooting Leið plans

## `dropped` messages from `preview_song_plan`

A dropped item was ignored. The rest of the plan still applies. Fix the item and preview again.

| Message | Cause | Fix |
| --- | --- | --- |
| `track for unknown route "…"` | The id isn't one of this city's routes. It was guessed, is from another city, or is a line *name* instead of an id. | Take the `id` from `list_routes` for the same `cityId`. |
| `duplicate track "…"` | The same route appears twice. | One entry per route. To get a harmony, use another line or an arp. |
| `track "…" exceeds the active-lane limit` | There are more tracks than `maxTracks` from the guide. | Drop the least important tracks. The order of the list sets priority. |
| `synthType "…"`, `samplerPreset "…"`, `drumVoice "…"` | The name isn't in the guide's vocabulary. `samplerPreset` only works with `Sampler` and `drumVoice` only with `Drums`. | Copy the exact spelling from the guide. |
| `speed on …`, `gridResolution on …` | The value isn't one of the listed options. These are enums, not ranges. | Pick a listed value. |
| `loopRegion on …` | `endCell` ≤ `startCell`, or a number is missing. | Use cells 0–64 with end > start, preferably on bar edges (0/16/32/48/64). |
| `pitchVariety on …` | Unknown contour, or `variety` is missing. | Send both `contour` and `variety`. |
| `scale on …` / `harmony (invalid root/scaleType)` | Bad note or scale name (e.g. `"Bb"` or `"aeolian"`). | Use the guide's roots (sharps only) and scale types. `minor` covers aeolian. |
| `drone root "…"` | The root needs a note plus octave, e.g. `"G1"`. | Give the song's root or fifth with an octave. |
| `label "…"` | Not one of the lane role names. | Use a listed label. |
| `sidechain source "…"` | The source is the lane itself, a lane that isn't in the plan, or a drum source while drums are off. | Use `"drums"`/`"drums:kick"` together with an enabled drum pattern, or another planned track's routeId. |
| `drum pattern … must have 16 numeric steps` | The pattern isn't exactly 16 steps, or it uses other values. | Use 16 steps, each one of the listed velocity levels. |
| `fx for unknown bus "…"`, `… param "…"`, `busId.param = "…"` | Wrong bus id, param id or enum value. | Copy the ids from the guide's FX list. Params go as `[{ "paramId", "value" }]`. |
| `fx bus "…" exceeds the three-bus limit` | More than three FX buses. | Keep the three that matter most. |
| `send from inactive route "…"` | A send comes from a route that isn't in `tracks`. | Add the track, or remove the send. For drums, use `"drums"` and enable them. |

Out-of-range numbers are **clamped without a message**. A volume of -60 becomes the minimum, not an
error. Check numbers against the guide's RANGES.

## Errors

- **"The plan has no playable tracks after validation"**: every track was dropped. This is almost
  always invented or cross-city route ids. Call `list_routes` again.
- **"Leið Pro is required"**: the account isn't Pro, or it was downgraded. Retrying won't help. Tell
  the user.
- **"Song changed since it was read; fetch it again"**: the song was saved elsewhere (usually the
  open browser tab). Call `get_song` again and rebuild the change on the new state.
- **"This song predates city tracking"**: an old save. The user has to open it in Leið once, which
  upgrades it. After that, try again.
- **"This song belongs to "X", not "Y""**: a song can't change city. Create a new song in the other
  city instead.
- **"Unknown city"**: use an `id` from `list_cities`, not a display name.

## When the song sounds wrong

- **Too busy or chaotic:** notes per beat is too high. Lower `speed`, coarsen `gridResolution`,
  choose lines with fewer stops, shorten the `loopRegion`, add `noteChance` or `loopPattern`, or cut
  a lane. Recompute with the NOTE DENSITY formula in the guide.
- **Too sparse or static:** do the reverse. Also give lanes different speeds and loop windows so they
  drift.
- **Melody jumps around:** switch from `demand` or `geographic` to `randomWalk`, and keep variety ≤ 0.3.
- **Muddy low end:** only one lane should sit at octave -1/-2. Lowpass or duck the others.
- **Shrill:** too many dense lanes at octave +1/+2. Move them down or make them sparser.
- **Pads never swell:** the attack is longer than one beat. Shorten it and move the length into
  release and reverb.
