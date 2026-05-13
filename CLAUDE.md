# Transit DAW — Project Context

## Concept

A web app (with potential future VST/mobile versions) that pulls real-time public transport data and visualizes + sonifies it as a DAW (Digital Audio Workstation) interface. Each transit line is a track; each station arrival triggers a note. The city becomes a generative music machine.

Inspired by: https://www.trainjazz.com/ (maps NYC subway lines to jazz instruments in real time)

---

## Data Sources

### Primary: BKK (Budapest public transport)
- Protocol: **GTFS-RT** (General Transit Feed Specification — Realtime)
- Provides: real-time vehicle positions, trip updates, service alerts
- API key: required (free, register at https://opendata.bkk.hu/)
- Docs: https://opendata.bkk.hu/

### Secondary: MÁV (Hungarian national railway)
- API: `vonat.mav-start.hu` (less formally documented, partially scrapeable)
- Use for: long-distance, slow-moving trains → sustained/ambient sounds

### Future
- GTFS-RT is a global standard → the architecture should be city-agnostic so other networks can be added later

---

## Musical Mapping Logic

### Line → Instrument (DAW Track)
| Line type         | Instrument / Sound         | Rationale                        |
|-------------------|----------------------------|----------------------------------|
| Metro (M1–M4)     | Pitched instruments        | Piano, Rhodes, synth lead, bass  |
| Trams (4, 6, 2…)  | Hi-hats / rhythmic perc    | High stop frequency = rhythm     |
| Buses             | Pads / ambient textures    | Background layer                 |
| HÉV (suburban)    | Cello / low melodic        | Slower, suburban feel            |
| MÁV (railway)     | Long sustained pads/chords | Rare triggers, wide spacing      |

### Stop → Note (Pitch Mapping)
Preferred approach: **geographic pitch mapping**
- Map the latitude of each stop to a note on a musical scale
- Further north = higher pitch
- Creates a spatially meaningful melody as trains move through the city
- Scale: pentatonic or diatonic (avoids dissonance with multiple simultaneous lines)

Alternative approaches (can be toggled):
- **Stop index**: stop 1 = root, last stop = octave (ascending/descending melody per line)
- **Direction-based**: outbound = ascending intervals, inbound = descending

### Rhythm
- No imposed beat grid — the city sets the tempo
- Busy lines (tram 4-6) = dense, fast rhythms naturally
- Rural/long-distance trains = sparse, slow events
- Arrival events are the beat; frequency IS the rhythm

---

## Tech Stack

### Frontend
- **React** — component-based UI
- **Tone.js** — Web Audio API wrapper for scheduling and playing notes
- DAW-style UI: horizontal tracks per line, note blocks appear on arrival events, transport-style controls (play/pause/volume per track)

### Backend
- **Node.js + Express** (or serverless functions)
- Proxies BKK GTFS-RT API calls (hides API key, handles CORS)
- Polls or streams real-time data and forwards to frontend via WebSocket or SSE

### Visualization
- Horizontal scrolling track lanes (one per line)
- Note blocks rendered when a train arrives at a stop
- Color-coded by line (matching BKK official colors where possible)
- Optional: map view overlay showing live train positions

---

## Project Phases

1. **Phase 1 — Musical engine prototype**: Tone.js demo with mocked/static data to validate the sound design before wiring up live data
2. **Phase 2 — BKK API integration**: real Budapest data flowing into the engine
3. **Phase 3 — DAW UI**: full visual interface with track lanes, playback controls, per-track mute/solo/volume
4. **Phase 4 — Polish**: city selector, scale selector, instrument customization
5. **Future**: VST plugin, mobile app

---

## Design Principles
- The app should feel like a DAW, not a data dashboard
- Music first — all data decisions should serve the sound
- Real-time and live — no pre-recorded or simulated data in production
- City-agnostic architecture — BKK is the first city, not the only one
