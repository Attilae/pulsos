'use client'

import { driver } from 'driver.js'
import 'driver.js/dist/driver.css'
import { setTourStatus } from './tourState.js'

const TOUR_STEPS = [
  {
    element: '.app-title',
    popover: {
      title: 'Welcome to Leið',
      description: 'A DAW that turns live public transport into music — every line is a track, every arrival a note.',
    },
  },
  {
    element: '.tab-bar-tabs',
    popover: {
      title: 'Six tools',
      description: 'Map/DAW, Drum Machine, Loop Capturer, Headphone, Motif, and Song Chainer. This tour covers the main DAW.',
    },
  },
  {
    element: '.city-select',
    popover: {
      title: 'Pick a city',
      description: "Choose whose live transit becomes music. Some cities are mock-only until a live feed is wired up.",
    },
  },
  {
    element: '.view-toggle',
    popover: {
      title: 'Map or DAW view',
      description: 'Switch between the live map and the DAW\'s track lanes.',
    },
  },
  {
    element: '.transport-btn',
    popover: {
      title: 'Press play',
      description: 'Mock mode replays each city\'s schedule deterministically — no live feed required.',
    },
  },
  {
    element: '.line-track',
    popover: {
      title: 'Each line is a track',
      description: 'New sessions start with every lane disabled — enable one to hear it and build your mix lane by lane.',
    },
  },
  {
    element: '.daw-footer',
    popover: {
      title: 'FX & master',
      description: 'Add reverb, delay, and other FX buses here, and control the master output.',
    },
  },
  {
    element: '.auth-control',
    popover: {
      title: 'Sign in to save',
      description: 'Sign in to save songs, chain them into compositions, and export MIDI/WAV.',
    },
  },
]

export function runProductTour() {
  const driverObj = driver({
    showProgress: true,
    steps: TOUR_STEPS,
    // driver.js resets its internal state before invoking onDestroyed, so
    // driverObj.isLastStep() always reads false here — use the pre-reset
    // state snapshot passed into the hook instead.
    onDestroyed: (_el, _step, { state }) => {
      const finished = state.activeIndex === TOUR_STEPS.length - 1
      setTourStatus(finished ? 'completed' : 'skipped')
    },
  })
  driverObj.drive()
}
