# Leið: first three launch videos

Production briefs for October 20, 22, and 24, 2026. Companion: [launch strategy](launch-strategy-2026-10.md). These are scripts and requirements, not rendered videos. New IDs L01–L03 distinguish them from the existing `_videos/launch/content/posts.json` records.

## Shared direction

Use 9:16, 1080 × 1920 masters. Start with actual music and a clear city or route hook. Include readable burned-in captions for spoken words, short labels for listening sections, and a destination that survives platform overlays. Use real product footage and audio from the same session.

Keep one action per video. A poll video asks for a vote; a trial video asks viewers to try playback. Profiles carry the product explanation and destination. Do not stack “like, save, follow, comment, share, sign up” onto every ending.

Use the strongest musical phrase at the start, then cut between close map and DAW crops. Show a logo only after viewers understand the premise. Make the name and domain legible while the music continues, rather than stopping for a long end card.

All timings are editable production starting points. If the actual narration needs more time, shorten the wording before adding dead time. Do not synchronize note highlights to audio that came from a different performance.

## L01 — I turned Budapest into music

**Date:** October 20. **Length:** approximately 20 seconds. **Audience:** curious producers and people who know Budapest. **Goal:** first playback trial. **New information:** an actual instrument can use familiar transport routes as its musical structure.

**Cover:** BUDAPEST, PLAYED AS MUSIC

| Time | Picture | Audio / spoken words | Overlay |
|---|---|---|---|
| 0–2 s | Active Budapest map, close enough to see a route | Strong phrase from the completed arrangement; “I turned Budapest's transport routes into music.” continues into the next shot | “Budapest → music” |
| 2–7 s | Cut to the corresponding route lane and note rail | “Each line is a track. Each stop is a note.” | One phrase at a time, following narration |
| 7–13 s | Enable a second prepared lane; show it joining | No narration; let the added voice be heard | “Add a route. Hear it join.” |
| 13–17 s | Back to the map with the same arrangement playing | “You can play it in your browser.” | “Turn your city into music” |
| 17–20 s | Music and map continue; destination appears centrally | Platform-specific CTA below | “Leið · layth.space” |

**Full voiceover:**

> I turned Budapest's transport routes into music. Each line is a track. Each stop is a note. You can play it in your browser. Try it at layth.space.

**TikTok caption:** “Budapest's transport routes became this arrangement. I built Leið so you can play a city in your browser. Try layth.space. #Budapest #GenerativeMusic #MusicTech”

**Instagram caption:** “A transport map you can play. I made this Budapest arrangement in Leið: routes become tracks, stops become notes. Try it through the link in my profile.”

**YouTube title:** “I turned Budapest's transport routes into music”

**YouTube description:** “This arrangement was made in Leið from Budapest's transport network. Try the browser instrument through the website link on my channel.”

**CTA variants:** TikTok: “Try it at layth.space,” unless the actual account has a tested website field. Instagram: “Try it through my profile.” YouTube: “Try it through the website on my channel.”

**Proof sources:** `lib/shared/cities.js`, `components/tabs/MixerTab.jsx`, `lib/engine.js`, the actual Budapest capture. This is transport-data playback, not a live arrival demonstration.

**Distribution:** Native upload to all three platforms. Share the finished result in one suitable local or music community only if its current rules allow founder work. The community version should explain the route choice.

## L02 — Every stop is a note

**Date:** October 22. **Length:** approximately 22 seconds. **Audience:** producers who want to understand the mechanism. **Goal:** try a route. **New information:** the map supplies the note sequence, while the person can shape how it sounds.

**Cover:** THIS ROUTE IS A MELODY

Choose an actual available Budapest route with a recognizable name and enough musical space to hear the stops. Put its real name on screen after selection. Do not invent a route ID or imply that the notes are recordings of vehicles.

| Time | Picture | Audio / spoken words | Overlay |
|---|---|---|---|
| 0–3 s | Route visible on the map, melody already sounding | “Every stop on this route is a note.” | “Every stop = a note” |
| 3–7 s | Matched note rail with readable stop highlights | “The route gives me a sequence.” | Actual route name |
| 7–10 s | Add a prepared second lane | “Then I choose how it sounds.” | “Add another voice” |
| 10–18 s | Closely cropped playback showing both lanes | No narration; listen to the resulting phrase | “Built from transport data” |
| 18–22 s | Return to map; domain appears | “Pick a city and try a route at layth.space.” | “Leið · layth.space” |

**Full voiceover:**

> Every stop on this route is a note. The route gives me a sequence. Then I choose how it sounds. Pick a city and try a route at layth.space.

If the actual anonymous journey restricts city selection or lane count, adjust the invitation to the verified free experience. The recording should show the correct enable/Play actions, even if edited into a short sequence.

**TikTok caption:** “A transport route gave me the sequence. I chose the sound. Try making your own in Leið at layth.space. #GenerativeMusic #MusicProduction #Budapest”

**Instagram caption:** “From route to melody. This is one Budapest route playing in Leið, with another lane joining it. You can try the browser instrument through my profile.”

**YouTube title:** “Every transport stop becomes a note in this browser instrument”

**YouTube description:** “A real Leið session showing a Budapest route mapped to notes. Try it through the website link on my channel.”

**CTA variants:** Same destination treatment as L01, with one action: try a route.

**Proof sources:** `lib/engine.js`, `lib/mappings.js`, route lane/stop rail in `components/DawView.jsx`, actual recording. Avoid claims about a specific geographic pitch formula unless that mode is actually selected and demonstrated.

**Distribution:** All three native uploads. This is the useful explanation to link from genuine “how does it work?” replies and to feature on the account alongside the reveal.

## L03 — Budapest or Berlin?

**Date:** October 24. **Length:** approximately 18 seconds. **Audience:** city fans and music-curious viewers. **Goal:** choose the next city. **New information:** different networks provide different structures for a playable arrangement.

**Cover:** BUDAPEST OR BERLIN?

Prepare comparable arrangements with the same BPM and a similar sound palette and loudness. Name them as the founder's arrangements, not as the true sound of each city. Record each city separately; footage and audio must match.

| Time | Picture | Audio / spoken words | Overlay |
|---|---|---|---|
| 0–2 s | Budapest map in motion; audible music | “Budapest or Berlin? Listen to both.” | “Budapest or Berlin?” |
| 2–7 s | Budapest performance | No narration | “My Budapest arrangement” |
| 7–12 s | Berlin performance | No narration | “My Berlin arrangement” |
| 12–15 s | Short return to the preferred visual; music continues | “Both started with transport routes.” | “Routes become music in Leið” |
| 15–18 s | Readable city choices, modest brand/domain | “Which city should I play next?” | “Helsinki / Prague / New York / Zürich / Warsaw” |

**Full voiceover:**

> Budapest or Berlin? Listen to both. Both started with transport routes. Which city should I play next?

**TikTok caption:** “Two city networks, two arrangements I made in Leið. What should I play next: Helsinki, Prague, New York, Zürich or Warsaw?”

**Instagram caption:** “Budapest or Berlin? I made both arrangements from their transport routes in Leið. Tell me which supported city you want to hear next.”

**YouTube title:** “Budapest vs Berlin: transport routes turned into music”

**YouTube description:** “Two arrangements made in Leið with different city networks. Which supported city should I play next? The browser instrument is on my channel's website link.”

**Primary CTA:** A genuine city request. Keep `layth.space` visible for curious viewers, but do not add a second spoken request. A comment is a creative input, not a lead or signup.

**Proof sources:** `lib/shared/cities.js`, actual Budapest and Berlin playback. The output also depends on route choices, instrument settings, and arrangement; no controlled city comparison is claimed.

**Distribution:** All three platforms; use answers to choose L09. If someone asks for an unsupported city, say it is not available yet and note the interest without promising a release date.

## Caption and reply bank

Use only replies that fit verified current access:

- **“Is this live?”** “This version plays from public transport data in mock mode. Live feeds are currently disabled.”
- **“Which cities?”** “Budapest, Helsinki, Berlin, Prague, New York, Zürich and Warsaw.”
- **“Where can I try it?”** “It's a browser instrument at layth.space.” Add the relevant profile/channel direction if available.
- **“Are these recordings of trains?”** “The routes and stops supply musical structure. The sound comes from the instruments I choose in Leið.”
- **“Can you add my city?”** “It isn't supported yet. I'm keeping track of requests.”
- **“Is export free?”** “The current Free plan includes three lifetime exports after sign-in.” Recheck the current entitlement before posting this reply; never equate trying playback with unrestricted feature access.

Do not impersonate transit operators, imply their endorsement, or call draft TTS a customer voice. The launch is the founder showing real work.

## Before upload

Confirm that each hook pays off; music matches footage; public claims match the current product; captions are readable; the destination works; and the platform CTA matches the available link surface. Compare any reused assets against `_videos/launch/README.md`, which identifies draft audio and recreated visuals. Keep the scripts in this document distinct from the renderer inputs until deliberately synchronized.

After upload, record the actual URL and observations at 48 hours and seven days. Preserve a clean master and separate platform copy so feedback can improve the next edit without rebuilding the campaign.
