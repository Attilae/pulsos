'use client'

import { setTourStatus } from './tourState.js'

// Steps anchor to `data-tour="…"` attributes, never to class names: classes are
// styling handles that the responsive work moves and renames, and a tour that
// silently loses its anchor just skips the step. Grep `data-tour` to find them.
const TOUR_STEPS = [
  {
    element: '[data-tour="title"]',
    popover: {
      title: 'Welcome to Leið',
      description: 'A DAW that turns public transport data into music: every line is a track, every stop a note.',
    },
  },
  {
    element: '[data-tour="tabs"]',
    popover: {
      title: 'Three tools',
      description: 'Map/DAW, Drum Machine, and Song Chainer. This tour covers the main DAW.',
    },
  },
  {
    element: '[data-tour="city"]',
    popover: {
      title: 'Pick a city',
      description: 'Choose which city network becomes music.',
    },
  },
  {
    element: '[data-tour="view"]',
    popover: {
      title: 'Map or DAW view',
      description: 'Switch between the interactive map and the DAW\'s track lanes.',
    },
  },
  {
    element: '[data-tour="transport"]',
    popover: {
      title: 'Press play',
      description: 'Mock mode replays each city\'s schedule deterministically, so no live feed is required.',
    },
  },
  {
    element: '[data-tour="lane"]',
    popover: {
      title: 'Each line is a track',
      description: 'New sessions start with every lane disabled. Enable one to hear it and build your mix lane by lane.',
    },
  },
  {
    element: '[data-tour="footer"]',
    popover: {
      title: 'FX & master',
      description: 'Add reverb, delay, and other FX buses here, and control the master output.',
    },
  },
  {
    element: '[data-tour="menu"]',
    popover: {
      title: 'Sign in to save',
      description: 'Sign in to save songs, chain them into compositions, and export MIDI/WAV.',
    },
  },
]

// The phone layout has no view toggle in the header, no FX footer and no
// desktop lane, so half the desktop steps have no anchor. This is a shorter
// tour over the controls that actually exist there.
const MOBILE_TOUR_STEPS = [
  {
    element: '[data-tour="title"]',
    popover: {
      title: 'Welcome to Leið',
      description: 'A DAW that turns public transport data into music: every line is a track, every stop a note.',
    },
  },
  {
    element: '[data-tour="tabs"]',
    popover: {
      title: 'Three tools',
      description: 'Map/DAW, Drum Machine, and Song Chainer.',
    },
  },
  {
    element: '[data-tour="lane"]',
    popover: {
      title: 'Each line is a track',
      description: 'New sessions start silent. Tap a line\'s power button to bring it in, and its more button for instrument, mix and notes.',
    },
  },
  {
    element: '[data-tour="transport"]',
    popover: {
      title: 'Press play',
      description: 'Mock mode replays the city\'s schedule, so no live feed is needed. Switch between Map and Lanes on the right.',
      // The transport bar is the bottom edge, where the card normally docks.
      popoverClass: 'leid-tour leid-tour--mobile leid-tour--dock-top',
    },
  },
  {
    element: '[data-tour="menu"]',
    popover: {
      title: 'City, theme, account',
      description: 'The menu holds the city picker, your saved songs, and the sound check if you can\'t hear anything.',
    },
  },
]

// driver.js (and its CSS) load on first tour run, not with the app: most
// sessions never start the tour after the first visit.
export async function runProductTour({ phone = false } = {}) {
  const [{ driver }] = await Promise.all([
    import('driver.js'),
    import('driver.js/dist/driver.css'),
  ])
  const steps = phone ? MOBILE_TOUR_STEPS : TOUR_STEPS
  const driverObj = driver({
    showProgress: true,
    steps,
    // On a phone the popover is docked to a screen edge (mobile.css), not
    // placed against its anchor: driver.js's side/align maths puts it off
    // screen for edge anchors like the title. A step's own popoverClass
    // replaces this one, so a step that docks elsewhere repeats the base class.
    popoverClass: phone ? 'leid-tour leid-tour--mobile' : 'leid-tour',
    // driver.js resets its internal state before invoking onDestroyed, so
    // driverObj.isLastStep() always reads false here — use the pre-reset
    // state snapshot passed into the hook instead.
    onDestroyed: (_el, _step, { state }) => {
      const finished = state.activeIndex === steps.length - 1
      setTourStatus(finished ? 'completed' : 'skipped')
    },
  })
  driverObj.drive()
}
