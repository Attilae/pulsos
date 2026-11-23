# Streets and Score: same track, two ways to see it

Prepared November 15, 2026. Next feature-post priority at the founder's request; no publication date assigned. Draft script / recording brief only. Founder-story preview remains available separately.

## Audience, goal and creative direction

For musicians and curious listeners who want to see the relationship between transport geometry and music. Goal: try the Map view in Leið. Self-serve browser product, small existing audience, organic distribution on DeettaLabs Shorts/Reels/TikTok/X. Show one audible arrangement in both modes so the visual change carries the story. New information relative to earlier demos: the same arrangement can be experienced as Streets or a pitch-height Score view. Creative judgment, not a measured retention claim.

Hook: “Same track. Two ways to see it.” Title/cover: “Streets & Score”. Approximately 35–40 seconds, including four seconds with no narration; actual timing follows the delivered voice.

## Narration

Same track. Two ways to see it.

Streets shows the routes through the city.

Switch to Score, and the music takes shape in three dimensions.

Higher notes sit higher. The stops light up as the notes play.

You can also try it as a mindful-listening practice.

Follow one route. Notice each note. When your attention wanders, gently bring it back.

[Pause for four seconds of music. Do not read this cue.]

Try it at layth dot space.

Pronounce Leið “layth”. Display Leið and layth.space in captions. The bracketed cue is silent. No voice generation or tier claim required at this stage.

## Picture / sound plan

| Beat | Picture / on-screen text |
|---|---|
| Hook | Streets already playing; STREETS & SCORE |
| Streets explanation | Route overview, then gentle route focus if useful |
| Switch to Score | Real mode switch while same music continues; SCORE |
| Pitch and note explanation | One slow rotation reveals heights; HEIGHT = PITCH; actual note blooms |
| Mindful-listening invitation | Settle into a steady Score view, minimal camera motion |
| Practice prompts | Follow one route. → Notice each note. → Gently return. Each prompt appears with its narration |
| Four seconds music only | Uninterrupted Score hold, no controls or extra copy |
| CTA | Continue Score; large readable layth.space |

Timings are an edit guide, not recording performance deadlines.

## Founder screen-recording checklist

- Record a clean 45–60 second desktop take at the highest native resolution available. Avoid scaling or baking captions into the file. Keep playback continuous, same preset, tempo, levels and instruments throughout.
- Use a good-sounding preset with 2–4 distinct routes and different pitch ranges. Avoid duplicated/merged routes in this explanation.
- Start playback in Streets and hold 8–10 seconds. Optionally focus one route / Fit route, then clear focus or Fit mix so the whole mix is visible before Score.
- Switch to Score, hold, make one slow drag to reveal the heights, then park the pointer outside the main view and hold 10–15 seconds. Its chrome fades after about 3.5 seconds; automatic orbit resumes roughly 6 seconds after interaction. Keep that quiet hold in the raw recording.
- Switch back to Streets for 5–8 seconds, then back to Score for a final 8–10 second hold. We will choose the few seconds that work best.
- Include system audio. If the recorder cannot capture it cleanly, also provide a WAV export of the same preset and its BPM; synchronizing the actual note blooms is preferable to unrelated B-roll.
- Send the preset link and city name with the take so copy can name the actual example accurately. No particular city is required.

## Product proof / boundaries

Read-only repository check November 15, via CodeGraph exploration:
- Streets route geometry, playheads, note rings and visual focus: components/MapView.jsx:448–515, 698–779, 937–1058.
- Score retains geographic positions horizontally and maps stop pitch to height normalized across the mix: lib/listeningScene.js:20–42, 62–92; MapView.jsx:666–696. Heights are not terrain or loudness.
- Stop blooms follow scheduled notes/velocity: components/ListeningView.jsx:342–370, 446–480.
- Camera turn/zoom, automatic orbit and fade timing: ListeningView.jsx:30–34, 201–220, 373–444.
- View switching changes mapStyle preference, not engine/song audio: components/tabs/MixerTab.jsx:179–188.

These facts are verified against repository source, not a fresh live-deployment recording. The supplied take will confirm visible behavior before production. Do not claim standard sheet music, live vehicle positions, pitch changes from moving the camera, or a Free/Pro restriction. Score needs WebGL and at least one lane.

## Review / distribution

Before posting: verify the real mode labels, visual pitch relationship, actual bloom/audio synchronization, readable portrait crop, URL and unchanged preset across the switch. Use the same finished vertical master on the requested DeettaLabs platforms with native captions tailored at posting time; no posting authorized by this brief.

After posting, inspect retention around the Streets→Score reveal and actual comments about the feature. If viewers confuse height with volume or terrain, clarify pitch in the next edit. Sparse views cannot establish that this hook outperforms other posts or causes incremental signups. Handoff: founder supplies recording/audio; Remotion assembles preview; founder reviews before publication.

## November 18 status update

Founder requested mindfulness as an additional use case. Updated narration uses an invitation to mindful listening, without assuming personal use or promising therapeutic outcomes. Recording, matching audio and preset details remain missing from the content directory. Narration is drafted but not recorded/generated. Edit, preview, final render, platform captions and publishing remain to be done. Capture at least 15 seconds of steady Score playback for the practice prompts and music-only hold.

## November 18 — assets and narration received

Budapest, 72 BPM; preset https://layth.space/?shared=shr_160931bf40a44bf4 . Source recording and music saved in the content folder. Founder authorized Ralf narration; generated in ElevenLabs with existing settings and saved as `ralf-narration.mp3`. Built a 32.4-second narrated preview with the mindfulness invitation and a four-second listening hold. No tier or therapeutic claims added. Source recording has no audio stream; exact UI-to-WAV note synchronization is not verified. Score footage is reused at editorial section changes because the source take contains about 9.5 seconds of Score. Nothing scheduled or published. See preview production-status.json for checks.
