// GTFS route_type → DAW line type.
//
// Handles both the standard small-integer codes (0..12) and the extended
// HVT codes (100..1700) that many non-US agencies use. Output is one of the
// engine's five line types — metro | tram | trolley | bus | hev — so adding a
// city never requires new synth wiring. Rail/suburban collapse to `hev`
// (sustained pads / cello), ferries to `bus` (pads/textures).
//
// ⚠️ Mirrored in `lib/routeTypes.js`. This service deploys standalone and can't
// import from lib/, so the copy lives here. Change both copies together.

const LINE_TYPES = ['metro', 'tram', 'trolley', 'bus', 'hev']

// Standard GTFS route_type (0..12)
const STANDARD = {
  0:  'tram',    // Tram / streetcar / light rail
  1:  'metro',   // Subway / metro
  2:  'hev',     // Rail (intercity / suburban) → sustained pad voice
  3:  'bus',     // Bus
  4:  'bus',     // Ferry → textural pads (no dedicated ferry voice yet)
  5:  'tram',    // Cable tram
  6:  'metro',   // Aerial lift → treat as metro-ish lead
  7:  'tram',    // Funicular
  11: 'trolley', // Trolleybus
  12: 'metro',   // Monorail
}

// Extended (HVT) codes, bucketed by leading digits (Math.floor(type / 100))
const EXTENDED = {
  1:  'hev',     // 100s Railway (109 = suburban / S-Bahn / HÉV-equivalent)
  2:  'bus',     // 200s Coach
  4:  'metro',   // 400s Urban railway / metro / underground
  5:  'metro',   // 500s Metro
  6:  'metro',   // 600s Underground
  7:  'bus',     // 700s Bus
  8:  'trolley', // 800  Trolleybus
  9:  'tram',    // 900s Tram
  10: 'bus',     // 1000s Water transport / ferry → pads
  11: 'bus',     // 1100s Air
  12: 'bus',     // 1200s Ferry → pads
  13: 'metro',   // 1300s Aerial lift
  14: 'tram',    // 1400s Funicular
}

// Resolve a GTFS route_type to a DAW line type. `overrides` is an optional
// per-city map of exact route_type → lineType for agencies that deviate.
export function routeTypeToLineType(routeType, overrides = null) {
  const t = Number(routeType)
  if (Number.isNaN(t)) return 'bus'
  if (overrides && overrides[t] != null) return overrides[t]
  if (t < 100) return STANDARD[t] ?? 'bus'
  return EXTENDED[Math.floor(t / 100)] ?? 'bus'
}

export { LINE_TYPES }
