'use client'

import { setTourStatus } from './tourState.js'
import { registerModalCompanion } from './shared/modalCompanion.js'

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
    // Highlight the row: driver.js temporarily writes aria-expanded on its
    // anchor, which would mask the rack button's actual open state.
    element: () => firstLane()?.querySelector('[data-tour="lane-rack"]')?.parentElement,
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

// Phone steps prepare their own sheets in either direction. Only UI opened by
// this tour is closed; existing sheet tabs and the previous map view are restored.
const mobileElement = id => [...document.querySelectorAll(`[data-tour="${id}"]`)].find(el => el.getClientRects().length)
const afterMobileCommit = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))

function mobileTourSession() {
  const owned = new Map(), tabs = new Map()
  let previousView = null, restoreSession = false
  const closeOwned = except => {
    for (const [id, panel] of [...owned].reverse()) {
      if (id === except) continue
      if (panel.isConnected) { tabs.get(panel)?.click(); panel.querySelector('.sheet-close')?.click() }
      owned.delete(id)
    }
  }
  const lanes = async () => {
    const button = mobileElement('mobile-lanes')
    if (button?.getAttribute('aria-selected') !== 'true') {
      previousView ??= button?.parentElement.querySelector('[aria-selected="true"]')
      button?.click()
      await afterMobileCommit()
    }
  }
  const open = async (id, trigger) => {
    if (!mobileElement(id)) {
      trigger?.click()
      await afterMobileCommit()
      const panel = mobileElement(id)
      if (panel) owned.set(id, panel)
    }
    return mobileElement(id)
  }
  return {
    lanes,
    async prepare(area) {
      if (area?.startsWith('lane:')) {
        closeOwned('mobile-lane-sheet')
        await lanes()
        const panel = await open('mobile-lane-sheet', mobileElement('mobile-lane-settings'))
        if (panel && !tabs.has(panel)) tabs.set(panel, panel.querySelector('[role="tab"][aria-selected="true"]'))
        panel?.querySelector(`[data-tour="mobile-${area.slice(5)}"]`)?.click()
      } else if (area === 'session' || area === 'mixer') {
        closeOwned('mobile-session-sheet')
        const panel = await open('mobile-session-sheet', mobileElement('mobile-session'))
        if (area === 'mixer') {
          restoreSession ||= !!panel && !owned.has('mobile-session-sheet')
          await open('mobile-mixer', mobileElement('mobile-mixer-open'))
        }
      } else closeOwned()
      await afterMobileCommit()
    },
    cleanup() {
      for (const [panel, tab] of tabs) if (panel.isConnected && tab?.isConnected) tab.click()
      closeOwned()
      if (restoreSession && !mobileElement('mobile-session-sheet')) mobileElement('mobile-session')?.click()
      if (previousView?.isConnected) previousView.click()
    },
  }
}

const MOBILE_TOUR_STEPS = [
  { anchor: 'title', title: 'Welcome to Leið', description: 'Every line is a track, every stop a note. These touch editors share the desktop audio engine.' },
  { anchor: 'tabs', title: 'Three tools', description: 'Map/DAW, Drum Machine, and Song Chainer.' },
  { anchor: 'lane', title: 'Each line is a track', description: 'New sessions start silent. Enable a lane to hear it. Open its settings for five editing sections.', requiresLane: true },
  { anchor: 'mobile-add-line', title: 'Start with a line', description: 'Add a transit line to make a track. Its stops will become notes.', emptyOnly: true },
  { anchor: 'mobile-sound', area: 'lane:sound', title: 'Tone', description: 'Choose an instrument, shape its envelope, add Texture, and map route data to pitch.', requiresLane: true },
  { anchor: 'mobile-rhythm', area: 'lane:rhythm', title: 'Rhythm', description: 'Set speed, note grid, loop window, chance and arpeggiation. Visible reset buttons work with a tap.', requiresLane: true },
  { anchor: 'mobile-mix', area: 'lane:mix', title: 'Mix', description: 'Set level, pan, filter, eight-band EQ, FX sends and sidechain ducking. Export this lane as MIDI or WAV.', requiresLane: true },
  { anchor: 'mobile-notes', area: 'lane:notes', title: 'Notes', description: 'Edit each stop’s pitch, velocity and chance in a touch-sized list.', requiresLane: true },
  { anchor: 'mobile-auto', area: 'lane:auto', title: 'Auto', description: 'Use a line’s stops to move a control. Tap or drag the curve, then use the small steps for precision. Data source lines can also play notes.', requiresLane: true },
  { anchor: 'transport', title: 'Press play', description: 'Mock mode needs no live feed. Switch between Map and Lanes here.', dockTop: true },
  { anchor: 'mobile-session-sheet', area: 'session', title: 'Session settings', description: 'Find Activity, your reference loop and its waveform, drums, exports and the AI Composer here.' },
  { anchor: 'mobile-mixer', area: 'mixer', title: 'Mixer', description: 'Add FX buses, then send lanes to them from Mix. The Master section shapes the final output.' },
  { anchor: 'menu', title: 'Save your music', description: 'Sign in for saved songs and account-stored loops. The menu also has the city picker, tour replay and sound check.' },
]

let activeTour = null
let startingTour = false

// driver.js (and its CSS) load on first tour run, not with the app: most
// sessions never start the tour after the first visit.
export async function runProductTour({ phone = false } = {}) {
  if (startingTour || activeTour?.isActive()) return
  startingTour = true
  let mobile = null, releaseCompanion = () => {}, moving = false
  try {
    const [{ driver }] = await Promise.all([import('driver.js'), import('driver.js/dist/driver.css')])
    if (phone) { mobile = mobileTourSession(); await mobile.lanes() }
    const hasLane = !!mobileElement('mobile-lane-settings')
    const descriptions = MOBILE_TOUR_STEPS.filter(step => (!step.requiresLane || hasLane) && (!step.emptyOnly || !hasLane))
    let driverObj
    const authoredAria = new Map()
    const restoreAria = except => {
      for (const [element, attributes] of authoredAria) {
        if (element === except || !element.isConnected) continue
        for (const [name, value] of attributes) {
          if (value == null) element.removeAttribute(name)
          else element.setAttribute(name, value)
        }
      }
    }
    const move = async index => {
      if (moving || !driverObj.isActive()) return
      if (index >= steps.length) { driverObj.destroy(); return }
      if (index < 0) return
      moving = true
      try {
        await mobile.prepare(descriptions[index].area)
        if (driverObj.isActive()) driverObj.moveTo(index)
      } finally { moving = false }
    }
    const steps = phone ? descriptions.map((step, index) => ({
      element: () => mobileElement(step.anchor),
      popover: {
        title: step.title, description: step.description,
        ...(step.dockTop ? { popoverClass: 'leid-tour leid-tour--mobile leid-tour--dock-top' } : {}),
        onNextClick: () => move(index + 1), onPrevClick: () => move(index - 1),
      },
    })) : TOUR_STEPS
    driverObj = driver({
      showProgress: true, steps, animate: !phone,
      popoverClass: phone ? 'leid-tour leid-tour--mobile' : 'leid-tour',
      onHighlightStarted: element => {
        if (element && !authoredAria.has(element)) authoredAria.set(element,
          ['aria-haspopup', 'aria-expanded', 'aria-controls'].map(name => [name, element.getAttribute(name)]))
      },
      onHighlighted: element => restoreAria(element),
      onPopoverRender: (popover, { state }) => {
        releaseCompanion()
        if (!phone) return
        const step = steps[state.activeIndex]
        const element = typeof step?.element === 'function' ? step.element() : null
        const panel = element?.closest('[role="dialog"]') ?? [...document.querySelectorAll('.sheet-panel')].filter(el => el.getClientRects().length).at(-1)
        releaseCompanion = panel ? registerModalCompanion(panel, popover.wrapper, () => driverObj.destroy()) : () => {}
      },
      onDestroyed: (_el, _step, { state }) => {
        releaseCompanion()
        restoreAria()
        mobile?.cleanup()
        closeTourRack()
        activeTour = null
        setTourStatus(state.activeIndex === steps.length - 1 ? 'completed' : 'skipped')
      },
    })
    activeTour = driverObj
    driverObj.drive()
  } finally { startingTour = false }
}
