'use client'

// Media-query hooks for the handful of places where the component *tree* differs
// between phone and desktop (everything that is only sizing/stacking belongs in
// CSS — see components/mobile.css).
//
// useSyncExternalStore, not useState+useEffect: an effect-based hook renders the
// desktop tree for one frame before correcting, and on a phone that frame
// horizontally scrolls the body and re-lays-out the whole DAW. The store reads
// matchMedia synchronously on the client and returns false during SSR, which is
// safe because the DAW is client-only (`ssr: false` in app/page.jsx).
import { useSyncExternalStore } from 'react'
import { MQ_PHONE, MQ_TABLET, MQ_COARSE, MQ_HOVER } from './breakpoints.js'

// One MediaQueryList per query string, shared by every subscriber.
const lists = new Map()

function getList(query) {
  if (typeof window === 'undefined' || !window.matchMedia) return null
  let mql = lists.get(query)
  if (!mql) { mql = window.matchMedia(query); lists.set(query, mql) }
  return mql
}

// Cached per query: useSyncExternalStore re-subscribes whenever the subscribe
// function's identity changes, so building a fresh closure each render would
// tear down and re-add a listener on every commit.
const subscribers = new Map()
const snapshotters = new Map()

function subscriberFor(query) {
  let fn = subscribers.get(query)
  if (!fn) {
    fn = (onChange) => {
      const mql = getList(query)
      if (!mql) return () => {}
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    }
    subscribers.set(query, fn)
  }
  return fn
}

function snapshotterFor(query) {
  let fn = snapshotters.get(query)
  if (!fn) {
    fn = () => getList(query)?.matches ?? false
    snapshotters.set(query, fn)
  }
  return fn
}

const serverSnapshot = () => false

export function useMediaQuery(query) {
  return useSyncExternalStore(subscriberFor(query), snapshotterFor(query), serverSnapshot)
}

/** Below 768px — render the compact phone tree. */
export function useIsPhone()  { return useMediaQuery(MQ_PHONE) }
/** 768–1023px — desktop layout, enlarged targets. */
export function useIsTablet() { return useMediaQuery(MQ_TABLET) }
/** Finger input at any width — drives touch affordances, not layout. */
export function useIsCoarse() { return useMediaQuery(MQ_COARSE) }
/** True hover capability — for JS that mirrors a `@media (hover: hover)` rule. */
export function useCanHover() { return useMediaQuery(MQ_HOVER) }
