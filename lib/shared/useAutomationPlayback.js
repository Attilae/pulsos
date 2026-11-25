'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as Tone from 'tone'
import { subscribePlayhead } from './playheadTicker.js'
import { automationPoints, automationPlayPosition, activeAutomationPoint } from '../automationPoints.js'
import { findTargetSpec } from '../engine.js'
import { polyTargetActive } from '../soundSpecs.js'
import { filterTargetActive } from '../laneFilterSpec.js'
import { textureTargetActive } from '../granularEngine.js'
import { isToggleTarget, toggleStateAtPhase, toggleWindow, deviceManualOn, normalizeToggleSteps } from '../toggleAutomation.js'

// One ticker subscriber for the open lane, independent of the selected segment.
// DOM moves each frame; React only receives changed stop values.
// Device on/off lanes (lib/toggleAutomation.js) have no points: their state is
// read from the destination lane's own loop (`laneRegion`, `laneSpeed`), falling
// back to the device's manual setting (`devices`: { arp, granular, sidechain }).
export function useAutomationPlayback({ lanes, routes, regions, resolutions, started, active, synthType, adsr, filter, granular,
  laneRegion, laneSpeed = 1, devices }) {
  const [live, setLive] = useState({})
  const visuals = useRef(new Map())
  const arpOn = !!devices?.arp?.enabled, grainOn = !!devices?.granular?.enabled, scOn = !!devices?.sidechain?.enabled
  const runs = useMemo(() => Object.entries(lanes ?? {}).map(([id, cfg]) => isToggleTarget(cfg.paramTarget)
    ? { id, cfg, toggle: true, steps: normalizeToggleSteps(cfg.steps), region: toggleWindow(laneRegion),
        manual: deviceManualOn(cfg.paramTarget, { arp: { enabled: arpOn }, granular: { enabled: grainOn }, sidechain: { enabled: scOn } }) }
    : {
      id, cfg, region: cfg.loopRegion ?? regions?.[cfg.sourceRouteId],
      points: automationPoints(routes?.find(r => r.id === cfg.sourceRouteId), id, cfg.points, resolutions?.[cfg.sourceRouteId]),
    }), [lanes, routes, regions, resolutions, laneRegion, arpOn, grainOn, scOn])
  useEffect(() => {
    setLive({})
    const clear = () => {
      for (const v of visuals.current.values()) {
        if (v.needle) v.needle.hidden = true
        for (const dot of v.dots) dot.removeAttribute('data-active')
      }
    }
    if (!started || !active || !runs.some(run => run.toggle || (run.cfg.sourceRouteId && run.points.length))) { clear(); return }
    const last = new Map(), lastIndex = new Map()
    const unsubscribe = subscribePlayhead(() => {
      const t = Tone.getTransport(), bpm = t.bpm.value || 120
      for (const run of runs) {
        if (run.toggle) {
          const { startCell, endCell } = run.region
          const loopSec = ((endCell - startCell) / 64) * ((16 / bpm) * 60) / (laneSpeed || 1)
          const phase = loopSec > 0 ? ((t.seconds % loopSec) + loopSec) % loopSec / loopSec : 0
          const value = toggleStateAtPhase(run.steps, phase, run.region, run.manual) ? 1 : 0
          if (last.get(run.id) === value) continue
          last.set(run.id, value)
          setLive(prev => ({ ...prev, [run.id]: { paramTarget: run.cfg.paramTarget, value } }))
          continue
        }
        if (!run.cfg.sourceRouteId) continue
        const position = automationPlayPosition(t.seconds, bpm, run.cfg.speed, run.region)
        const current = activeAutomationPoint(run.points, position, run.region)
        const index = current >= 0 ? current : (lastIndex.get(run.id) ?? -1)
        if (current >= 0) lastIndex.set(run.id, current)
        const point = run.points[index]
        const view = visuals.current.get(run.id)
        if (view?.needle) { view.needle.hidden = false; view.needle.style.transform = `translateX(${position}%)` }
        if (view && view.last !== index) {
          view.dots.forEach(dot => dot.toggleAttribute('data-active', dot.dataset.stopId === point?.id))
          view.last = index
        }
        const value = point?.value ?? null
        if (last.has(run.id) && last.get(run.id) === value) continue
        last.set(run.id, value)
        setLive(prev => ({ ...prev, [run.id]: { paramTarget: run.cfg.paramTarget, value } }))
      }
    })
    return () => { unsubscribe(); clear() }
  }, [runs, started, active, laneSpeed])
  const targets = {}
  for (const [id, cfg] of Object.entries(lanes ?? {})) {
    if ((!cfg.sourceRouteId && !isToggleTarget(cfg.paramTarget)) || !polyTargetActive(cfg.paramTarget, synthType, adsr)
      || !filterTargetActive(cfg.paramTarget, filter) || !textureTargetActive(cfg.paramTarget, granular)) continue
    targets[cfg.paramTarget] = { spec: findTargetSpec(cfg.paramTarget, synthType), value: started && active && live[id]?.paramTarget === cfg.paramTarget ? live[id].value : null }
  }
  return { targets, visuals }
}
