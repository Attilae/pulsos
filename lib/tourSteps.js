'use client'

import { driver } from 'driver.js'
import 'driver.js/dist/driver.css'
import { setTourStatus } from './tourState.js'

// Steps anchor to `data-tour="…"` attributes, never to class names: classes are
// styling handles that the responsive work moves and renames, and a tour that
// silently loses its anchor just skips the step. Grep `data-tour` to find them.
const TOUR_STEPS = [
  {
    element: '[data-tour="title"]',
    popover: {
      title: 'Welcome to Leið',
      description: 'A DAW that turns public transport data into music — every line is a track, every stop a note.',
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
      description: 'Mock mode replays each city\'s schedule deterministically — no live feed required.',
    },
  },
  {
    element: '[data-tour="lane"]',
    popover: {
      title: 'Each line is a track',
      description: 'New sessions start with every lane disabled — enable one to hear it and build your mix lane by lane.',
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
      description: 'A DAW that turns public transport data into music — every line is a track, every stop a note.',
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
      description: 'New sessions start silent — tap ⏻ to bring a line in, and ⋯ for its instrument, mix and notes.',
    },
  },
  {
    element: '[data-tour="transport"]',
    popover: {
      title: 'Press play',
      description: 'Mock mode replays the city\'s schedule — no live feed needed. Switch between Map and Lanes on the right.',
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

export function runProductTour({ phone = false } = {}) {
  const steps = phone ? MOBILE_TOUR_STEPS : TOUR_STEPS
  const driverObj = driver({
    showProgress: true,
    steps,
    // driver.js positions its popover against the anchor, which overflows a
    // 390px viewport for anything anchored to a header control.
    popoverClass: phone ? 'leid-tour--mobile' : undefined,
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
