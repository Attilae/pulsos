---
name: leid-composer
description: Compose and edit loops in Leið, the web DAW that turns a city's public transport lines into music, through the Leið MCP connector. Use when the user asks to make, compose, sketch or remix a loop, song, beat, groove or soundscape with Leið, transit lines, trams, metro or buses of a city (Budapest, Helsinki, Berlin, Prague, New York, Zürich, Warsaw), or to change a saved Leið song's sound, arrangement or tempo.
---

# Composing with Leið

Leið turns public transport into music. Each transit line is a track, and each stop along the line
becomes one note on a 4-bar, 64-cell loop. You write a **plan** (a JSON object: tempo, key, tracks,
drums, FX). The Leið MCP server validates the plan and saves it as a song, which the user opens in
the Leið DAW and plays.

## Before you start

- You need the Leið MCP tools (`get_composer_guide`, `list_routes`, `preview_song_plan`, …). If they
  are missing, tell the user to open Leið → ⋯ menu → **Connect an AI client**, add that MCP URL as a
  connector in their AI client and sign in. Leið Pro is required. A "Leið Pro is required" error means
  the account is not Pro. Retrying will not help.
- **The vocabulary is not in this skill.** Instrument names, sampler presets, drum pads, FX buses and
  their params, scales, speeds and every numeric range come from `get_composer_guide`. Call it once per
  city in each conversation and follow it exactly. It also tells you `maxTracks`, the user's lane
  limit. The recipes in this skill show *how to choose*, and the guide says *what is allowed*.

## New song

1. **City.** If the user named none, ask or call `list_cities`. Use the city `id` (e.g. `budapest`),
   not its display name.
2. **Guide.** `get_composer_guide({ cityId })`. Read the note-density, register, contour and level
   sections. They decide whether the result sounds good.
3. **Pick lines by role.** Call `list_routes({ cityId, type })` once per role you need. The usual
   mapping is metro → melodic lead/keys/bass, tram/trolley → rhythmic percussion, bus → pads/textures,
   hev → low, slow melodic voices. Choose by `stopCount`: few stops make a sparse part and many stops
   make a busy one. See the density formula in the guide. `meanDemand` shows how busy the stops are,
   which drives the default `demand` pitch contour. Only use `id` values the tool returned. Never
   invent or guess ids.
4. **Write the plan.** Use only the tracks the loop needs, listed in musical priority order and no
   more than `maxTracks`. Use at most three FX buses. Leave out settings you don't want to change
   instead of guessing.
5. **Preview.** `preview_song_plan({ cityId, plan })`. Read `dropped` (settings that were invalid and
   ignored) and `skippedRouteIds`. Fix every item that matters and preview again. Values outside a
   range are clamped silently, so check the numbers against the guide. `references/troubleshooting.md`
   explains each message.
6. **Save.** `create_song_from_plan({ cityId, name, plan })` with a short, evocative name.
7. **Hand it over.** Reply with one or two sentences about the loop (tempo, key, which line plays
   what) and the `openUrl`. Tell the user to open it and press **Play**. Mention anything that was
   dropped and not fixed.

## Editing a saved song

1. Find it with `list_songs`, then call `get_song({ id })`. Keep its `updatedAt`.
2. For a tempo-only change, use `set_song_tempo({ id, bpm, expectedUpdatedAt })`.
3. For anything else, write a plan and preview it against the song with
   `preview_song_plan({ songId, plan })`.
   **The plan's `tracks` list is the entire audible arrangement.** Any lane you leave out gets
   disabled (its settings are kept). To keep a lane playing, include it with its `routeId`. A track
   entry only changes the settings you put in it.
4. Save with `apply_plan_to_song({ id, expectedUpdatedAt, plan })`. If it fails with "changed since
   it was read", the user edited the song in the browser meanwhile. Fetch the song again, redo the
   change on the new version, and never blindly retry the old plan.
5. Give back the `openUrl`. If the song is already open in a tab, the user must reopen or reload it
   to hear the change.

## What the tools cannot do (don't claim otherwise)

- They change **saved songs only**. They cannot play audio, control a DAW tab that is already open,
  or export audio or MIDI.
- A lane plays **one note per stop**, never a chord. Harmony comes from stacking lanes or from an arp.
- The plan cannot set per-stop pitch, velocity or chance, the 8-band EQ, automation lanes,
  duplicate or chord lanes, or solo. Those are manual edits in the DAW. Suggest them to the user
  instead.
- A song belongs to one city. Moving a song to another city means creating a new song.

## Musical craft

- Start from a small arrangement. A foundation (bass or drone), one lead and one colour layer
  (pad, perc or arp) beat six lanes playing at full density.
- Most failures come from density. An ambient piece needs slow speeds (0.25–0.5), a coarse grid and
  low-stop lines. A groove needs one dense rhythmic lane with the others kept sparse.
- Use `loopRegion`, mixed `speed` values and `loopPattern` so parts enter, answer and drift against
  each other. Use `noteChance` for human-feeling percussion.
- Get space from reverb or delay sends rather than loud pads. Duck pads and bass off the kick with
  `sidechain` when there are drums.

For genre starting points with full example plans, read `references/recipes.md`. For the meaning of
preview warnings and error messages, read `references/troubleshooting.md`.
