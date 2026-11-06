// Bundled per-city starter songs: public/presets/<cityId>.json, generated from
// lib/shared/cityPresetPlans.json through the real MCP composition tools by
// `npm run build:city-presets` (scripts/build_city_presets.js).
//
// They are used in three places, all through loadCityPreset():
//   • a session with nothing to restore opens on its city's preset
//     (useSongPersistence's first hydration pass),
//   • the Song menu's "Load city preset",
//   • the city picker's "Load city preset" choice when switching cities.

// Off by default while the presets are re-authored. Off, none of the three
// entry points above exists: the city picker switches directly, the Song menu
// has no preset item and an empty session starts from scratch.
export const CITY_PRESETS_ENABLED = process.env.NEXT_PUBLIC_CITY_PRESETS_ENABLED === 'true'

const cache = new Map()   // cityId → Promise<preset>

export function isValidCityPreset(preset, cityId) {
  return !!preset
    && preset.cityId === cityId
    && preset.state?.cityId === cityId
    && Array.isArray(preset.state?.routeIds)
    && preset.state.routeIds.length > 0
}

// Resolves to a fresh copy each call (applySnapshot must never share nested
// maps between two loads); rejects when the file is missing or malformed. A
// failed fetch is not cached, so a retry really retries.
export function loadCityPreset(cityId) {
  if (!cache.has(cityId)) {
    const request = fetch(`/presets/${encodeURIComponent(cityId)}.json`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`City preset unavailable (${response.status})`)
        const preset = await response.json()
        if (!isValidCityPreset(preset, cityId)) throw new Error('Invalid city preset')
        return preset
      })
    request.catch(() => cache.delete(cityId))
    cache.set(cityId, request)
  }
  return cache.get(cityId).then(preset => structuredClone(preset))
}
