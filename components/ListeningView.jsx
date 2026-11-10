'use client'

// Listening view (the Map view's "3D" style): the mix as luminous threads in a
// dark void, for watching rather than editing. It covers the street map in
// place; the 2D/3D switch in the header (phone: transport bar) toggles it. Each stop is raised to the height of the note it plays
// (one pitch scale for the whole mix, so bass lines sit low and leads high),
// the camera orbits once every six minutes, and a stop blooms when it sounds
// and fades over a couple of seconds. Inspired by nulldesign's Metrogram 3D,
// slowed right down.
//
// Deliberately separate from the editing map (MapView.jsx), whose motion rules
// (short rings, no free-running loops) stay as they are. three.js is loaded
// only when this view opens. One shared ticker (lib/shared/playheadTicker.js)
// drives it at ~30 fps; nothing here sets React state per frame.
//
// Reduced motion: the camera holds still and there are no heads or trails;
// stops still brighten and fade when they play.

import * as Tone from 'tone'
import { useEffect, useRef, useState } from 'react'
import { subscribePlayhead } from '@/lib/shared/playheadTicker.js'
import { subscribeEvents, getEvents } from '@/lib/shared/eventLogStore.js'
import { lanePlayhead, trailFracs, wrapFade } from '@/lib/mapPlayhead.js'
import {
  HEIGHT_SPAN, CURVE_STEPS, GLOW_TAU_S, LEVEL_TAU_S,
  SCENE_RADIUS, sampleCurve, curvePoint, orbitPose, decay, bloomFor, exposureFor, frameLines,
} from '@/lib/listeningScene.js'
import './ListeningView.css'

const FRAME_MS = 33              // ~30 fps, the map's ceiling
const TRAIL_BEATS = 6            // a long light-painting tail
const TRAIL_SAMPLES = 40
const IDLE_UI_MS = 3500          // controls fade after this long without input
const ORBIT_RESUME_MS = 6000     // the orbit eases back in this long after a drag

// ── Shaders ────────────────────────────────────────────────────────────────
// Screen-space ribbons: each sample is two vertices pushed apart along the
// on-screen normal, so a line has a real pixel width (WebGL lines are 1px) and
// a feathered edge. Drawn additively: overlapping lines brighten like light.
const RIBBON_VERT = /* glsl */`
  attribute vec3 prev;
  attribute vec3 next;
  attribute float side;
  attribute float along;
  uniform vec2 uRes;
  uniform float uWidth;
  uniform float uTaper;
  varying float vSide;
  varying float vAlong;
  void main() {
    mat4 m = projectionMatrix * modelViewMatrix;
    vec4 c = m * vec4(position, 1.0);
    vec4 p = m * vec4(prev, 1.0);
    vec4 n = m * vec4(next, 1.0);
    vec2 asp = vec2(uRes.x / uRes.y, 1.0);
    vec2 cs = c.xy / c.w * asp;
    vec2 ps = p.xy / p.w * asp;
    vec2 ns = n.xy / n.w * asp;
    vec2 d1 = cs - ps, d2 = ns - cs;
    vec2 dir = length(d1) < 1e-6 ? d2 : length(d2) < 1e-6 ? d1 : normalize(d1) + normalize(d2);
    dir = length(dir) < 1e-6 ? vec2(1.0, 0.0) : normalize(dir);
    vec2 normal = vec2(-dir.y, dir.x);
    normal.x /= asp.x;
    float w = uWidth * mix(1.0, along, uTaper);
    c.xy += normal * side * w / uRes.y * c.w;
    gl_Position = c;
    vSide = side;
    vAlong = along;
  }
`
const RIBBON_FRAG = /* glsl */`
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uSoft;
  uniform float uFade;
  varying float vSide;
  varying float vAlong;
  void main() {
    float a = pow(1.0 - smoothstep(0.0, 1.0, abs(vSide)), uSoft);
    a *= mix(1.0, vAlong * vAlong, uFade);
    gl_FragColor = vec4(uColor, clamp(uOpacity * a, 0.0, 1.0));
  }
`
// Soft round points (stops and heads): a tight core plus a wide halo.
const POINT_VERT = /* glsl */`
  attribute float glow;
  attribute vec3 color;
  uniform float uPx;
  uniform float uBase;
  uniform float uGain;
  varying vec3 vColor;
  varying float vGlow;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float atten = clamp(240.0 / -mv.z, 0.6, 1.7);
    gl_PointSize = (uBase + glow * uGain) * uPx * atten;
    vColor = color;
    vGlow = glow;
  }
`
const POINT_FRAG = /* glsl */`
  uniform float uRest;
  uniform float uExposure;
  varying vec3 vColor;
  varying float vGlow;
  void main() {
    vec2 q = gl_PointCoord - 0.5;
    float r2 = dot(q, q) * 4.0;
    if (r2 > 1.0) discard;
    float core = exp(-r2 * 14.0);
    float halo = exp(-r2 * 3.5) * 0.4;
    float a = (uRest + vGlow) * (core + halo) * uExposure;
    vec3 col = mix(vColor, vec3(1.0), core * vGlow * 0.6);
    gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
  }
`

// Fill a ribbon's per-vertex arrays from `pts` (xyz, flat) for `count` samples.
function fillRibbon(attr, pts, count) {
  const { position, prev, next, along } = attr
  for (let i = 0; i < count; i++) {
    const ip = Math.max(0, i - 1), inx = Math.min(count - 1, i + 1)
    for (let s = 0; s < 2; s++) {
      const v = (i * 2 + s) * 3
      for (let c = 0; c < 3; c++) {
        position[v + c] = pts[i * 3 + c]
        prev[v + c] = pts[ip * 3 + c]
        next[v + c] = pts[inx * 3 + c]
      }
      along[i * 2 + s] = count > 1 ? i / (count - 1) : 1
    }
  }
}

function makeRibbon(THREE, pts, count, material) {
  const n = count * 2
  const attr = {
    position: new Float32Array(n * 3), prev: new Float32Array(n * 3), next: new Float32Array(n * 3),
    side: new Float32Array(n), along: new Float32Array(n),
  }
  for (let i = 0; i < count; i++) { attr.side[i * 2] = -1; attr.side[i * 2 + 1] = 1 }
  if (pts) fillRibbon(attr, pts, count)
  const index = []
  for (let i = 0; i < count - 1; i++) {
    const a = i * 2
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
  }
  const geo = new THREE.BufferGeometry()
  geo.setIndex(index)
  for (const [name, arr] of Object.entries(attr)) {
    geo.setAttribute(name, new THREE.BufferAttribute(arr, name === 'side' || name === 'along' ? 1 : 3))
  }
  const mesh = new THREE.Mesh(geo, material)
  mesh.frustumCulled = false
  return { mesh, attr, geo }
}

function ribbonMaterial(THREE, color, { width, opacity, soft = 1.5, taper = 0, fade = 0 }, res) {
  return new THREE.ShaderMaterial({
    vertexShader: RIBBON_VERT, fragmentShader: RIBBON_FRAG,
    uniforms: {
      uRes: { value: res }, uWidth: { value: width }, uTaper: { value: taper },
      uColor: { value: color }, uOpacity: { value: opacity }, uSoft: { value: soft }, uFade: { value: fade },
    },
    // Both faces: a ribbon's winding follows its on-screen direction, so a
    // single-sided ribbon vanishes whole whenever it runs the "wrong" way.
    side: THREE.DoubleSide,
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
  })
}

// Route colours were picked for a light/dark basemap; in a void a dark navy
// line disappears. Lift lightness and keep the hue.
function voidColor(THREE, hex) {
  const c = new THREE.Color()
  try { c.set(hex || '#9aa4b2') } catch { c.set('#9aa4b2') }
  const hsl = {}
  c.getHSL(hsl)
  c.setHSL(hsl.h, Math.min(1, hsl.s * 1.1), Math.max(0.55, Math.min(0.7, hsl.l)))
  return c
}

export default function ListeningView({
  open, lines, lineLanes, activeRef, speedsRef, regionsRef,
  started, reduced, cityName,
}) {
  const panelRef = useRef(null)
  const canvasRef = useRef(null)
  const [idle, setIdle] = useState(false)
  const [status, setStatus] = useState('loading')   // 'loading' | 'ready' | 'error'

  const startedRef = useRef(started)
  const reducedRef = useRef(reduced)
  useEffect(() => { startedRef.current = started }, [started])
  useEffect(() => { reducedRef.current = reduced }, [reduced])
  // The orbit's clock and the user's drag offsets survive a scene rebuild (a
  // lane change), so the camera never jumps.
  const camRef = useRef({ t: 0, user: { azimuth: 0, elevation: 0, zoom: 1 }, lastInput: -Infinity, speed: 1, focus: null })

  // ── Controls fade when nobody's touching anything ──
  useEffect(() => {
    if (!open) return undefined
    let timer = 0
    const wake = () => {
      setIdle(false)
      clearTimeout(timer)
      timer = setTimeout(() => setIdle(true), IDLE_UI_MS)
    }
    wake()
    const el = panelRef.current
    el?.addEventListener('pointermove', wake)
    el?.addEventListener('pointerdown', wake)
    el?.addEventListener('keydown', wake)
    return () => {
      clearTimeout(timer)
      el?.removeEventListener('pointermove', wake)
      el?.removeEventListener('pointerdown', wake)
      el?.removeEventListener('keydown', wake)
    }
  }, [open])

  // ── The scene ──
  useEffect(() => {
    if (!open || !lines?.length) return undefined
    let disposed = false
    let cleanup = () => {}
    import('three').then((THREE) => {
      if (disposed) return
      try {
        cleanup = buildScene(THREE)
        setStatus('ready')
      } catch (err) {
        console.error('[listening]', err)
        setStatus('error')
      }
    }, (err) => { console.error('[listening]', err); if (!disposed) setStatus('error') })

    function buildScene(THREE) {
      const canvas = canvasRef.current
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' })
      renderer.setClearColor(0x000000, 0)
      const maxRatio = Math.min(window.devicePixelRatio || 1, 2)
      let ratio = Math.min(maxRatio, 1.5)
      renderer.setPixelRatio(ratio)
      const scene = new THREE.Scene()
      const camera = new THREE.PerspectiveCamera(38, 1, 1, 2000)
      const res = new THREE.Vector2(1, 1)
      const disposables = []
      const track = (x) => { disposables.push(x); return x }

      // Lines: a wide faint glow, a thin bright core, a ground shadow and
      // faint stems that tie each stop to its place on the ground.
      const lineObjs = lines.map((line) => {
        const color = voidColor(THREE, line.color)
        const curve = sampleCurve(line.stops)
        const count = curve.length / 3
        const glowMat = track(ribbonMaterial(THREE, color, { width: 14, opacity: 0.09, soft: 2.2 }, res))
        const coreMat = track(ribbonMaterial(THREE, color, { width: 2.2, opacity: 0.8, soft: 1 }, res))
        const glow = makeRibbon(THREE, curve, count, glowMat)
        const core = makeRibbon(THREE, curve, count, coreMat)
        const ground = new Float32Array(curve)
        for (let i = 1; i < ground.length; i += 3) ground[i] = 0
        const shadowMat = track(ribbonMaterial(THREE, color, { width: 1.4, opacity: 0.14, soft: 1 }, res))
        const shadow = makeRibbon(THREE, ground, count, shadowMat)
        track(glow.geo); track(core.geo); track(shadow.geo)

        const stems = new Float32Array(line.stops.length * 6)
        line.stops.forEach((s, i) => { stems.set([s.x, 0, s.z, s.x, s.y, s.z], i * 6) })
        const stemGeo = track(new THREE.BufferGeometry())
        stemGeo.setAttribute('position', new THREE.BufferAttribute(stems, 3))
        const stemMat = track(new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }))
        const stemLines = new THREE.LineSegments(stemGeo, stemMat)

        // Stops: dim at rest, bloom when they sound.
        const sp = new Float32Array(line.stops.length * 3)
        const sc = new Float32Array(line.stops.length * 3)
        line.stops.forEach((s, i) => { sp.set([s.x, s.y, s.z], i * 3); sc.set([color.r, color.g, color.b], i * 3) })
        const glowAttr = new THREE.BufferAttribute(new Float32Array(line.stops.length), 1)
        glowAttr.setUsage(THREE.DynamicDrawUsage)
        const stopGeo = track(new THREE.BufferGeometry())
        stopGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3))
        stopGeo.setAttribute('color', new THREE.BufferAttribute(sc, 3))
        stopGeo.setAttribute('glow', glowAttr)
        const stopMat = track(new THREE.ShaderMaterial({
          vertexShader: POINT_VERT, fragmentShader: POINT_FRAG,
          uniforms: { uPx: { value: ratio }, uBase: { value: 4 }, uGain: { value: 30 }, uRest: { value: 0.35 }, uExposure: { value: 1 } },
          transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
        }))
        const stopPoints = new THREE.Points(stopGeo, stopMat)
        stopPoints.frustumCulled = false

        // Head + trail, hidden until playing.
        const trailMat = track(ribbonMaterial(THREE, color, { width: 6, opacity: 0.55, soft: 1.6, taper: 1, fade: 1 }, res))
        const trail = makeRibbon(THREE, null, TRAIL_SAMPLES + 1, trailMat)
        track(trail.geo)
        trail.geo.attributes.position.setUsage(THREE.DynamicDrawUsage)
        const headGeo = track(new THREE.BufferGeometry())
        headGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3))
        headGeo.setAttribute('color', new THREE.BufferAttribute(Float32Array.of(color.r, color.g, color.b), 3))
        headGeo.setAttribute('glow', new THREE.BufferAttribute(Float32Array.of(0.5), 1))
        const headMat = track(new THREE.ShaderMaterial({
          vertexShader: POINT_VERT, fragmentShader: POINT_FRAG,
          uniforms: { uPx: { value: ratio }, uBase: { value: 4 }, uGain: { value: 22 }, uRest: { value: 0 }, uExposure: { value: 0 } },
          transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
        }))
        const head = new THREE.Points(headGeo, headMat)
        head.frustumCulled = false

        const group = new THREE.Group()
        group.add(shadow.mesh, stemLines, glow.mesh, core.mesh, trail.mesh, stopPoints, head)
        scene.add(group)
        return {
          line, curve, glowMat, coreMat, shadowMat, stemMat, stopMat, trailMat, headMat, trail, head, headGeo,
          glowAttr, glows: new Float32Array(line.stops.length),
          stopIndex: new Map(line.stops.map((s, i) => [s.id, i])),
          level: 0,   // eased audible/off brightness
        }
      })
      const byLine = new Map(lineObjs.map(o => [o.line.id, o]))
      // Console diagnostics, like window.leidMapFx on the map.
      window.leidListen = {
        stats: () => ({ lines: lineObjs.length, ratio, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, programs: renderer.info.programs?.length }),
        _debug: { renderer, scene, camera, lineObjs },
      }

      // ── Sizing ──
      const resize = () => {
        // The overlay's box, not the canvas's: if the canvas were ever sized by
        // its own attributes, measuring it would feed back into every resize.
        const box = canvas.parentElement
        const w = Math.min(box?.clientWidth || 1, 4096), h = Math.min(box?.clientHeight || 1, 4096)
        renderer.setSize(w, h, false)
        camera.aspect = w / h
        camera.updateProjectionMatrix()
        res.set(w, h)
      }
      resize()
      const ro = new ResizeObserver(resize)
      ro.observe(canvas.parentElement ?? canvas)

      // ── Loudness: a tap on the destination, heavily smoothed ──
      let analyser = null, tapFrom = null, buf = null
      try {
        const raw = Tone.getContext().rawContext
        analyser = raw.createAnalyser()
        analyser.fftSize = 1024
        buf = new Float32Array(analyser.fftSize)
        tapFrom = Tone.getDestination().output
        Tone.connect(tapFrom, analyser)
      } catch { analyser = null }
      let level = 0

      // ── Notes → blooms, landing on their beat (notes are scheduled lookAhead early) ──
      const pending = []
      let lastSeq = getEvents()[0]?.seq ?? 0
      const unsubEvents = subscribeEvents(() => {
        const evs = getEvents()
        const lookMs = (Tone.getContext().lookAhead ?? 0.1) * 1000
        const now = performance.now()
        for (const ev of evs) {
          if (ev.seq <= lastSeq) break
          if (ev.stopId == null) continue
          const lineId = byLine.has(ev.routeId) ? ev.routeId : lineLanes.get(ev.routeId)
          const obj = byLine.get(lineId)
          const idx = obj?.stopIndex.get(ev.stopId)
          if (idx == null) continue
          if (pending.length < 256) pending.push({ at: now + lookMs, obj, idx, amount: bloomFor(ev.velocity) })
        }
        lastSeq = evs[0]?.seq ?? lastSeq
      })

      // ── Drag to turn, wheel to zoom; the orbit eases back in afterwards ──
      const cam = camRef.current
      let drag = null
      const onDown = (e) => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture?.(e.pointerId); cam.lastInput = performance.now() }
      const onMove = (e) => {
        if (!drag) return
        cam.user.azimuth -= (e.clientX - drag.x) * 0.005
        cam.user.elevation = Math.max(-0.5, Math.min(0.7, cam.user.elevation + (e.clientY - drag.y) * 0.004))
        drag = { x: e.clientX, y: e.clientY }
        cam.lastInput = performance.now()
      }
      const onUp = () => { drag = null }
      const onWheel = (e) => {
        e.preventDefault()
        cam.user.zoom = Math.max(0.45, Math.min(1.8, cam.user.zoom * Math.exp(e.deltaY * 0.001)))
        cam.lastInput = performance.now()
      }
      canvas.addEventListener('pointerdown', onDown)
      canvas.addEventListener('pointermove', onMove)
      canvas.addEventListener('pointerup', onUp)
      canvas.addEventListener('pointercancel', onUp)
      canvas.addEventListener('wheel', onWheel, { passive: false })

      // ── Frame ──
      const tmp = [0, 0, 0]
      const trailPts = new Float32Array((TRAIL_SAMPLES + 1) * 3)
      let last = 0, prevNow = 0, statT = 0, statFrames = 0, statSum = 0
      const unsubFrame = subscribePlayhead((now) => {
        if (now - last < FRAME_MS) return
        const dt = prevNow ? Math.min(0.25, (now - prevNow) / 1000) : 0
        prevNow = now
        last = now
        const reducedNow = reducedRef.current
        const playing = startedRef.current

        // Adaptive resolution, like the koi pond: back off on a struggling machine.
        statSum += dt; statFrames++
        if (now - statT > 2500 && statFrames > 10) {
          const avg = (statSum / statFrames) * 1000
          const nextRatio = avg > 48 ? Math.max(0.75, ratio * 0.85) : avg < 36 ? Math.min(maxRatio, ratio * 1.08) : ratio
          if (Math.abs(nextRatio - ratio) > 0.01) {
            ratio = nextRatio
            renderer.setPixelRatio(ratio)
            resize()
            for (const o of lineObjs) { o.stopMat.uniforms.uPx.value = ratio; o.headMat.uniforms.uPx.value = ratio }
          }
          statT = now; statFrames = 0; statSum = 0
        }

        // Camera.
        const since = now - cam.lastInput
        const targetSpeed = reducedNow ? 0 : since < ORBIT_RESUME_MS ? 0 : 1
        cam.speed += (targetSpeed - cam.speed) * Math.min(1, dt / 2.5)
        cam.t += dt * cam.speed
        // Frame the audible lines; glide (not cut) when lanes come and go.
        const active = activeRef.current
        const goal = frameLines(lineObjs.filter(o => active?.has(o.line.id)).map(o => o.line))
          ?? frameLines(lines) ?? { x: 0, z: 0, r: SCENE_RADIUS }
        if (!cam.focus) cam.focus = { ...goal }
        const k = Math.min(1, dt / 2.5)
        cam.focus.x += (goal.x - cam.focus.x) * k
        cam.focus.z += (goal.z - cam.focus.z) * k
        cam.focus.r += (goal.r - cam.focus.r) * k
        const pose = orbitPose(reducedNow ? 0 : cam.t, cam.user)
        const dist = pose.distance * Math.max(0.3, (cam.focus.r * 1.1) / SCENE_RADIUS)
        const ce = Math.cos(pose.elevation)
        camera.position.set(
          cam.focus.x + dist * ce * Math.sin(pose.azimuth),
          dist * Math.sin(pose.elevation) + HEIGHT_SPAN * 0.4,
          cam.focus.z + dist * ce * Math.cos(pose.azimuth),
        )
        camera.lookAt(cam.focus.x, HEIGHT_SPAN * 0.4, cam.focus.z)

        // Loudness → light.
        if (analyser) {
          analyser.getFloatTimeDomainData(buf)
          let sum = 0
          for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
          const rms = Math.sqrt(sum / buf.length)
          level += (rms - level) * Math.min(1, dt / LEVEL_TAU_S)
        }
        const exposure = playing ? exposureFor(level) : 0.8

        // Due blooms.
        for (let i = pending.length - 1; i >= 0; i--) {
          const p = pending[i]
          if (p.at > now) continue
          p.obj.glows[p.idx] = Math.max(p.obj.glows[p.idx], p.amount)
          pending.splice(i, 1)
        }

        const transport = Tone.getTransport()
        const beats = transport.ticks / (transport.PPQ || 192)
        for (const o of lineObjs) {
          const on = active?.has(o.line.id) ? 1 : 0
          o.level += (on - o.level) * Math.min(1, dt / 0.8)
          const lv = 0.12 + 0.88 * o.level
          o.coreMat.uniforms.uOpacity.value = 0.8 * lv * exposure
          o.glowMat.uniforms.uOpacity.value = 0.09 * lv * exposure
          o.shadowMat.uniforms.uOpacity.value = 0.14 * lv
          o.stemMat.opacity = 0.07 * lv
          o.stopMat.uniforms.uExposure.value = lv * exposure

          // Blooms fade slowly.
          const g = o.glows
          for (let i = 0; i < g.length; i++) {
            g[i] = g[i] < 0.002 ? 0 : decay(g[i], dt, GLOW_TAU_S)
            o.glowAttr.array[i] = g[i]
          }
          o.glowAttr.needsUpdate = true

          // Head and trail: dim on purpose, so the eye follows the blooms.
          const showHead = playing && on && !reducedNow
          if (!showHead) {
            o.headMat.uniforms.uExposure.value = 0
            o.trailMat.uniforms.uOpacity.value = 0
            continue
          }
          const timing = { beats, speed: speedsRef.current?.[o.line.id] ?? 1, region: regionsRef.current?.[o.line.id] }
          const { frac, phase } = lanePlayhead(timing)
          const fade = wrapFade(phase)
          const hp = curvePoint(o.line, o.curve, frac, CURVE_STEPS, tmp)
          if (!hp) continue
          const pos = o.headGeo.attributes.position
          pos.array[0] = hp[0]; pos.array[1] = hp[1]; pos.array[2] = hp[2]
          pos.needsUpdate = true
          o.headMat.uniforms.uExposure.value = 0.55 * fade * exposure
          const fracs = trailFracs({ ...timing, trailBeats: TRAIL_BEATS, samples: TRAIL_SAMPLES })
          const n = fracs.length
          for (let i = 0; i < TRAIL_SAMPLES + 1; i++) {
            const p = curvePoint(o.line, o.curve, fracs[Math.min(i, n - 1)], CURVE_STEPS, tmp)
            trailPts[i * 3] = p[0]; trailPts[i * 3 + 1] = p[1]; trailPts[i * 3 + 2] = p[2]
          }
          fillRibbon(o.trail.attr, trailPts, TRAIL_SAMPLES + 1)
          for (const name of ['position', 'prev', 'next']) o.trail.geo.attributes[name].needsUpdate = true
          o.trailMat.uniforms.uOpacity.value = 0.5 * fade * exposure
        }

        renderer.render(scene, camera)
      })

      return () => {
        unsubFrame()
        unsubEvents()
        ro.disconnect()
        canvas.removeEventListener('pointerdown', onDown)
        canvas.removeEventListener('pointermove', onMove)
        canvas.removeEventListener('pointerup', onUp)
        canvas.removeEventListener('pointercancel', onUp)
        canvas.removeEventListener('wheel', onWheel)
        if (analyser && tapFrom) { try { Tone.disconnect(tapFrom, analyser) } catch { /* already gone */ } }
        for (const d of disposables) d.dispose?.()
        renderer.dispose()
        renderer.forceContextLoss?.()
      }
    }

    return () => { disposed = true; cleanup() }
  }, [open, lines, lineLanes, activeRef, speedsRef, regionsRef])

  if (!open) return null
  const empty = !lines?.length
  return (
    <section
      ref={panelRef}
      className={`listening${idle ? ' listening--idle' : ''}`}
      aria-labelledby="listening-title"
    >
      <canvas ref={canvasRef} className="listening-canvas" aria-hidden="true" />
      <div className="listening-chrome">
        <div className="listening-title">
          <h2 id="listening-title">Listening</h2>
          {cityName && <span>{cityName}</span>}
        </div>
      </div>
      {(empty || status === 'error' || !started) && (
        <p className="listening-hint" role="status">
          {empty ? 'Add a lane to see it here.'
            : status === 'error' ? 'This view needs WebGL, which isn’t available here.'
              : 'Press Play to hear the city. Drag to turn, scroll to zoom.'}
        </p>
      )}
    </section>
  )
}
