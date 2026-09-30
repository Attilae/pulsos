// The app's icon set: Phosphor, imported one icon at a time (dist/csr/<Name>)
// so the bundle carries only these, never the whole library.
//
// This replaces Unicode glyphs (⏻ ⏹ ▶ ✕ ⋯ ↻ ⚠ ▾): those render from whatever
// font the OS falls back to, differ between macOS/Windows/Android, and some
// switch to emoji presentation, which reads as off-brand on an instrument.
//
// Every icon is decorative (aria-hidden): the button around it carries the
// name, as text or aria-label. Size is 1em so an icon follows its label's
// font-size; weight is "bold" because the UI's text runs 9-12px and Phosphor's
// regular stroke disappears at that size. Play/Stop use "fill" like hardware.
'use client'

import { ArrowClockwise as ArrowClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowClockwise'
import { ArrowCounterClockwise as ArrowCounterClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowCounterClockwise'
import { ArrowDown as ArrowDownIcon } from '@phosphor-icons/react/dist/csr/ArrowDown'
import { ArrowRight as ArrowRightIcon } from '@phosphor-icons/react/dist/csr/ArrowRight'
import { ArrowUp as ArrowUpIcon } from '@phosphor-icons/react/dist/csr/ArrowUp'
import { ArrowUpRight as ArrowUpRightIcon } from '@phosphor-icons/react/dist/csr/ArrowUpRight'
import { ArrowsLeftRight as ArrowsLeftRightIcon } from '@phosphor-icons/react/dist/csr/ArrowsLeftRight'
import { Backspace as BackspaceIcon } from '@phosphor-icons/react/dist/csr/Backspace'
import { CaretDown as CaretDownIcon } from '@phosphor-icons/react/dist/csr/CaretDown'
import { CaretRight as CaretRightIcon } from '@phosphor-icons/react/dist/csr/CaretRight'
import { Check as CheckIcon } from '@phosphor-icons/react/dist/csr/Check'
import { Copy as CopyIcon } from '@phosphor-icons/react/dist/csr/Copy'
import { DotsThree as DotsThreeIcon } from '@phosphor-icons/react/dist/csr/DotsThree'
import { DownloadSimple as DownloadSimpleIcon } from '@phosphor-icons/react/dist/csr/DownloadSimple'
import { MusicNotes as MusicNotesIcon } from '@phosphor-icons/react/dist/csr/MusicNotes'
import { Play as PlayIcon } from '@phosphor-icons/react/dist/csr/Play'
import { Plus as PlusIcon } from '@phosphor-icons/react/dist/csr/Plus'
import { Power as PowerIcon } from '@phosphor-icons/react/dist/csr/Power'
import { Stop as StopIcon } from '@phosphor-icons/react/dist/csr/Stop'
import { Warning as WarningIcon } from '@phosphor-icons/react/dist/csr/Warning'
import { X as XIcon } from '@phosphor-icons/react/dist/csr/X'

function wrap(Glyph, defaultWeight = 'bold') {
  function AppIcon({ className = '', weight = defaultWeight, ...rest }) {
    return (
      <Glyph
        className={`icon${className ? ` ${className}` : ''}`}
        weight={weight}
        aria-hidden="true"
        focusable="false"
        {...rest}
      />
    )
  }
  AppIcon.displayName = `Icon(${Glyph.displayName ?? Glyph.name ?? 'Glyph'})`
  return AppIcon
}

export const IconClose       = wrap(XIcon)
export const IconCaretDown   = wrap(CaretDownIcon)
export const IconCaretRight  = wrap(CaretRightIcon)
export const IconWarning     = wrap(WarningIcon)
export const IconCheck       = wrap(CheckIcon)
export const IconDownload    = wrap(DownloadSimpleIcon)
export const IconExternal    = wrap(ArrowUpRightIcon)
export const IconReset       = wrap(ArrowCounterClockwiseIcon)
export const IconRepick      = wrap(ArrowClockwiseIcon)
export const IconAdd         = wrap(PlusIcon)
export const IconChangeLine  = wrap(ArrowsLeftRightIcon)
export const IconDuplicate   = wrap(CopyIcon)
export const IconPower       = wrap(PowerIcon)
export const IconMore        = wrap(DotsThreeIcon)
export const IconPlay        = wrap(PlayIcon, 'fill')
export const IconStop        = wrap(StopIcon, 'fill')
export const IconMusic       = wrap(MusicNotesIcon)
export const IconClear       = wrap(BackspaceIcon)
export const IconMoveUp      = wrap(ArrowUpIcon)
export const IconMoveDown    = wrap(ArrowDownIcon)
export const IconForward     = wrap(ArrowRightIcon)
