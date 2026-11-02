# Digital product work

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
