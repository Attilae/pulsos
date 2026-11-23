# Digital product work

## 2026-11-04: map implementation plan

- Artifact: [Staged implementation plan](design/design-plans/map-view/implementation-2026-11-04/README.md) and machine-readable handoff.
- Core release: fresh baseline, quiet theme-aware map, route hierarchy, accessible visual focus, progressive stops and bounded musical motion. Geometry-following heads are a separate later phase.
- Constraints: retain the map stack/shared ticker, no per-frame React state, ring caps 8/4, trail samples 10/5, hidden/stopped cancellation, reduced-motion fallback and no repeatable audio regression.
- Scope: documentation only. Includes files, state/motion contracts, responsive dimensions, commands, performance gates and stop conditions. Fresh app rendering, implementation and device/audio validation remain outstanding.

## 2026-11-04: map visual research with a constrained rendering budget

- Artifact: [Map visual research supplement](design/design-plans/map-view/research-2026-11-04.md).
- Evidence: current map/performance code inspection, historical October screenshots, public Mobbin Citymapper/Apple Maps/Google Maps previews, Transit design accounts and browser animation guidance.
- Recommendation: theme-aware quiet geography, route focus, cleaner legend and progressive stop detail; refine existing note feedback rather than add effects. Proposed ring caps are 8 desktop/4 phone, subject to profiling.
- Corrects the older plan's React-state playhead assumption and replaces its proposed high trail sampling with current conservative limits. Existing October plan remains historical.
- Validation limits: no fresh local app rendering, audio listening, benchmark or implementation. Mobbin full browsing requires sign-in. Only research documentation changed.

## 2026-10-26: Reddit community research

- Request: find relevant subreddits for sharing the Leið video and product.
- Artifact: [Reddit community shortlist](marketing/reddit-community-shortlist-2026-10.md), including fit, verified rules, conditional placements, title options, and draft introductory copy.
- Recommendation: start with GenerativeMusic and SideProject after checking current submission requirements; adapt a process post for creativecoding and resolve its AI-content restriction. WATMM's weekly promotion thread explicitly allows project promotion. Transit is a secondary candidate; Budapest needs moderator clarification.
- Validation: checked public community feeds, About/rules pages, pinned welcome guidance, and the current WATMM thread. Excluded musicprogramming and InternetIsBeautiful from the launch-promotion shortlist because their displayed rules conflict with the proposed submission.
- Limits: rankings are editorial fit judgments; no moderator approval, account eligibility, or reach guarantee. Public pages can be cached. The launch video's generated narration needs attention in communities with AI-content restrictions.
- Remaining: founder chooses a community, checks current rules, and submits. No posts, comments, or messages sent.

## 2026-10-20: company versus product social accounts

- Context: Deettalabs already has Instagram, TikTok, and YouTube accounts and plans audio plugins and other products alongside Leið.
- Decision: recommend the existing company accounts for launch, with Leið as a clearly named product series and direct featured product link. Reconsider separation if audience, content needs, and operating capacity justify it.
- Artifacts updated: [Profile and posting guide](marketing/social-profile-and-posting-guide-2026-10.md), [launch strategy](marketing/launch-strategy-2026-10.md). Replaced dedicated-product-account instructions and bios with company identity plus featured Leið copy.
- Evidence: founder's portfolio plans and solo-founder constraints; official Klevgrand and AudioThing sites illustrate multi-product music-tool branding, not a measured social growth advantage. Account audiences and histories have not been inspected.
- Remaining: founder applies approved profile wording and publishes. No account changes or public actions performed.

## 2026-10-19: social profiles and posting guide

- Request: check YouTube Shorts, Instagram, and TikTok guidance and prepare profile setup, bios, posting steps, descriptions, and CTAs.
- Artifact: [Leið social profile and posting guide](marketing/social-profile-and-posting-guide-2026-10.md).
- Content: consistent proposed identity, platform-specific profile copy, first-video captions, profile/Story UTM links, original-audio handling, own-brand and AI-narration disclosure settings, and a repeatable publishing checklist.
- Validation: checked official YouTube, TikTok, and readable Meta guidance. YouTube Shorts links and thumbnail limitations verified; TikTok's specific website-link eligibility and own-brand disclosure verified. Instagram Help Center access was blocked; exact account-specific setup and upload menus remain an in-app check, documented in the guide.
- Evidence limits: profile handles and live account eligibility were not inspected; CTA and hashtag choices are editorial recommendations, not reach guarantees; tags do not establish video-level causality.
- Remaining: founder sets up profiles, tests links/previews, and publishes. No account changes, uploads, or messages performed.

## 2026-10-15: first launch video, revised music

- Request: replace the original music example with the founder's prepared song in Chrome, after the WAV export fix.
- Deliverables: [revised vertical MP4](../_videos/launch/out/reveal/leid-budapest-reveal-v2.mp4), [revised cover](../_videos/launch/out/reveal/leid-budapest-cover-v2.png), [source and reproduction notes](../_videos/launch/REVEAL.md). Original video retained.
- Content: “a little evening metro ride”, Budapest, 134 BPM, G# Major; tram 41 lead, tram 56 bass, drums and route-driven automation. Captured matching picture and continuous native master-bus audio from the existing session. Updated route labels and removed the old claim that a second route joins partway through. Kept the established design and narration.
- Validation: video project ESLint/TypeScript passed; full Remotion render completed; opening, lead, automation, bass and CTA frames inspected; H.264 1080×1920 at 30 fps, 23 seconds of picture, stereo 48 kHz AAC confirmed. Final decoded audio measured -15.05 LUFS and -1.49 dBTP; no silence of 0.2 seconds or longer below -50 dB detected.
- Session handling: stopped playback and restored DAW view after capture; the arrangement was not edited. Temporary local transfer receiver stopped. Short native lossless WAV export retained as a backup.
- Remaining: founder listens and reviews the video in native upload previews before publishing. No social upload performed.

## 2026-10-15: first launch video

- Request: make the first launch video from the marketing plan.
- Deliverables: [vertical MP4](../_videos/launch/out/reveal/leid-budapest-reveal.mp4), [cover](../_videos/launch/out/reveal/leid-budapest-cover.png), [platform copy](../_videos/launch/out/reveal/publish-copy.txt), [editable source and reproduction notes](../_videos/launch/REVEAL.md).
- Content: real Budapest M1/M2 session and native master-bus audio; generated stock ElevenLabs narration; word timing from the TTS alignment; phone-friendly captions and layth.space CTA.
- Validation: video project ESLint/TypeScript passed; full Remotion render completed; representative final frames inspected; H.264 1080×1920/30 fps and stereo 48 kHz AAC confirmed; captured music checked for sustained silence and final loudness normalized to approximately -15 LUFS with -1.5 dBTP filter target.
- Remaining: founder listens/reviews the final file in each native upload preview and publishes. No social upload performed.

## 2026-10-09: map improvement plan

- Request: research similar solutions and create an implementation plan for a more captivating map.
- Artifact: [Map as a spatial score](design/design-plans/map-view/README.md).
- Status: research and plan complete; production implementation not started.
- Baseline: `00a846727d94f3cf354b7630358d1b18ede5bdb1`.
- Direction: clearer route hierarchy, precise musical feedback, intentional framing and visual focus; keep the current Leaflet/MapLibre stack.
- Validation: reviewed local current-state desktop/phone views and both themes; researched primary sources; inspected architecture through CodeGraph.
- Remaining: implement, render, test and measure. Fix the confirmed tablet grid collision causing a zero-size map at 820px before visual sign-off.

## 2026-10-14: organic launch strategy

- Request: use the marketing skill to plan Leið's launch and short videos for TikTok, Instagram and YouTube Shorts.
- Constraints: no existing audience; launch next week; almost no promotion budget.
- Artifacts: [Launch strategy](marketing/launch-strategy-2026-10.md) and [first three video briefs](marketing/short-video-briefs-2026-10.md).
- Direction: launch week October 19; three original videos per week adapted to three platforms; lead with city performances and real musical proof; zero ad spend.
- Validation: read marketing references, existing launch runbook and video assets; checked primary platform guidance and delegated product-claim inspection through CodeGraph.
- Evidence limit: content choices and goals are hypotheses, not reach guarantees; platform attribution is directional; TikTok website-link eligibility needs an actual-account check.
- Remaining: founder prepares music and uploads; video production follows the briefs; reconcile scripts with existing renderer inputs; verify the signed-out trial and measurement before reporting campaign activation.

## 2026-10-16: Budapest preset blog post

- Request: reverse engineer the preset currently open in Chrome and save a company-website blog post as Markdown.
- Deliverable: [How Budapest Becomes a Synth Patch in Leið](marketing/blog/budapest-evening-metro-ride.md), with title, slug, description, excerpt and tags in YAML frontmatter.
- Audience and goal: musicians and curious visitors evaluating Leið; explain one concrete patch and invite readers to build their own in the app. Base surface: the existing self-serve music application. Distribution: the company website, as requested.
- Information gain: documents the actual open arrangement’s five enabled route voices, two modulation sources, granular settings, deliberate rests, sidechains, sends and mastering, rather than a general product overview.
- Primary proof source: the existing Google Chrome tab at https://layth.space/, inspected through native UI and screenshots on 2026-10-16. Selected preset: “a little evening metro ride 2”; Budapest, Mock, 134 BPM, G# Major, stopped, Autosave off, Unsaved. All numeric patch claims were transcribed from visible controls; disabled metro lanes were distinguished from enabled musical lanes. The 16-step drum description applies only to the visible window.
- Evidence limits: this is analysis of the current unsaved configuration, not proof of the cloud-saved version or the creator’s intent. No audio was captured or auditioned, and the article makes no firsthand listening claim. Roles and compositional implications are interpretations of observed settings. The preset was not edited, saved, shared or published; no share link was created. No performance, loudness or audience results are claimed.
- Re-verification: before pairing the article with a later recording or share link, compare that version’s controls with this inspected configuration. The article does not promise that the named preset is publicly available.
- Handoff: the owner can import the Markdown into the company website. No website implementation is required here. If instrumented, app-link clicks can indicate reader interest but cannot establish incremental adoption; no traffic targets or causal marketing outcomes are asserted.

## 2026-10-16: preset article cover

- Request: a cover using the site’s own material, avoiding generic AI imagery.
- Deliverable: [landscape cover PNG](marketing/blog/assets/budapest-evening-metro-ride-cover.png); image path and alt text added to the article frontmatter.
- Method: image generation referenced the actual Chrome screenshot of the preset, with Leið’s palette, typography, transit chips and route 72/37 modulation as the composition. This is an editorial illustration of the UI, not an exact screenshot or reproduction of note data.
- Validation: inspected finished image for headline spelling, brand name, route labels, layout and readable contrast. No website publication performed.
## 2026-10-29: first video soft launch on DeettaLabs

- Request: publish the approved first short video on the three existing company accounts and provide profile bios and platform follow-up. Founder supplied the public preset URL and approved YouTube's upload terms.
- Artifact: [Publication record, bios and follow-up](marketing/soft-launch-2026-10-29.md).
- Published and verified: [YouTube Short](https://youtube.com/shorts/8cBn0F1lZHA), [TikTok](https://www.tiktok.com/@deettalabs/video/7702049865928314134), [Instagram Reel](https://www.instagram.com/reel/DfE6ROAIpov/). Uploaded the approved `leid-budapest-reveal-v2.mp4` with the replacement music. No paid promotion.
- Preset destination: `https://www.layth.space/?shared=shr_656e05229dc64946` in YouTube/Instagram descriptions; saved as YouTube's clickable channel website link. TikTok submission preceded the new URL instruction and retains `layth.space`; desktop actions did not offer a caption edit.
- Verification: YouTube displayed Published and clean copyright checks; TikTok Studio listed the post and its public page showed Promotional content and Creator labeled as AI-generated; a separate Instagram profile tab showed 1 post and the Reel caption with the exact preset URL. Instagram's upload modal remained on Sharing, so no duplicate upload was attempted. AI disclosure enabled on all three.
- Remaining: founder adds/checks Instagram's external profile link, checks TikTok mobile caption editing/website eligibility, optionally applies the supplied company bios, and reviews playback on phones. No account-type change or automated bio rewrite was performed. Metrics are observational and do not establish incremental demand.

## 2026-10-29: second short, Every stop is a note

- Request: create the next short video after publishing the reveal.
- Deliverables: [finished vertical MP4](../_videos/launch/out/route-notes/leid-every-stop-a-note.mp4), [cover](../_videos/launch/out/route-notes/leid-every-stop-a-note-cover.png), [platform copy](../_videos/launch/out/route-notes/publish-copy.txt), [editable source/reproduction notes](../_videos/launch/ROUTE-NOTES.md).
- Content: L02 mechanism explanation, using the approved Budapest paired footage/music. Route 41 lead and 56 bass close-ups match their actual captured view changes. The full mix remains continuous; new stock George narration and timed word captions leave a listening break. Copy uses the owner's shared preset URL.
- Validation: video-project ESLint/TypeScript passed; complete Remotion render; map, lead, bass, listening and CTA frames inspected; H.264 1080×1920/30 fps, stereo 48 kHz AAC, 23 seconds of picture confirmed; entire encoded file decoded without errors; no silence longer than 0.5 seconds below -50 dB detected; encoded audio measured -15.11 LUFS / -1.50 dBTP. No automated test verifies musical taste or pronunciation; owner listens/reviews the rendered file before publication.
- Status: production complete, ready for review. This new video has not been uploaded or published.

## 2026-10-30: soft-launch publishing calendar

- Request: choose when to publish the completed second short after the October 29 launch on X, YouTube, Instagram and TikTok; include existing DeettaLabs blog articles and defer Reddit.
- Artifact: [Current publishing calendar](marketing/publishing-calendar-2026-10-30.md), linked from the original strategy as the replacement for its unused dates/cadence.
- Recommendation: video 2 on Saturday October 31 at 18:00 Europe/Budapest (CET); then Tuesday/Saturday shorts and one weekly useful article or article update/feature. Times are operational choices, not measured reach optima. Later clips require new performances/recordings and are clearly marked planned.
- Blog evidence: founder confirms published articles; live company site/index could not be retrieved. The local Budapest article concerns a later preset variant, so pairing it with the video requires matching its claims and destination rather than assuming it is the same patch.
- Status: calendar complete; no posts scheduled or published by this task. Reddit remains on hold; no new outreach, account changes or paid promotion. Early platform/site observations cannot establish incremental demand.

## 2026-10-30: Route Notes hook and founder voiceover packet

- Request: improve the second video's hook with coreyhaines31/marketingskills and split narration for the founder to generate in ElevenLabs before the final render.
- Deliverable: [five-part recording packet](../_videos/launch/content/route-notes-v2/README.md), five clean `.txt` scripts, machine-readable timing/filename plan, and a prepared `public/route-notes-v2/` audio destination.
- Direction: “This melody started as a tram route.” with “A tram route. A melody.” on screen; approved real Budapest music from the opening; mechanism, lead and bass explanation; music-only break; one invitation to play the arrangement. Applied the installed Corey Haines social/video skills and verified the named repository's social hook reference. Creative judgment, not a measured improvement claim.
- Status: script and handoff complete; awaiting the founder's five voice files. No ElevenLabs request, replacement render or publication performed. The prior RouteNotes MP4 is preserved as v1.

## 2026-10-30: Berlin preset checked for Route Notes v2

- Request: inspect the new public preset in Chrome and adapt route-specific voiceover wording while the founder generates narration.
- Primary evidence: opened `https://www.layth.space/?shared=shr_8750587429f441ba` in a separate Chrome tab; visually inspected lane states, U9/U4/N36 device racks, automation and drums. Berlin, 111 BPM, C minor, Mock. Five enabled instrument routes: U9, U6, U4, N36, 787; M5 and tram 4 modulate U4; drums present. No sound settings or stored preset changed; playback/export not performed.
- Updated [recording packet](../_videos/launch/content/route-notes-v2/README.md) and JSON/text scripts. New hook: “This track started with Berlin's transport routes.” Part 3: “U four plays the bass.” Part 4: “Bus N thirty-six adds plucked strings.” Parts 2 and 5 unchanged. Low-register U4 FM and N36's Sympathetic resonator support these examples without guessing a lead role.
- Remaining: founder supplies new full-mix WAV and voice files; capture Berlin visuals, then synchronize and render v2. Old Budapest picture/music are not to be presented as this performance.


## 2026-10-30: Berlin Route Notes v2 delivered

- Request: assemble the revised short using the five founder-supplied ElevenLabs files in `public/route-notes-v2`.
- Deliverables: [26-second MP4](../_videos/launch/out/route-notes-v2/leid-berlin-route-notes-v2.mp4), [cover](../_videos/launch/out/route-notes-v2/cover.png), [platform copy](../_videos/launch/out/route-notes-v2/publish-copy.txt), [production notes](../_videos/launch/content/route-notes-v2/README.md). Original Budapest revision preserved.
- Production: stronger Berlin hook; U4 FM bass/N36 plucked strings; approximately six seconds of music-only listening; supplied narration with ElevenLabs forced word alignment, no regenerated speech. Actual stopped Berlin UI stills captured through Chrome with editorial camera motion, no fabricated synchronized playback. Used the latest 111 BPM full-mix export found in Downloads; its association with this preset is inferred from tempo and timing, documented in music-source.json.
- Verification: video-project ESLint/TypeScript and complete render passed; cover and representative scene frames inspected; full final-file decode clean. H.264 1080×1920/30 fps, 26 seconds picture, stereo 48 kHz AAC; encoded −15.32 LUFS / −1.49 dBTP. Owner listening review remains. No publication or scheduling; Reddit still on hold. Updated calendar assets to Berlin v2.

## 2026-10-30: Berlin v2 caption corrections

- Updated displayed route identifiers to U4 and N36, retaining their aligned speech timing. Kept “I choose the sound.” on one caption page, separate from “a note.” Added normalization to the import script so a future import preserves the route spellings.
- Re-rendered the existing Berlin v2 MP4; no change to voice or music. Video-project ESLint/TypeScript passed. Inspected corrected phrase/U4/N36 frames; final encoded audio remains −15.32 LUFS / −1.49 dBTP. No upload or scheduling.

## 2026-10-30: Berlin short scheduled on three platforms

- Authorized by founder after caption review: schedule corrected Berlin v2 where available, use new preset and link-in-bio CTA. Calendar time retained: October 31 at 18:00 Europe/Budapest (CET). Founder confirmed YouTube terms and manually completed file picker steps when native Open stayed disabled to automation.
- Scheduled and verified: [YouTube](https://youtube.com/shorts/aEv8wIURHRg), [TikTok](https://www.tiktok.com/@deettalabs/video/7702413502803119382), [X queue](https://x.com/compose/post/unsent/scheduled). YouTube confirmation shows October 31 18:00, local GMT+0100, copyright clear, not for kids and AI disclosure. TikTok row shows October 31 6:00 PM and 00:26; Your brand and AI labels selected. X queue shows same day/time in CET and 00:26; Made with AI enabled. These are scheduled posts, not publication confirmations.
- Instagram not scheduled: existing account is personal (Account type and tools offers Switch to professional account); founder has no product Facebook account. No conversion, linking or Facebook setup. [Manual post packet](../_videos/launch/out/route-notes-v2/instagram-manual-post.txt) prepared.
- Verified public Lnk.Bio has exact Berlin preset shr_8750587429f441ba plus Budapest. Instagram profile link already points there. Updated YouTube channel website from direct Budapest preset to Lnk.Bio, saved and publicly verified. TikTok bio destination updated to lnk.bio/deettalabs; no separate website field offered, so it is plain bio text. [Status record](../_videos/launch/out/route-notes-v2/scheduling-status.json). Reddit remains on hold.

## 2026-11-02: Video 3 picture/music preview and voice packet

- Request: prepare the revised third short, “Your next melody could start with a transport map.” Founder confirmed they will generate the five voice parts in ElevenLabs again. Applied social/video and Remotion skills.
- Delivered [five-part recording packet](../_videos/launch/content/map-melodies/README.md), clean text scripts, audio destination `public/map-melodies`, [26.87-second picture/music preview](../_videos/launch/out/map-melodies/leid-map-melodies-preview.mp4), [cover](../_videos/launch/out/map-melodies/cover.png) and [draft publishing copy](../_videos/launch/out/map-melodies/publish-copy.txt).
- Uses approved Budapest and Berlin music, independently normalized, with four-second listening windows. Actual map UI stills with editorial camera motion and real audio spectrum; no fake synchronized playback. Different musical settings remain, so no controlled geography-only comparison. Berlin source association retains the previously documented tempo/timestamp inference.
- Implementation: preview/final/cover compositions, voice-measured timing and cached forced-alignment importer; no paid TTS or alignment calls performed now. Final render is gated until voice import. Checks: video-project ESLint/TypeScript, importer syntax, full preview render and representative-frame inspection passed; preview encoded audio −15.11 LUFS / −1.49 dBTP. Founder listening/voice review remains.
- Updated calendar and L03 brief. November 3 at 18:00 CET remains a target; no video 3 upload or scheduling. Waiting for five supplied voice files before final alignment/render. No production app code modified.

## 2026-11-02: Berlin arrangement blog article drafted

- Request: write the recommended article, “How I Made a Track from Berlin’s Transport Map.” Applied content-strategy/copywriting skills; considered ten titles, kept the approved angle, and reviewed structure, evidence, clarity, language and publication metadata.
- Deliverable: [Markdown article](marketing/blog/berlin-transport-map-music.md), three original screenshot assets copied unchanged, [video embed](marketing/blog/berlin-video-embed.html), [draft promotion copy](marketing/blog/berlin-transport-map-promotion.txt), and separate [editorial/source notes](marketing/blog/berlin-transport-map-music-editorial-notes.md).
- Content: U4’s low FM synth bass, N36’s Sympathetic resonator, M5/tram 4 modulation, other voices and a one-control-at-a-time reader experiment. Accurate Mock-mode description; no invented founder anecdote, live-arrival claim, performance result or unknown lead assignment. Uses the supplied Berlin preset ID and approved short ID.
- Checks: configuration details reviewed against October 30 source notes and original screenshots; local image paths valid, screenshot copies match source hashes, share/video IDs correct, no placeholders in article. Live blog/preset/video retrieval failed through the web tool, so no claim of current remote availability or duplicate-content audit. No CMS publication, external post or scheduling action. Video 3 still awaits founder voice files.


### November 2 — Berlin article publication

Owner explicitly authorized publication and promotion. Published and verified https://www.deettalabs.com/blog/berlin-transport-map-music with three real app screenshots. Added “Read the Berlin track breakdown” to Lnk.Bio, preserving both preset links. X announcement verified at https://x.com/deettalabs/status/2117283852611641627. Story asset rendered and submitted through the phone browser editor; see `marketing/blog/berlin-publication-status.json` for final Story evidence. No Facebook setup, account conversion or Reddit action.

Instagram Story publication verified in a separate profile tab: new Story ring and own Story viewer with 1m timestamp. CTA is link in bio, leading to the article item. All four authorized publication actions complete.


### November 3 — Video 3 voiceovers and final edit

Founder authorized generating the five prepared scripts in the signed-in ElevenLabs account. Generated and saved five separate MP3 clips with the existing Ralf Eisend narrator / Eleven v4. Imported durations, forced-aligned captions and rendered the final 24.6-second Map Melodies video. Final asset: `_videos/launch/out/map-melodies/leid-map-melodies.mp4`; voices ZIP alongside it. Lint/type check, complete audio/video decoding and six-frame caption review passed; −15.09 LUFS / −1.50 dBTP. Listening review pending. No scheduling or public social post.


### November 3 — Video 3 published on all four channels

Owner approved voiced edit and said go on/continue. YouTube scheduled 18:00 CET and subsequently confirmed Public: https://youtube.com/shorts/-3Wt2nR2xZk. Remaining posts published after resumed handoff at 19:47 CET: X https://x.com/deettalabs/status/2117690314282467582 ; TikTok https://www.tiktok.com/@deettalabs/video/7704019654330617110 ; Instagram https://www.instagram.com/deettalabs/reel/DfSkg2WoIMc/ . TikTok initially under review, then refreshed row confirmed Everyone at 19:51. Instagram sharing confirmation and profile permalink verified. AI labels set; TikTok own-brand checked. All use the narrated master (−18.20 LUFS / −2.99 dBTP). Rechecked both preset links in public Lnk.Bio. Evidence in `marketing/map-melodies-publication-status.json`. No Facebook/account conversion, outreach or Reddit actions.


### November 7 short — revised founder direction

Founder requested replacing the one-stop/note edit with default lane sound → finished sound design. Prepared `marketing/nov-7-default-to-designed-sound.md` and updated the calendar: genuine initial lane capture, early finished-patch reveal, instrument choice (Resonator or Macro), arp, Texture and FX. Source route/pattern and base tempo remain traceable; compare perceived levels fairly. Capture and patch review pending. No new video, narration, shared preset or external post created.

## 2026-11-06: Default-to-designed short prepared

- Request: replace November 7’s stop-edit video with the supplied default/after WAVs and matching preset. Founder selected music and labels only; no ElevenLabs narration.
- Delivered [19.47-second review MP4](../_videos/launch/out/default-to-designed/leid-default-to-designed.mp4), [cover](../_videos/launch/out/default-to-designed/cover.png), [platform copy](../_videos/launch/out/default-to-designed/publish-copy.txt), [production notes](../_videos/launch/content/default-to-designed/README.md) and [updated November 7 brief](marketing/nov-7-default-to-designed-sound.md).
- Preset visually inspected in Chrome: Prague, 74 BPM, F# Dorian, metro A/B/C; A Resonator Modal with arp/Texture Mk II; B Macro Chords with reverb/delay/chorus sends. Real static finished-preset captures; no fabricated isolated intermediate audio, control changes or synchronized playback. Unsaved imported copy used; stored source preset untouched.
- Constant gain matches full sources to -16.5 LUFS; preserves originals and hashes. Full-mix comparison with two bars before and four after. Encoded -16.54 LUFS / -1.88 dBTP. Video-project lint/TypeScript, render, scene/cover visual inspection and full file decode checked; founder listening/creative review remains.
- Calendar target November 7 at 18:00 CET retained. No publication, scheduling, Lnk.Bio mutation or Reddit action. New Prague preset item remains a publishing handoff; video CTA is layth.space.


## 2026-11-06: Narrated before/after revision

- Founder rejected the music-only ending and requested narration again. Generated five new clips through signed-in ElevenLabs using the existing Ralf Eisend / Eleven v4 settings; retained Generation 1, source scripts, hashes and downloads. No account/payment changes.
- Current deliverable: [27.07-second narrated short](../_videos/launch/out/default-to-designed/leid-default-to-designed-narrated.mp4), [revised cover](../_videos/launch/out/default-to-designed/cover-narrated.png), whole-clip captions and a new end card: “Start with this patch. Then make it yours.” Music-only v1 preserved. Clear music listening windows retained; matched source levels and smooth ducking under voice. After recording repeats to support longer timing.
- Video-project ESLint/TypeScript, render, representative captions/ending visual inspection and full decode passed. Encoded -17.89 LUFS / -2.39 dBTP. Founder listening and creative review pending; no claim of independent listening approval. Calendar, brief and platform packet now point to the narrated revision. Exact shared preset is required for direct preload; new Prague Lnk.Bio item still pending before publication. No scheduling, posting or external messaging performed.


## 2026-11-08: Loop-upload feature becomes next launch priority

- Founder requested promoting Your loop before the next city performance, selected bass line, and will supply original/finished audio. Same ElevenLabs narrator requested.
- Applied marketing, social, copywriting and video skills. Read-only CodeGraph exploration verified Pro gating, local-only reference storage, manual bar count/Match BPM, auditioning alongside routes and lane MIDI export. No live deployment or new example verified yet; no automatic key detection/time-stretch/audio-to-MIDI claim.
- Prepared [feature brief](marketing/your-loop-bass-short.md), [five-part script and edit/asset packet](../_videos/launch/content/your-loop-bass/README.md), [draft caption](../_videos/launch/out/your-loop-bass/post-copy-draft.txt). Updated calendar: loop feature provisional Nov 10, supporting article Nov 12, held Prague Nov 14, Helsinki deferred Nov 17. Dates conditional on readiness; no queue changes/publication.
- Final feature video awaits original loop, combined loop+bass, and matching setup/preset. Do not substitute unapproved output/loop.wav. Narration can be prepared independently with existing Ralf Eisend / Eleven v4 voice.


### November 8 — Loop/bass narration completed

Founder confirmed Chrome handoff to generate the five new clips. Used existing Ralf Eisend - Deep and Gravely / Eleven v4, stability 0.19, similarity 0.75; retained Generation 1. Five unique MP3s copied into `public/your-loop-bass`, durations/hashes recorded, complete decode clean; [voice ZIP](../_videos/launch/out/your-loop-bass/elevenlabs-voiceovers.zip) ready. Credit balance shown 39,218 → 39,002. No account or payment changes. Original loop, combined loop+bass and matching session/preset still awaited, so no feature video rendered or published. Calendar/brief now record voice readiness.

### November 10 — Loop demo revised to bass plus two leads

Founder provided `before.wav` and `after.wav`, describing the finished version as their loop with a bass line and two leads built in Leið. Copied the originals into the Remotion public assets and recorded hashes/metadata. Updated the hook, five-part narration, edit plan, marketing brief and caption to show a fuller loop-to-arrangement transformation. The Nov 10 target is now unscheduled pending matching UI/session captures, replacement ElevenLabs narration and founder review. Prior bass-only voice clips remain archived but no longer match the script. Audio has not yet been auditioned or boundary-checked in this session. No render, scheduling or post performed.


## 2026-11-09: Founder-story short reviewed

- Founder proposed own narration over a rehearsal-room drum fill, Budapest transport montage and a DAW overview. Separate from the loop/bass feature, whose source loops they are still preparing.
- Prepared [creative review, revised script and shot guide](marketing/founder-story-short.md) plus [clean founder recording script](../_videos/launch/content/founder-story/narration-script.txt). Preserved the two personal-interest lines, tightened bridge to “So I built Leið”, added route/pattern/notes/instrument explanation and an uninterrupted music proof before a spoken product URL.
- Recommended first-frame text revealing the transport/music premise, a brief fill, actual DAW route-to-lane shots, and returning to founder for CTA. Existing Remotion project selected for future assembly. No ElevenLabs generation for the founder's voice. No fabricated backstory or live-arrival claim.
- Review concept only: footage/narration not received, no render, publication date, queue changes or external post. Loop/bass feature remains next priority.

## 2026-11-11: Founder-story footage and Walkthrough Studio fit

- Founder supplied an initial batch of six rehearsal/transport/work source movies and said more is coming. Reviewed technical metadata and contact sheets. Updated the founder-story README/marketing brief to make this the current production focus; loop/bass production is paused and no publication date changed.
- Reviewed the public Walkthrough Studio overview and published `walkthrough-film` skill against the existing Remotion project and local HyperFrames/media-use skills. Recommended Walkthrough Studio for a genuine Leið UI capture only, with Remotion remaining the master assembly for portrait camera footage. Added a shot guide/fit note with source durations, production tradeoffs and readiness.
- The external toolkit is not installed. No third-party code was installed or executed, and no video was rendered or scheduled.

### November 11 — founder footage / Walkthrough Studio clarification

- Founder clarified that `coding.MOV` is the right founder-at-work image for “So I built Leið”; it is not product footage. Use Walkthrough Studio for real product UI footage, with Remotion as the master editor.
- User installed the Walkthrough Studio plugin. Initialized a project under `_videos/launch/content/founder-story/walkthrough-studio/`; recorder dependencies and Chromium are installed, and the CLI must run with Node 24.
- A read-only phone-viewport explore of the public Budapest preset (`shr_656e05229dc64946`) succeeded, confirming the Budapest map and visible controls. Capture test and takes remain pending. The explore did not click controls or audition audio. About 17 GB free on the project volume.
- Updated the shot plan, README and marketing brief to keep founder footage separate from product footage. No video recorded, rendered, scheduled or published.

### November 11 — founder-story direction test rendered

- The founder requested a test video. Recorded an action-logged Walkthrough Studio take of the public Budapest preset: route list → M1 Notes → M1 Tone. The accepted phone take passed sync with a 49.01 ms maximum gap outside waits; the isolated Chromium capture-quality test also passed. The first take included the welcome tour and the second had a 239.8 ms panel-transition gap; neither was used in the edit.
- Rendered a 13.2-second 9:16 Remotion direction test at `../_videos/launch/out/founder-story-test/leid-founder-story-direction-test.mp4`. It uses a drum fill, Budapest transit clips, portrait-displayed `coding.MOV` under “So I built Leið,” and actual Walkthrough UI. Temporary captions stand in for the founder's own narration; no ElevenLabs voice was generated.
- Full file decode passed; H.264/AAC, 1080×1920, 13.2 s. Audio measured -20.10 LUFS / -1.57 dBTP; founder listening and creative review remain pending. The files and shared preset were not changed. No scheduling or publishing.

### November 11 — founder-story direction test revised

- Founder asked to slow the cut, include both music-making clips and all three transport clips, and use multiple desktop screenshots for the product section.
- Revised the Remotion test to 30 seconds: drum fill and piano footage, three Budapest transit excerpts, `coding.MOV` for “So I built Leið,” then desktop screenshots showing the Budapest map, DAW notes and M1 sound controls. The final section holds on the actual Budapest track, includes 3.5 seconds without text for listening, and ends with `layth.space`.
- Rendered `../_videos/launch/out/founder-story-test/leid-founder-story-direction-test-v2.mp4`; 1080×1920, 30 fps, H.264/AAC. Full decode passed. Captions remain placeholders for founder narration; human listening and creative review are pending. Nothing scheduled or published.

### November 12 — Your loop review video rendered

- Resumed the loop-plus-bass-and-two-leads demo. Generated five revised ElevenLabs clips with the existing Ralf Eisend / Eleven v4 voice and retained Generation 1; old bass-only clips remain unused. Credits shown 39,002 → 38,790.
- Verified Berlin, C minor, 100 BPM, four bars and U4/U8/U7 parts. Loaded the original before.wav in the signed-in capture browser. An uppercase filename wait interrupted the upload take; recovered actual stills, then captured instrument views separately. UI images are genuine editorial crops; no completed Match BPM click or synchronized app playback is fabricated. No authenticated state was saved into the project.
- Rendered `_videos/launch/out/your-loop-bass/leid-your-loop-bass-and-leads-review.mp4`, 29.2 seconds, 1080×1920, H.264/AAC. Includes a finished-mix tease and an uninterrupted four-bar reveal. Matched the source phrase at about 6.478 seconds into after.wav and estimated reference gain without independently normalizing the complete mixes.
- ESLint/TypeScript and full video decode passed; contact sheet inspected. Audio measured −16.1 LUFS / −2.8 dBTP. Founder listening and creative approval remain pending. No schedule or publication changes.


## November 13 — Your loop video v3

Founder changed uploaded loops to Free with sign-up and supplied `daw-preset-record.mov`. Replaced all screenshot components with real recording excerpts in `YourLoop`; preserved supplied before/after music and the four-bar reveal. Removed false Pro CTA from playback and captions. V3 review: `_videos/launch/out/your-loop-bass/leid-your-loop-bass-and-leads-v3-review.mp4`. Closing card says Free with sign-up. Reuses first four ElevenLabs clips; final spoken replacement “Sign up free and build around your own loop.” is prepared but awaits generation after the founder's meeting. Local-only work, no visible UI/browser use. Lint/typecheck and full decode passed; visual contact sheet inspected; encoded audio −17.04 LUFS / −2.64 dBTP. Not scheduled or published.


## November 13 — Your loop final delivered

After computer handoff, generated the corrected closing voiceover in signed-in ElevenLabs: “Sign up free and build around your own loop.” Same Ralf Eisend / Eleven v4 settings (0.19 stability, 0.75 similarity), Generation 1, 3.004 seconds; saved `v3-5-cta.mp3`. Rebuilt mixed audio/captions and rendered `_videos/launch/out/your-loop-bass/leid-your-loop-bass-and-leads-final.mp4` (29.2 s, 1080 × 1920, H.264/AAC). Final decode passed; closing card/captions inspected; −15.92 LUFS / −2.64 dBTP. No production work pending, nothing scheduled or published.


## November 13 — Your loop video published

Published the final screen-recording/Free-with-sign-up version on the existing DeettaLabs accounts, at founder's request:
- YouTube Short: https://youtube.com/shorts/oX5VPiFRz8o — public; title “I added a bass line and two leads to this loop | Leið”; not made for kids; AI narration disclosed; copyright checks found no issues. Published confirmation verified.
- Instagram Reel: https://www.instagram.com/deettalabs/reel/Dfr8hBSoXAs/ — full 9:16, sound on, AI label enabled; caption explicitly says uploaded loops are Free with sign-up and directs to layth.space / link in bio. Shared confirmation and live profile entry verified.
- X video: https://x.com/deettalabs/status/2121261280933658693 — video published successfully but composer caption did not persist. Edit requires Plus, so context and free-sign-up tracked link were added in a verified reply: https://x.com/deettalabs/status/2121261526225195075 . No duplicate video posted.

Founder authorized YouTube terms for this upload and manually opened the final MP4 in all three native file pickers, which remained disabled to agent controls. Publishing record and exact copy: `_videos/launch/out/your-loop-bass/publishing-2026-11-13.json`. No TikTok post requested or made.


## November 13 — Founder-story narrated preview

Founder supplied new synth/transit footage, a Budapest product screen recording, personal narration and preset WAV. Built `_videos/launch/out/founder-story/leid-founder-story-preview-v3.mp4` (31.2 s, 1080 × 1920, 30 fps). Uses real drums, piano, modular synth, bus/metro selfie and tram clips; coding.MOV remains under “So I built Leið.” Real recording replaces product screenshots. Local transcription drives phrase captions; 4.8-second music gap added before the URL, founder voice leveled and music ducked. Only original supplied audio, no ElevenLabs for this story. Lint/TypeScript and full decode passed; rendered contact sheet inspected; encoded audio −18.11 LUFS / −2.80 dBTP. Preview only, not published or scheduled. Reproducible asset/audio prep: `_videos/launch/scripts/prepare-founder-story.py`; composition: `FounderStoryPreview`.


## November 15 — Streets & Score next-post brief

Founder selected Map view (Streets and Score) for the next feature post and will supply a screen recording. Prepared narration and shot/recording plan at `digital-product/marketing/streets-and-score-short.md`, with narration text under `_videos/launch/content/streets-and-score/`. Hook: “Same track. Two ways to see it.” Read-only source verification confirms visual-only mode switch and pitch-height / note-event Score behavior. No live deployment check, voice generation, render or publishing for this item yet. Founder-story preview remains a separate draft. Publication date not assigned.


## November 18 — Streets & Score narrated preview

Founder supplied screen-recording.mov and 72 BPM Budapest WAV, preset https://layth.space/?shared=shr_160931bf40a44bf4 . Authorized ElevenLabs Ralf narration; generated one full script in Ralf Eisend - Deep and Gravely / Eleven v4 (stability 0.19, similarity 0.75), Generation 1. Founder saved it through the disabled-to-agent native Save dialog. Rendered `_videos/launch/out/streets-and-score/leid-streets-and-score-preview.mp4`, 32.4 s / 1080 × 1920 / 30 fps, with mindful-listening invitation, phrase captions and four seconds of music without narration. Omitted DAW section; used Streets/Score parts of supplied recording, reusing short Score excerpt at section changes. Separate WAV provides audio; exact note-by-note UI synchronization is unverified. Original 72 BPM preserved, music looped at eight bars. Lint/TypeScript and full decode passed; visual sheet inspected; encoded −17.14 LUFS / −2.48 dBTP. Nothing scheduled or published. Production details: output production-status.json. Founder creative/listening review next.
