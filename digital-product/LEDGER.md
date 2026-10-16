# Digital product work

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
