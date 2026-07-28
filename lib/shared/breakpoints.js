// Single source of truth for the app's responsive breakpoints.
//
// CSS cannot read these values, so the component stylesheets repeat the literal
// pixel numbers — every media query that does carries a comment pointing back
// here. Change a number here and grep for it in components/*.css.
//
//   phone   : < 768px  — the purpose-built compact layout (components/mobile/)
//   tablet  : 768–1023 — the desktop layout with enlarged touch targets
//   desktop : ≥ 1024   — the full instrument
export const PHONE_MAX   = 767
export const TABLET_MIN  = 768
export const DESKTOP_MIN = 1024

export const MQ_PHONE   = `(max-width: ${PHONE_MAX}px)`
export const MQ_TABLET  = `(min-width: ${TABLET_MIN}px) and (max-width: ${DESKTOP_MIN - 1}px)`
export const MQ_DESKTOP = `(min-width: ${DESKTOP_MIN}px)`

// Input capability, independent of width. A coarse pointer means fingers, which
// is what the 44px tap-target floor keys off — an iPad at 1024px is still touch.
export const MQ_COARSE = '(pointer: coarse)'
export const MQ_HOVER  = '(hover: hover) and (pointer: fine)'
