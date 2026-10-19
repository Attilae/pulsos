'use client'

import { setTourStatus } from './tourState.js'

// The top instrument lane. Drum lanes carry no `data-tour="lane"`, so this is
// always a transit line.
const firstLane = () => document.querySelector('[data-tour="lane"]')

// The rack starts collapsed, so the tour opens the top lane's rack itself and
// closes it again when the tour ends, if it was the one that opened it.
let rackOpenedByTour = null

function openFirstRack(next) {
  const toggle = firstLane()?.querySelector('[data-tour="lane-rack"]')
  if (toggle && toggle.getAttribute('aria-expanded') !== 'true') {
    toggle.click()
    rackOpenedByTour = toggle
  }
  // Two frames: one for React to commit the rack, one for DeviceRack's
  // measured column layout, so the first card is highlighted where it lands.
  requestAnimationFrame(() => requestAnimationFrame(next))
}

function closeTourRack() {
  const toggle = rackOpenedByTour
  rackOpenedByTour = null
  if (toggle?.isConnected && toggle.getAttribute('aria-expanded') === 'true') toggle.click()
}

// Rack cards exist on every open rack, so they're looked up inside the top
// lane rather than by first match: another lane's rack may already be open.
// A card the lane doesn't show (Sends with no FX buses) gets a centred popover.
function rackStep(id, title, description) {
  return {
    element: () => firstLane()?.querySelector(`[data-tour="rack-${id}"]`),
    popover: { title, description },
  }
}

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
  // The lane-* anchors sit on every lane; driver.js resolves the first match,
  // so these steps walk through the top lane's controls.
  {
    element: '[data-tour="lane-mix"]',
    popover: {
      title: 'Mix the lane',
      description: 'Power a lane on or off, solo it (Cmd/Ctrl-click to solo several), set its volume and pan, and download it as MIDI or record it as WAV.',
    },
  },
  {
    element: '[data-tour="lane-rail"]',
    popover: {
      title: 'Stops are notes',
      description: 'Each dot is a stop, placed by pitch. Click one to change its pitch, velocity and chance of playing. Drag the edges of the rail to set the lane\'s loop.',
    },
  },
  {
    element: '[data-tour="lane-tag"]',
    popover: {
      title: 'Label it',
      description: 'Name the lane by its role, like Bass, Lead or Pad, and give it a colour.',
    },
  },
  {
    element: '[data-tour="lane-duplicate"]',
    popover: {
      title: 'Stack a chord',
      description: 'Duplicate a lane and shift the copy by a few semitones to build chords. The button beside it swaps in a different transit line while keeping the sound.',
    },
  },
  {
    element: '[data-tour="lane-automation"]',
    popover: {
      title: 'Automate',
      description: 'Add an automation lane to sweep volume, filter, FX sends and more, as a curve you drag across a line\'s stops.',
    },
  },
  {
    element: '[data-tour="lane-rack"]',
    popover: {
      title: 'Device rack',
      description: 'Every lane has a rack of devices that shape it. Press Next to open this one.',
      onNextClick: (_el, _step, { driver }) => openFirstRack(() => driver.moveNext()),
    },
  },
  rackStep('instrument', 'Instrument', 'Pick the sound source: a basic synth, FM, a poly pad, noise, a sampler with built-in or uploaded samples, or a single drum hit.'),
  rackStep('voice', 'Shape the sound', 'This card follows the instrument you picked: its envelope (attack, decay, sustain, release) and settings like oscillator, FM depth or sample set.'),
  rackStep('pitch', 'Pitch map', 'Set the root and scale, then how stops become a melody: by demand, geography, route shape, a random walk or an arch. Range keeps it within 1 to 3 octaves, Leap caps jumps between notes, and Var adds variation.'),
  rackStep('filter', 'Filter', 'Low-pass, high-pass and more. Classic is the clean filter; Analog is a ladder filter with resonance and drive.'),
  rackStep('eq', 'EQ', 'An 8-band parametric EQ. Drag the points on the curve to cut or boost frequencies.'),
  rackStep('expression', 'Expression', 'Move the lane up or down by octaves, add glide between notes, and turn on LEG to hold each note into the next.'),
  rackStep('timing', 'Timing', 'Speed plays the line faster or slower than the others, so lanes drift into polyrhythm. Grid snaps the notes, Length sets how long each one rings, Chance drops notes at random, and Loops lets the lane sit out some passes.'),
  rackStep('arp', 'Arpeggiator', 'Switch it on to turn each stop into a run of notes, with its own style, rate, octave range and gate.'),
  rackStep('granular', 'Granular', 'Switch it on to break the lane into grains for clouds, shimmer and smeared textures.'),
  rackStep('sidechain', 'Sidechain', 'Make the lane duck whenever the drums or another lane hits, for a pumping mix. Set how deep and how fast.'),
  rackStep('sends', 'Sends', 'Feed the lane into the reverb, delay and other FX buses set up in the footer.'),
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
      closeTourRack()
      const finished = state.activeIndex === steps.length - 1
      setTourStatus(finished ? 'completed' : 'skipped')
    },
  })
  driverObj.drive()
}
