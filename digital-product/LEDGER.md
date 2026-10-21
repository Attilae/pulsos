# Digital product work

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
