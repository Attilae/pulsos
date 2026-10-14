# Leið: organic launch, October 2026

Prepared October 14, 2026 using the [marketing skill](https://marketing-skill.vercel.app/). Primary job: launch strategy. Surface: self-serve browser product, with the zero-audience overlay. Supporting work: positioning, organic social, content briefs, and measurement requirements.

## The decision

Launch during the week of **October 19**, with the first main video on **Tuesday, October 20**. Spend **€0 on advertising**. Publish **three original videos a week**, adapted for TikTok, Instagram Reels, and YouTube Shorts. This produces nine uploads from three production jobs, rather than nine separate videos.

Lead with **“Turn your city into music.”** Let the viewer hear a good musical result immediately, then reveal the transit route that generated it. Build recognition through repeated city performances, not a tour of every feature.

The first month should earn actual product trials and useful feedback. A planning target is **20 people trying playback and five substantive feedback conversations by November 15**. These are operating goals, not forecasts or industry benchmarks. Report only what can be observed; playback event counts alone cannot establish 20 distinct people.

## Audience and buying situation

| Audience | Situation | Message | Next action |
|---|---|---|---|
| Primary: electronic musicians and curious producers | They want an unexpected musical starting point for a session | “Start a track with your city's routes.” | Try playback and change one lane |
| Secondary: people attached to a supported city | They recognize a route and want to hear it transformed | “What does Budapest sound like?” | Listen, try that city, suggest a supported city |
| Amplifiers: generative-art, music-tech, and transit enthusiasts | They enjoy showing unusual tools to others | “A transport map you can play.” | Share the demonstration or make their own version |

These are hypotheses to check against replies and usage, not validated customer segments. Start with Budapest because it gives the founder a concrete local story, then Berlin for contrast. Do not distribute effort equally across all seven cities immediately.

The producer's alternatives include opening a familiar DAW, using a generative sequencer, or browsing samples. Position Leið as an additional source of musical ideas. There is no need to claim that it replaces a full studio workflow or that transit sonification is a new invention.

## Message and proof

**Core line:** Turn your city into music.

**Explanation:** Leið turns public transport routes into musical tracks, with stops becoming notes. Play and shape the result in your browser.

**Producer variation:** Start a track with a city, then shape the sound.

**Founder variation:** I built a musical instrument from public transport data.

Use “Leið” as the brand and `layth.space` as the practical destination, after checking that the production URL is still correct. Do not let an unfamiliar brand spelling be the only way a viewer can find the product.

| Public claim | Named proof | Qualification |
|---|---|---|
| Routes become tracks and stops become notes | `CLAUDE.md`, main DAW architecture; actual Map/DAW capture | Selected, enabled routes play; the entire city's network is not automatically audible |
| Seven supported cities | `lib/shared/cities.js`; `CLAUDE.md`, multi-city description | Budapest, Helsinki, Berlin, Prague, New York, Zürich, Warsaw |
| Browser experience, including phones | `app/page.jsx`; `CLAUDE.md`, Mobile; production phone trial before upload | Do not imply an App Store download; device rendering and sound still need a current check |
| Editable instruments, lane sound, and notes | `components/tabs/MixerTab.jsx`, `components/StopEditor.jsx`; real product demonstration | Show the actual control and audible result |
| MIDI/WAV export and AI composition | `lib/billing/plans.js`; entitlement checks in the product | Describe access conditions accurately; these are later producer demonstrations, not the first CTA |
| City network supplies musical structure | `lib/engine.js`, `lib/mappings.js`; captured playback | The founder chooses sound and arrangement; cities do not have a single objective sound or genre |

**Current playback uses mock mode with transport data.** Every city's live feed URL is disabled. Approved words: “transport data,” “routes,” “network,” “city-inspired music.” Avoid “live arrivals,” “real-time buses write this beat,” or “this is happening in the city right now.” Source: `lib/shared/cities.js` and the existing [social launch runbook](../../docs/social-launch-runbook.md).

Repository inspection confirms that guests receive Free limits, including six active instrument lanes; drums do not count toward that lane cap. Saving and creating share links require sign-in. The common entitlement-claim path also requires sign-in; Free has three lifetime AI uses and three lifetime exports. Sources: `lib/billing/plans.js`, `lib/shared/EntitlementsContext.jsx`, and `lib/useSongPersistence.js`. Individual export handlers and the AI API route were not separately audited, so do not promote guest AI or export access. Recheck limits before their feature videos; no pricing decision is made here. The actual playback-start handler and production signed-out journey were not fully verified in this planning session, so the October 15–18 trial remains necessary before saying “no signup needed.”

Do not use an unrelated soundtrack as proof of Leið's output. Every city performance should use audio from the exact session shown. For comparisons, keep BPM, instrumentation, and loudness reasonably consistent, and say “my Budapest/Berlin arrangement.”

## Three repeatable video formats

| Format | Editorial starting mix | Promise | Proof | Typical length |
|---|---:|---|---|---:|
| City performance | 6 of 12 videos | Hear a familiar city transformed | Real map playback and matching audio | 12–20 seconds |
| One musical transformation | 4 of 12 | See one route or control change the music | A route becomes notes; a lane joins; a note is retuned | 18–30 seconds |
| Founder or audience response | 2 of 12 | Learn why it exists or hear a requested city | Founder narration, actual result, genuine comment if available | 15–30 seconds |

These durations and proportions are production choices to test, not algorithmic rules. A city performance still needs a fresh arrangement or recognizable route. Swapping a place name over the same audio adds little value.

After setup, reserve approximately four to six hours a week: one recording/music session, one editing session for three masters, and native uploads plus replies. This is a capacity estimate. If it proves too much, reduce to two good videos per week across all three platforms before cutting the time spent answering trial questions.

Recommended timeline for a 20-second video:

1. **0–2 seconds:** strong musical phrase, recognizable city name, readable hook.
2. **2–7 seconds:** reveal the actual map or route; explain the mechanism in one sentence.
3. **7–16 seconds:** one visible transformation with an audible payoff; leave space to listen.
4. **16–20 seconds:** one primary action and a legible destination.

Use a clean 1080 × 1920 master, real recordings, large captions, and close crops. Show the full interface only when it helps orientation. Keep the music louder during listening sections and lower during narration. Check for clipping and listen on a phone speaker and headphones. A face is optional; founder voice over a real screen recording is enough to start.

## Platform adaptation and the route to the product

| Platform | Starting treatment | Primary destination | What to review |
|---|---|---|---|
| TikTok | Direct founder hook, quick reveal, occasional video response to a real comment | Website field if actually available; otherwise show and say `layth.space` | Watch behaviour, profile visits, useful comments, website availability |
| Instagram Reels | Strong city cover, clear before/after audio, one explanatory caption | Profile link; optionally share the Reel to a Story with a website link if available | Shares, saves, profile activity, website traffic |
| YouTube Shorts | Literal title such as “I turned Budapest tram routes into music” | Channel profile website link; show the domain in the video | Engaged views and retention within YouTube; site traffic |

Use one founder-operated Leið account per platform. “I built…” makes authorship clear without requiring a separate personal brand campaign. Upload the clean master separately on each platform; change the title, caption, and destination wording. Avoid a downloaded version carrying another platform's watermark.

**Verified October 14, 2026:** YouTube says URLs in Shorts descriptions and comments are non-clickable; channel profile links are clickable. Use “website on my channel,” not “click the link in this description.” [YouTube link guidance](https://support.google.com/youtube/answer/13748639?hl=en).

**Verified October 14, 2026:** YouTube counts a Short's starts/replays as views and retains “Engaged views” for people who continued watching. Keep both columns and compare performance within the platform, rather than treating raw views across platforms as equivalent. [YouTube Shorts guidance](https://support.google.com/youtube/answer/10059070?hl=en).

**Verified October 14, 2026:** TikTok's advertiser guidance recommends vertical video, sound, safe zones, an early proposition, and a clear CTA. It is vendor guidance for performance ads, not proof of organic success for a new music product; we borrow its production basics. [TikTok creative guidance](https://ads.tiktok.com/resources/help/article/creative-best-practices?lang=en).

**Verified October 14, 2026:** Meta documents Instagram's in-app Best Practices hub with account-specific advice. Check the actual account's professional dashboard before publishing; do not invent a universal hashtag count or best posting hour. [Meta creator guidance](https://about.fb.com/news/2024/10/best-practices-education-hub-creators-instagram/).

TikTok's current website-link eligibility could not be verified from readable official documentation in this session. Do not plan around a follower threshold, switch account types solely on that assumption, or promise a clickable bio link. Check the actual new account. If there is no link, use the spoken and on-screen domain and record the resulting attribution gap.

Recheck these source pages and the actual account interfaces on October 18. Preview each upload on a phone to ensure platform controls do not cover the city, route, captions, or destination.

## Preparation: October 15–18

Allow roughly five to seven focused hours; this is a time budget, not a measured production estimate.

- Create consistent account names, a simple avatar, and one-line bios. Bio copy: **“Turn your city into music. Public transport routes become tracks. Play in your browser.”**
- Check the real signed-out phone and desktop journey: open the URL, understand the introduction, enable an available lane, press Play, hear audio. Confirm any limits and load time. Keep the CTA aligned with what a stranger can do.
- Prepare one pleasing Budapest arrangement and one Berlin arrangement. Record clean system audio plus matching map and DAW footage. Obtain three publishable edits from these recordings.
- Add one platform-tagged profile URL to each available link field. Check that it opens the correct app and preserves the parameters.
- Keep a simple tracking document. Review the first upload as a draft on all three platforms before public release.

Do not spend the weekend making a new landing page, a Discord, a paid logo, or all twelve videos. The live product and three credible demonstrations are the launch assets.

## Four-week calendar

Publish the main videos Tuesday, Thursday, and Saturday. Start around **18:00 Budapest time** for the first batch because the founder can be present to reply. This is an operational choice, not a claimed reach optimum; use dated calendar times through the October daylight-saving change.

| Date | Brief | Hook | Primary action |
|---|---|---|---|
| Oct 20 | L01: Budapest reveal | “I turned Budapest's transport routes into music.” | Try playback |
| Oct 22 | L02: route to melody | “Every stop on this route is a note.” | Try a route |
| Oct 24 | L03: city comparison | “Budapest or Berlin? Listen to both.” | Choose the next city |
| Oct 27 | L04: Helsinki performance | “What does Helsinki sound like as an instrument?” | Try Helsinki |
| Oct 29 | L05: one note change | “One stop. One note. A different melody.” | Try editing a note |
| Oct 31 | L06: founder story | “Why I built a musical instrument from a transport map.” | Try playback |
| Nov 3 | L07: Prague performance | “I made this from Prague's transport routes.” | Try Prague |
| Nov 5 | L08: route rhythm | “This route became a drum pattern.” | Try the drum machine |
| Nov 7 | L09: requested city | “Here's the city you picked.” | Suggest a supported city |
| Nov 10 | L10: New York performance | “New York's routes became this melody.” | Try New York |
| Nov 12 | L11: producer workflow | “A city can be the starting point for your next track.” | Try the browser instrument |
| Nov 14 | L12: Zürich/Warsaw comparison | “Two more cities. Two new arrangements.” | Try a city |

L09 uses the actual poll result or a genuine request. If there is no response yet, use “This week I'm playing Warsaw.” Never fabricate a comment. L11 may demonstrate export only with an accurate access label. Change later city slots based on interest; the supported-city list is the boundary.

The first three videos have complete scripts in [short-video-briefs-2026-10.md](short-video-briefs-2026-10.md). Produce later videos after the first week's feedback. An occasional comment-response clip is optional, not a fourth weekly obligation.

## Distribution with no audience

Publishing is only part of the work. Reserve 20–30 minutes on each publishing day to answer genuine questions and make the next clip more useful.

Find two or three existing places where generative music, electronic production, or local transit is already discussed. Read their current rules first. Share an actual musical result with a short explanation of how it was made, disclose “I built this,” and include the URL only where allowed. A good community post stands on its own even if nobody clicks. Do not paste the same promo into many groups or advertise under unrelated posts.

After there is a convincing demo, a small creator collaboration is optional: supply a city session, a route-based musical idea, or an exported clip with permission to use it. Do not promise exposure, endorsements, or a referral program that does not exist. Direct outreach is a separate user action; no messages are sent as part of this plan. Community-led distribution is a practical bet here, not a proven zero-audience growth formula.

A broad launch directory push is secondary. Save it for a stage when the clips and trial path are clear. There is no need to make next week's launch depend on a leaderboard.

## Measurement and decisions

Primary funnel: **video → profile/channel or typed URL → product → playback → optional signup**. Comments and saves are supporting signals; an account is not required to prove that someone enjoyed the first musical experience.

Profile links should use platform-level tags, for example:

`https://layth.space/?utm_source=instagram&utm_medium=organic_social&utm_campaign=launch_2026_10&utm_content=profile`

Use `tiktok`, `instagram`, and `youtube` consistently. A shared profile link identifies the platform, not the individual video that persuaded someone. Use a post-specific `utm_content=l01_budapest_reveal` only in a real post-specific destination. Do not rotate the profile tag per post and misattribute visits from older videos.

The existing runbook names `playback_started`, `city_selected`, and device-view events. **Event availability is not campaign attribution.** The analyst/engineering handoff must establish whether the analytics tool can join campaign visits to playback, deduplicate sessions, exclude founder tests, and export the relevant data. Do not claim that those abilities exist simply because events fire.

Inspection of `lib/productAnalytics.js` confirms a try/catch wrapper around the vendor's `track(name, properties)`, with no application-level session or user deduplication in that wrapper. The exact `playback_started` emission gate and payload were not fully verified. Treat it as a candidate activation event, not a proven “first play by a new user” metric.

Until that is confirmed, keep three separate observations: platform analytics, site traffic/playback totals, and voluntary answers from people who tried it. Ask “Where did you find Leið?” when someone is already giving feedback; no new required signup field is needed for launch.

Log each upload at 48 hours and seven days: ID, platform, length, views, engaged views where available, watch time/retention, shares/saves, useful comments, profile visits if exposed, and any direct trial feedback. Separately log platform-tagged site visits, playback events, and verified campaign-linked sessions if available. Mark unavailable fields as unavailable.

**Commit these rules before launch:**

1. After six core videos, choose the next batch using repeated signals on the same platform, not the largest isolated view count. Prefer a format that brings real tries or repeated “how do I use this?” questions.
2. If viewers leave before the route reveal across several similar clips, make the reveal earlier and shorten the explanation. Compare videos of similar length.
3. If people watch and visit profiles but few reach the site, inspect the destination and make the domain clearer. If they reach the site but fail to play, investigate the actual phone journey and audio controls before making more content.
4. If a format gets lots of city votes but no sign of product interest, pair its next version with a clear “try it” demonstration. Keep some performances for reach, but do not mistake votes for customers.
5. If data is sparse, produce another batch of three and keep learning. Do not announce an algorithm winner or conversion rate from a handful of clicks.
6. Keep ad spend at zero for the first month. Consider any later spend only as a separate decision after organic trials and the product journey provide a credible reason to pay for more exposure.

These observations guide production decisions. They cannot establish that a video caused a conversion, resolve cross-device identity, recover untagged typed visits, or predict revenue. Keep “unknown source” separate from claims of direct acquisition.

## Existing assets and handoff

The repo already contains a twelve-post Remotion campaign in `_videos/launch/`, existing captures, and `docs/social-launch-runbook.md`. Reuse its rendering infrastructure and valid recordings. This strategy updates the editorial emphasis and timing; it does **not** silently change `_videos/launch/content/posts.json`, which remains the renderer's current input.

Before rendering public versions, the video editor should reconcile the copy with this plan, replace draft narration if desired, and replace the draft music bed with matching real Leið output. The launch README says some feature visuals are recreations; use real recordings for evidence of actual behaviour. Also replace absolute wording such as “these routes never loop together” with what the demonstrated arrangement actually proves.

| Owner | Deliverable | Remaining work |
|---|---|---|
| Founder | Accounts, music selections, narration, uploads, replies | Complete October 15–20 preparation |
| Video editor/founder | Three launch edits, then weekly batches | Follow the companion briefs; sync approved copy into existing production inputs |
| Engineering/data | Honest campaign-to-playback reporting | Confirm event meaning and available attribution before reporting activation rates |
| Design/frontend, only if needed | Clearer first-use entry or mobile fixes | Act on observed trial friction; no redesign required to begin |

Next useful production skill: `remotion-create`/`remotion-render` if making videos in the existing project. No production code, account changes, messages, or public uploads were performed for this marketing deliverable.

## Evidence status

Product claims are grounded in the repository and must be confirmed in the session recorded for public use. Platform mechanics above were checked against their primary documentation on October 14, 2026, except the explicitly unverified TikTok eligibility. The audience selection, hooks, posting cadence, durations, and numerical goals are **practitioner judgments to test for this product**. No SaaS benchmark, universal viral formula, or guaranteed reach is claimed.
