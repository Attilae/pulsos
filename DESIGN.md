---
name: Leið
description: A web DAW that plays a city's public transport as music.
colors:
  signal-lime: "#b6d94c"
  signal-lime-deep: "#5c7a1a"
  night-ink: "#0e0f11"
  platform-slate: "#17181b"
  carriage-slate: "#202226"
  tunnel-black: "#0a0a0b"
  rail-line: "#282b30"
  rail-line-strong: "#34383f"
  timetable-white: "#eef0f3"
  schedule-grey: "#a4abb6"
  muted-grey: "#868d99"
  quiet-line: "#6b7280"
  alarm-red: "#e5534b"
  amber-lamp: "#e2a53b"
  go-green: "#4caf7d"
  route-blue: "#5ab0e6"
typography:
  display:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.4rem"
    fontWeight: 700
    lineHeight: 1.15
  headline:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.15rem"
    fontWeight: 700
    lineHeight: 1.2
  title:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.86rem"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.78rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.62rem"
    fontWeight: 600
    letterSpacing: "0.12em"
  readout:
    fontFamily: "JetBrains Mono, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "0.72rem"
    fontWeight: 400
rounded:
  sm: "3px"
  md: "6px"
  lg: "8px"
  pill: "999px"
spacing:
  "025": "2px"
  "050": "4px"
  "075": "6px"
  "100": "8px"
  "150": "12px"
  "200": "16px"
  "300": "24px"
  "400": "32px"
  "600": "48px"
components:
  button-transport-play:
    backgroundColor: "{colors.carriage-slate}"
    textColor: "{colors.signal-lime}"
    rounded: "{rounded.sm}"
    padding: "7px 20px"
  button-transport-stop:
    backgroundColor: "{colors.carriage-slate}"
    textColor: "{colors.alarm-red}"
    rounded: "{rounded.sm}"
    padding: "7px 20px"
  button-secondary:
    backgroundColor: "{colors.carriage-slate}"
    textColor: "{colors.timetable-white}"
    rounded: "{rounded.sm}"
    padding: "7px 16px"
  button-secondary-hover:
    backgroundColor: "{colors.rail-line}"
  segment:
    backgroundColor: "{colors.carriage-slate}"
    textColor: "{colors.muted-grey}"
    padding: "5px 14px"
  segment-active:
    backgroundColor: "{colors.rail-line}"
    textColor: "{colors.signal-lime}"
  chip:
    backgroundColor: "{colors.night-ink}"
    textColor: "{colors.muted-grey}"
    rounded: "{rounded.pill}"
    padding: "3px 10px"
  chip-active:
    backgroundColor: "{colors.carriage-slate}"
    textColor: "{colors.timetable-white}"
  input:
    backgroundColor: "{colors.carriage-slate}"
    textColor: "{colors.timetable-white}"
    rounded: "{rounded.sm}"
    padding: "4px 6px"
  rack-card:
    backgroundColor: "{colors.carriage-slate}"
    rounded: "5px"
    padding: "8px 10px 10px"
---

# Design System: Leið

## Overview

**Creative North Star: "The Night Timetable"**

Leið is a departures board after dark that you can play. The surfaces are the
low, cool greys of a station at night; the information on them is set with
timetable precision; and there is one signal colour, a desaturated lime, that
behaves like a platform indicator: it tells you what is live, selected or
about to happen, and nothing else. Transit lines bring their own colours into
the lanes, the way a network map does, and those colours are data, not
decoration.

It is an instrument first. Density is high and controls are small, because a
mix of twelve lanes has to fit on a laptop screen, but hierarchy comes from
tone and position rather than size: lanes and their melodic lines carry the
eye, controls step back until they are touched. It should feel like a DAW
(Ableton, Bitwig), never like an analytics dashboard, and never like a
marketing page: no gradients, glows for their own sake, hero typography, or
decorative grids.

Light theme is a full peer, not an afterthought: the same roles re-pointed to
a cool paper ramp, with the lime deepened so it still reads as the signal.

**Key Characteristics:**
- One signal colour (lime); transit line colours as the only other hues in the stage.
- Flat, tonal depth: night ink, platform slate, carriage slate.
- Small, dense, quiet controls; state shown by colour, not by growing.
- Uppercase tracked micro-labels for structure, monospace for anything that is a number.
- Every token has a light-theme counterpart; nothing is dark-only except the weq8 display.

## Colors

A cool neutral ramp (subtly blue-grey) with a single desaturated lime signal and
four status lamps. All values here are the dark (default) theme; the light
theme re-points the same semantic tokens in `app/globals.css`.

### Primary
- **Signal Lime** (#b6d94c; Signal Lime Deep #5c7a1a in light): the only accent.
  Active tab, pressed segment, play button, selected chip, focus ring, playheads
  when no line colour applies. Used on well under a tenth of any screen.

### Neutral
- **Night Ink** (#0e0f11): app background (`--bg`).
- **Platform Slate** (#17181b): panels, header, footer (`--surface`).
- **Carriage Slate** (#202226): controls, rack cards, inputs (`--surface2`).
- **Tunnel Black** (#0a0a0b): sunken wells, meter tracks (`--surface-sunken`).
- **Rail Line** (#282b30) / **Rail Line Strong** (#34383f): borders and hover fills.
- **Timetable White** (#eef0f3): primary text.
- **Schedule Grey** (#a4abb6): secondary text that must stay strong (`--text-subtle`).
- **Muted Grey** (#868d99): secondary and label text (`--muted`), ≥4.5:1 on every surface.
- **Quiet Line** (#6b7280): idle non-text chrome only (`--muted-line`); never text.

### Status lamps
- **Alarm Red** (#e5534b): stop, delete, errors, danger tints.
- **Amber Lamp** (#e2a53b): warnings, mute/solo/disable active, automation lanes.
- **Go Green** (#4caf7d): success, connected.
- **Route Blue** (#5ab0e6): info, merged/duplicate lanes.

In light theme status hues used as text switch to their `-text` tokens
(`--warning-text`, `--success-text`, `--automation-text`), which are darker than
the fills so they clear 4.5:1 on white.

### Named Rules
**The Platform Indicator Rule.** Lime means "live or selected". It never decorates, never fills a large area, and never appears as a second, competing accent.

**The Line Colour Rule.** A transit line's colour appears only where that line is: its lane edge, its melodic polyline, its dots, its map route. Role tags get their own muted categorical palette (`lib/laneTags.js`) so they never masquerade as a line.

**The Contrast Floor Rule.** Any text is at least 4.5:1 on the surface it sits on, in both themes. `--muted` is the dimmest text token; `--muted-line` exists precisely so borders can be quieter than text.

## Typography

**Display Font:** Inter (ui-sans-serif fallback)
**Body Font:** Inter
**Label/Mono Font:** JetBrains Mono (ui-monospace fallback) for readouts

**Character:** a neutral grotesk that stays legible at 9-12px, paired with a
monospace for every value that changes (dB, BPM, Hz, times, note names), so
numbers don't jitter as they update.

### Hierarchy
The scale is tokenised (`--fs-3xs` … `--fs-xl`, root 14px). Use the tokens, not literals.
- **Display** (700, `--fs-xl` 1.4rem, 1.15): tab placeholders and page titles only.
- **Headline** (700, `--fs-lg` 1.15rem): section titles in sheets and panels.
- **Title** (600, `--fs-md` 0.86rem): card and dialog titles, transport labels.
- **Body** (400, `--fs-sm` 0.78rem, 1.5): default UI text and panel prose; prose capped near 65ch.
- **Label** (600, `--fs-3xs` 0.62rem, `--tracking-caps` 0.12em, uppercase): rack card heads, section labels.
- **Readout** (mono, `--fs-xs` 0.72rem): values next to sliders, the event log, BPM.

### Named Rules
**The Readable Floor Rule.** Nothing a person must read goes below `--fs-3xs` (0.62rem ≈ 8.7px). The one exception is `--fs-micro` (0.5rem), reserved for note names and bar numbers drawn inside a stop rail, where each value is also in the dot's accessible name, tooltip and editor.

**The Three Trackings Rule.** Letter-spacing is `--tracking-tight` (body), `--tracking-wide` (small labels) or `--tracking-caps` (uppercase labels). No other values.

## Layout

A full-height instrument grid: sticky header, a scrolling track list beside a
260px event log, and a mixer footer that scrolls sideways like a hardware strip.
Lanes stack by line type (Metro, Tram, Trolley, Bus), each a header row over its
stop rail, with the device rack expanding in place below.

Spacing follows the 4/8 scale (`--space-025` … `--space-600`), with 6px and 12px
steps for dense controls. Breakpoints come from `lib/shared/breakpoints.js`:
below 768px the phone layout (`components/mobile/`) replaces the DAW view; at
768-1023px the event log is dropped and lane header rows wrap; touch sizing is
keyed on `(pointer: coarse)`, not width, with a 44px floor (`--tap-min`).

Layering uses the named z-index scale (`--z-sticky` 50 through `--z-dialog`
2000). The map is `isolation: isolate`, so Leaflet's own 400-1000 panes never
compete with app overlays.

**The Stage Rule.** The stop rails are the stage. Nothing permanent may overlap a rail, and no layout change at any width may make the track list scroll sideways.

## Elevation & Depth

Flat, tonal layering. Depth comes from the neutral ramp (night ink under
platform slate under carriage slate), separated by 1px rail-line borders.
Shadows appear only on things that float above the instrument: menus, the
header drawer, sheets, dialogs, the upgrade modal.

### Shadow Vocabulary
- **Raised** (`--elevation-raised`: `0 1px 2px rgba(0,0,0,0.5)`): rare; a control lifted off its card.
- **Overlay** (`--elevation-overlay`: `0 8px 24px rgba(0,0,0,0.55)`): menus, popovers, tooltips.
- **Modal** (`--elevation-modal`: `0 24px 64px rgba(0,0,0,0.6)`): dialogs, editors, the paywall.
- **Scrim** (`--scrim`: `rgba(0,0,0,0.55)`): behind every modal, sheet and drawer.

Each has a lighter light-theme value; never write a literal shadow.

### Named Rules
**The Flat-At-Rest Rule.** Surfaces in the instrument are flat. A shadow means "this is floating over the instrument and will go away".

**The Earned Glow Rule.** Coloured glows are allowed only on the playhead and on the stop that is sounding right now: light that marks time. Nothing static glows.

## Shapes

Small, technical corners: 3px (`--radius-sm`) on buttons, inputs and segments;
5-6px on rack cards and panels; 8px (`--radius-lg`) on dialogs and sheets; pill
(`--radius-pill`) only for filter chips and status dots. Borders are 1px
hairlines. Thick edges are reserved for data: a lane's 3-4px left edge carries
its line or role colour, a rack card's inset edge carries its domain.

**The Hairline Rule.** Borders are 1px. A thicker edge must encode something (line, role, domain, automation); a decorative side stripe on a callout is not allowed.

## Components

**Precise and quiet.** Controls are small and low-contrast at rest and step
back so lanes and colour carry the eye; state is shown by the lime (or a status
lamp), never by the control growing.

### Buttons
- **Shape:** gently squared (3px).
- **Secondary (default):** carriage slate fill, timetable-white text, rail-line border, 7px 16px. Hover shifts the fill to rail line.
- **Primary / Play:** same fill, lime border and lime text. Stop swaps to alarm red. Danger buttons add the danger tint.
- **Icon buttons:** Phosphor icons from `components/icons.jsx` at 1em, bold weight (fill for play/stop), always with an `aria-label`. Never a Unicode glyph.
- **Focus:** the global 2px lime ring at 2px offset.

### Segmented toggles
- **Style:** joined carriage-slate cells separated by hairlines (Map/DAW, Mock/Live, grid resolution).
- **State:** active cell gets the rail-line fill and lime text, plus `aria-pressed`.

### Chips
- **Style:** pill, transparent over night ink, muted text, rail-line border.
- **State:** selected chips take carriage slate, timetable-white text and a lime border.

### Rack cards
- **Corner Style:** 5px.
- **Background:** carriage slate, 1px border whose top edge and inset left edge take the card's domain colour (tone & pitch vs rhythm & movement).
- **Internal Padding:** 8px 10px 10px, uppercase tracked label head.

### Inputs / Fields
- **Style:** carriage slate fill, 1px rail-line border, 3px corners, readout mono for numbers.
- **Focus:** the global lime focus ring; disabled at 50% opacity.
- **Labels:** every field has a visible or `aria` label; placeholder is never the label.

### Overlays (dialogs, editors, sheets, drawer)
- All share one keyboard contract via `lib/shared/useModal.js`: focus moves in, Tab stays inside, Esc closes only the top overlay, focus returns to the opener.
- Dialog panels: platform slate, 8px corners, modal shadow over the scrim. Below 768px, `components/Sheet.jsx` presents the same content as a bottom sheet.

### Stop rail (signature)
- The lane's melody as a piano roll: a faint polyline in the line colour through dots placed by pitch, a 16th-note grid, dimmed regions outside the loop, and draggable loop handles.
- The playhead and active-stop highlight are drawn from the shared ticker (`lib/shared/playheadTicker.js`) with transforms, never React state.
- Every dot and handle is keyboard reachable: dots with a roving tabindex, handles as sliders.

## Do's and Don'ts

### Do:
- **Do** use the semantic tokens (`--surface2`, `--muted`, `--accent`, `--fs-sm`, `--space-100`, `--z-sheet`…), never literals, so both themes work.
- **Do** keep lime for live and selected state only (The Platform Indicator Rule).
- **Do** set every changing number in the mono readout face.
- **Do** give every icon-only control an `aria-label` that names its target ("Mute Kick", "Remove M2 copy").
- **Do** animate playheads and meters with `transform`, driven from the shared ticker or a ref, not React state.
- **Do** check a new surface in both themes and at 820px before calling it done.

### Don't:
- **Don't** introduce a second accent colour, gradients, gradient text, or decorative glows.
- **Don't** use Unicode glyphs (⏻ ⏹ ▶ ✕ ⋯) as icons; import from `components/icons.jsx`.
- **Don't** put an em-dash in user-facing copy; use a colon, comma or period.
- **Don't** add decorative grid backgrounds or side-stripe callouts; a hairline and a tint are enough.
- **Don't** hide text with `opacity: 0` while it still takes layout; use `display` or create the content on demand.
- **Don't** go below `--fs-3xs` for readable text, or use `--muted-line` for text.
