# User guide

The public `/guide` route contains the beginner walkthrough and complete feature
reference. Both guest and authenticated header menus link to it in a new tab so
opening help does not interrupt a session.

Edit `components/guide/guideContent.js` for content. `UserGuide.jsx` reads the same
source for its interactive and print views. Print always includes every chapter,
even when a search or category filter is active. Interactive checklist progress
stays in this device's local storage and never affects a song.

After editing guide content or print styles:

1. Run `npm run build`, then `npm run start` (stop a running dev server before building).
2. With agent-browser installed, run `npm run guide:pdf -- http://localhost:3000`.
3. Inspect the PDF and commit the generated `public/guides/leid-user-guide.pdf`
   alongside the content. A delivery copy is also written to `output/pdf/`.

The PDF uses browser print layout, A4 pages, internal contents links and numbered
footers. It needs no account, database access or audio engine. PDF generation is
an explicit maintenance step, not part of a Vercel build.

Last content review: 20 October 2026. Compared changes since the guide's initial
release, including Poly / Pad voices and demand-driven holds, Macro envelopes,
one-loop MIDI exports, Pro custom audio, MCP setup, the expanded tour and tab-load
recovery. The page and PDF share the revision date in `GUIDE_VERSION`.
