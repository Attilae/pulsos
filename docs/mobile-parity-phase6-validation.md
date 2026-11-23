# Phase 6 validation: touch EQ

Validated against a production build using headless Chrome with touch enabled at 390×844,
plus 320px, 820px and 1440×900 layouts. Account, entitlement and preset endpoints used
in-memory fixtures. The EQ runtime, browser audio graph and response calculation were real.

## Automated checks

- `npm test`: 642 passed, zero failures, including the loopback feed tests.
- `npm run build`: passed.
- Pure response tests cover cascaded 24 dB sections, bypassed/unused bands, log-spaced
  frequency sampling, finite deep cuts and filter-specific control availability.

## Browser checks

- Instrument and drum Mix sheets expose eight EQ bands and all 14 supported filter types
  plus unused slots. Frequency/Q use logarithmic sliders; gain and Q availability follow
  each filter's topology. Enabling an unused slot selects an audible bell filter.
- Type, frequency, gain, Q and bypass edits reach the existing autosave mirror. Instrument
  and drum edits survive reload. Visible frequency, gain, Q and type resets restore defaults.
- Desktop weq8 receives the phone's saved state; changing its runtime updates autosave and
  appears in the phone editor. Desktop custom-element mounting remains intact.
- The real 24 dB bell response includes both cascaded sections: two sections at a stored
  gain of 6 dB produce approximately 12 dB combined at the center frequency in weq8 0.2.2.
  The touch response uses the runtime's actual section magnitudes.
- Three open/close cycles each add and release one editor `filtersChanged` listener and one
  canvas ResizeObserver. The editor never mounts weq8 UI, an analyser or an animation loop.
- Curve repaint follows theme changes. Light/dark layouts, 44px touch targets and 320px
  widths were checked. No horizontal page/editor overflow or uncaught page errors occurred.

## Audio evidence and remaining release check

Gain changes during real playback updated the same live runtime and saved state. Sound
checks measured peaks between -14.2 and -13.3 dBFS with instrument and drum lanes audible. This confirms active
signal flow, not perceived sound quality. Human listening on phone hardware remains a release check.
