import { useCitySelection } from '@/lib/shared/CityContext.jsx'

// Compact city picker for the top nav. Switching cities reloads route data and
// resets the working session (see MixerTab). Live mode availability depends on
// the selected city having a configured feed.
export default function CitySelect() {
  const { cityId, setCityId, cities } = useCitySelection()

  return (
    <label className="city-select" title="Choose city">
      <span className="city-select-icon" aria-hidden="true">◎</span>
      <select
        className="city-select-input"
        value={cityId}
        onChange={(e) => setCityId(e.target.value)}
      >
        {cities.map(c => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
    </label>
  )
}
