// Lifecycle fix for weq8 0.2.2's <weq8-ui> element (client-only).
//
// Upstream builds its visuals in `updated()` whenever `runtime` changes: an
// FFT-8192 AnalyserNode fed from the runtime's output, a rAF loop that draws a
// 4096-point path every frame, two ResizeObservers, and a `filtersChanged`
// listener whose unsubscribe it throws away. It has no disconnectedCallback,
// so a closed rack leaves the loop drawing into a detached canvas forever, and
// every remount adds another listener to the engine-owned runtime (which
// outlives the panel). Its dispose() also only disconnects the analyser's
// *output*: the runtime → analyser edge stays, so the node keeps analysing.
//
// Rather than fork the package:
//   - installWeq8Lifecycle() wraps the element's `updated()` once, capturing the
//     listener's unsubscribe and building visuals only while the element is
//     observed and on screen;
//   - observeWeq8(el), called by the panel that mounts the element, "suspends"
//     (disposes both visuals, cuts runtime → analyser, unsubscribes) whenever
//     the element is off screen (detached, closed tab pane, scrolled away) and
//     on cleanup, and "resumes" by re-running upstream's own setup through
//     requestUpdate('runtime') once it's visible again.
// The lifecycle can't be hooked through connectedCallback/disconnectedCallback:
// custom element callbacks are captured when the element is defined, which the
// package does on import, so prototype patches made afterwards never run. Lit
// looks `updated` up on each update, so that one can be wrapped.
// Only the visual branch is touched; the runtime, its filters and its audible
// connections belong to the engine and are left exactly as they were.

const PATCHED = Symbol.for('leid.weq8LifecyclePatched')
const state = new WeakMap()   // element → { off, rt, analyser, io, visible, suspended }

// Debug counters, read by the browser regression check (window.leidWeq8Stats).
const stats = { activeVisuals: 0, listeners: 0 }

function st(el) {
  let s = state.get(el)
  if (!s) {
    s = { off: null, rt: null, analyser: null, io: null, visible: false, suspended: true }
    state.set(el, s)
  }
  return s
}

// Tear down everything upstream's updated() built. Idempotent.
function suspend(el) {
  const s = st(el)
  if (s.off) { s.off(); s.off = null; stats.listeners-- }
  if (el.analyser) {
    try { s.rt?.disconnect(el.analyser.analyser) } catch { /* edge already gone */ }
    el.analyser.dispose()
    el.analyser = undefined
  }
  el.frequencyResponse?.dispose()
  el.frequencyResponse = undefined
  if (!s.suspended) { s.suspended = true; stats.activeVisuals-- }
}

function resume(el) {
  const s = st(el)
  if (!s.suspended || !el.isConnected || !s.visible || !el.runtime) return
  // Marks `runtime` as changed so upstream's updated() rebuilds the visuals.
  el.requestUpdate('runtime', null)
}

export function installWeq8Lifecycle() {
  const Ctor = typeof customElements !== 'undefined' && customElements.get('weq8-ui')
  if (!Ctor || Ctor.prototype[PATCHED]) return
  const proto = Ctor.prototype
  proto[PATCHED] = true

  const origUpdated = proto.updated

  proto.updated = function updated(changed) {
    if (!changed.has('runtime')) return origUpdated.call(this, changed)
    const s = st(this)
    suspend(this)
    const rt = this.runtime
    // Upstream builds visuals whenever runtime changes. Skip that while we
    // can't show them; resume() re-requests the update later.
    if (!rt || !this.isConnected || !s.visible) {
      s.rt = rt
      return undefined
    }
    // Capture the filtersChanged unsubscribe upstream discards.
    const origOn = rt.on
    rt.on = function on(event, cb) {
      const off = origOn.call(this, event, cb)
      if (event === 'filtersChanged') { s.off = off; stats.listeners++ }
      return off
    }
    try {
      origUpdated.call(this, changed)
    } finally {
      delete rt.on   // drop the instance shadow, back to the prototype method
    }
    s.rt = rt
    if (this.analyser) { s.suspended = false; stats.activeVisuals++ }
    return undefined
  }

  if (typeof window !== 'undefined') window.leidWeq8Stats = stats
}

// Track `el`'s visibility and build/tear down its visuals to match. Returns the
// cleanup, which leaves the element suspended. Call installWeq8Lifecycle first.
export function observeWeq8(el) {
  const s = st(el)
  s.io?.disconnect()
  if (typeof IntersectionObserver === 'undefined') {
    s.visible = true
    resume(el)
  } else {
    // Detached elements report as not intersecting, so this also covers the
    // device rack moving the panel's DOM between columns.
    s.io = new IntersectionObserver(entries => {
      const visible = entries[entries.length - 1].isIntersecting
      if (visible === s.visible) return
      s.visible = visible
      if (visible) resume(el)
      else suspend(el)
    })
    s.io.observe(el)
  }
  return () => {
    s.io?.disconnect()
    s.io = null
    s.visible = false
    suspend(el)
  }
}
