# Leið social launch runbook

## Campaign

The four-week launch drives music-tech creators to try Leið on desktop.
Positioning:

> Turn a city into a song. Every transit line becomes a track. Every stop
> becomes a note.

Publish Tuesday, Thursday, and Saturday, initially at 16:00 UTC. Upload the
clean vertical master natively to Instagram, TikTok, and YouTube; upload the
4:5 derivative to X. Do not add one platform's watermark to another platform's
file.

All current cities use mock playback, so public copy must say “public
transport data” or “city network,” not “live transit.”

## Four-week calendar

| Week | Post | Feature | Primary interaction |
|---|---:|---|---|
| 1 | 01 | Product reveal | Try Leið on desktop |
| 1 | 02 | Budapest sound | Comment the next city |
| 1 | 03 | Stop-to-note mapping | Save and play a route |
| 2 | 04 | AI Composer | Suggest the next prompt |
| 2 | 05 | Pitch and velocity editor | Discuss how to retune it |
| 2 | 06 | Chord voicing | Build a city chord |
| 3 | 07 | Route-derived drums | Suggest a route |
| 3 | 08 | Polyrhythm | Headphone listening |
| 3 | 09 | MIDI/WAV export | Producer desktop trial |
| 4 | 10 | Budapest vs Berlin | Vote |
| 4 | 11 | Geographic mapping | Follow the build |
| 4 | 12 | Seven-city montage | Nominate city eight |

The exact scripts and native captions live in
`_videos/launch/content/posts.json`.

## Publish checklist

For each post:

1. Replace draft TTS with founder narration if available.
2. Replace the draft music bed with a real Leið WAV export.
3. Preview the 9:16 and X compositions in Remotion Studio.
4. Inspect the hook, proof, final CTA, and platform safe areas.
5. Render both formats and confirm H.264 video, AAC audio, dimensions, and
   duration with `ffprobe`.
6. Add the platform-specific UTM:
   `?utm_source={platform}&utm_medium=organic_social&utm_campaign=launch&utm_content={post-id}`.
7. Upload natively with the copy stored for that platform.
8. Reply to early questions about pronunciation, cities, desktop access,
   pricing, and data sources.

Use a short, clean cover line such as `WHAT DOES BERLIN SOUND LIKE?`; do not
repeat the entire caption on the cover.

## Product capture selectors

The capture script uses:

- `.view-toggle button:first-child` — Map
- `.view-toggle button:nth-child(2)` — DAW
- `.line-track .disable-btn` — enable a lane
- `.transport-btn` — start/stop playback
- `.city-select-input` — city selection
- `.stop-dot.stop-dot--editable` — open the stop editor
- `.dup-btn` — duplicate a lane
- `.tab-btn` — Map or Drum Machine tab
- `.drum-step` — drum velocity step

AI Composer capture additionally uses `.ai-composer-input`,
`.ai-composer-generate`, and `.ai-composer-apply`, but generation requires a
signed-in session.

## Measurement

The application now records privacy-preserving product events:

- `desktop_app_viewed`
- `mobile_gate_viewed`
- `mobile_bypass_used`
- `city_selected`
- `playback_started`
- `ai_plan_generated`
- `ai_plan_applied`
- `drum_pattern_sent`

Use `playback_started` as the activation event. Compare activated desktop
sessions per 1,000 views, then evaluate completion, saves, shares, comments,
profile visits, and account creation.

After post 06, retain the two strongest hook structures and reuse them with
new cities. If reach is strong but playback activation is weak, make the
desktop CTA more explicit. If retention drops during the UI demonstration,
crop closer and show one control change rather than the whole interface.
