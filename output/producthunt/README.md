# Leið · Product Hunt media

## Ready to upload

- `thumbnail/leid-240.png`: square listing logo, 240×240. `leid-512.png` is the larger version.
- `gallery/01-…png` through `05-…png`: five 1270×760 gallery images, in the recommended order.
- `thumbnail/video-cover-1280x720.png`: cover for the landscape demo.
- `video/leid-producthunt-demo-36s.mp4`: main 1920×1080, 30fps launch video.
- `video/leid-producthunt-teaser-15s.mp4`: 1920×1080, 30fps short alternative.

Use the five numbered files inside `gallery/`, not the older raw screenshots at this folder's root. Those originals remain as source/reference assets.

The videos use music and on-screen explanations, with no voiceover. The 36-second film starts with 22 seconds of a real Budapest performance, with picture and audio kept synchronized. At 22 seconds it explicitly switches to Berlin screenshots and a separate real Berlin arrangement. The final four seconds show the site and export features. The teaser is a 15-second excerpt of the Budapest performance with a closing call to action. No live-feed claim or simulated playback highlights have been added to the stills.

## Add to Product Hunt

1. Upload `thumbnail/leid-240.png` as the logo.
2. Upload all five `gallery/` images and keep their numbered order.
3. Upload the main MP4 to YouTube, set its cover, and paste the full watch URL into the Product Hunt video field. Confirm that the video is viewable by visitors before launch. Current Product Hunt help documents YouTube links; the draft UI also displayed Loom support, so YouTube is the conservative compatible choice.
4. Review the image previews and listen to the final video before publishing.

Suggested YouTube title: **Leið: turn a city into a song**

Suggested YouTube description:

Turn public transport routes into music in your browser. Every line becomes a track; every stop becomes a note. Choose routes, shape the sound, and export MIDI or WAV to keep creating.

Try Leið: https://www.layth.space/

The music in this demo was made in Leið. The opening is a recorded Budapest performance; the later section pairs actual Berlin product screenshots with a Berlin arrangement exported from the app. Playback uses public transport data with simulated timing, not live vehicle arrivals.

Seven cities: Budapest, Helsinki, Berlin, Prague, New York, Zürich, and Warsaw.

## Reproduce

From `_videos/launch/`:

```sh
npm run lint
node scripts/render-producthunt.mjs
# Or render only one asset class:
node scripts/render-producthunt.mjs --stills-only
node scripts/render-producthunt.mjs --videos-only
```

Editable React artwork: `_videos/launch/src/ProductHunt.tsx`.

The render script produces H.264/AAC MP4s, normalizes audio in two passes toward -16 LUFS / -1.5 dBTP, and writes measurements beside the videos. Source recordings and exported arrangements remain untouched.

Product Hunt official asset guidance: https://www.producthunt.com/launch/preparing-for-launch
