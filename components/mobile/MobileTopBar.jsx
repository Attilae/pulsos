// City · song · overflow. 44px, and that's the entire phone chrome above the
// stage — the desktop equivalent is an 11-control sticky row that wraps to six.
'use client'

export default function MobileTopBar({ cityName, songName, onSong, onMore, harmonyMixed }) {
  return (
    <header className="mtopbar">
      <span className="mtopbar-city" title={cityName}>{cityName}</span>

      <button type="button" className="mtopbar-song" onClick={onSong}>
        <span className="mtopbar-song-name">{songName}</span>
        <span aria-hidden="true">▾</span>
      </button>

      <button type="button" className="mtopbar-more" onClick={onMore} aria-label="Session settings">
        ⋯
        {/* Desktop spells out "● Mixed" next to the harmony selects; here the
            same fact is a dot on the button that reveals them. */}
        {harmonyMixed && <span className="mtopbar-dot" aria-label="Lanes use different keys" />}
      </button>
    </header>
  )
}
