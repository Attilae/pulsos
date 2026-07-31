// The phone Map/DAW layout.
//
// Rendered by MixerTab in place of .daw-header + DawView when the viewport is
// below 768px. MixerTab keeps every piece of state and every handler — this is
// a presentation layer over the same props the desktop view receives, so there
// is exactly one mixer in the app, not two.
//
// MixerTab still renders <MapView> itself in both branches, because unmounting
// Leaflet on every view switch is expensive and MapResizer already handles
// being shown again.
'use client'

import { useState } from 'react'
import MobileTopBar from './MobileTopBar.jsx'
import MobileLaneList from './MobileLaneList.jsx'
import MobileTransportBar from './MobileTransportBar.jsx'
import LaneSheet from './LaneSheet.jsx'
import MoreSheet from './MoreSheet.jsx'
import SongMenu from '../SongMenu.jsx'
import Sheet from '../Sheet.jsx'
import './MobileDaw.css'

export default function MobileDaw({ controls, lanes }) {
  const [openLaneId, setOpenLaneId] = useState(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const [songOpen, setSongOpen] = useState(false)

  const openLane = openLaneId
    ? lanes.routes.find(r => r.id === openLaneId) ?? null
    : null

  return (
    <div className="mdaw">
      <MobileTopBar
        cityName={controls.cityName}
        songName={controls.song?.currentSong?.name ?? 'Untitled'}
        onSong={() => setSongOpen(true)}
        onMore={() => setMoreOpen(true)}
        harmonyMixed={controls.harmonyMixed}
      />

      <div className="mdaw-stage">
        {/* MapView is a sibling rendered by MixerTab and positioned into this
            grid area by CSS, so switching views never remounts Leaflet. */}
        {controls.view === 'daw' && (
          <MobileLaneList
            routes={lanes.routes}
            disabled={lanes.disabled}
            soloRoutes={lanes.soloRoutes}
            volumes={lanes.volumes}
            lockedIds={lanes.lockedIds}
            mergedConsumedIds={lanes.mergedConsumedIds}
            onDisable={lanes.onDisable}
            onSolo={lanes.onSolo}
            onVolume={lanes.onVolume}
            onOpenLane={setOpenLaneId}
          />
        )}
      </div>

      <MobileTransportBar
        started={controls.started}
        onPlayPause={controls.onPlayPause}
        bpm={controls.bpm}
        onBpm={controls.onBpm}
        view={controls.view}
        onView={controls.onView}
        needsGesture={controls.needsGesture}
        onGestureStart={controls.onGestureStart}
        noOutput={controls.noOutput}
        onSoundCheck={controls.onSoundCheck}
      />

      <LaneSheet
        route={openLane}
        open={openLane != null}
        onClose={() => setOpenLaneId(null)}
        volume={lanes.volumes?.[openLaneId] ?? 0}
        pan={lanes.pans?.[openLaneId] ?? 0}
        disabled={!!lanes.disabled?.[openLaneId]}
        soloed={!!lanes.soloRoutes?.has(openLaneId)}
        synthType={lanes.synthTypes?.[openLaneId]}
        scale={lanes.scales?.[openLaneId]}
        octave={lanes.octaves?.[openLaneId] ?? 0}
        semitone={lanes.semitones?.[openLaneId] ?? 0}
        pitchVariety={lanes.pitchVariety?.[openLaneId]}
        perStopSteps={lanes.pitchOffsets?.[openLaneId]}
        stopVelocities={lanes.stopVelocities?.[openLaneId]}
        sendMatrix={lanes.sendMatrix}
        activeFxTracks={lanes.activeFxTracks}
        sidechain={lanes.sidechains?.[openLaneId]}
        sidechainSources={lanes.sidechainSources}
        onVolume={lanes.onVolume}
        onPan={lanes.onPan}
        onDisable={lanes.onDisable}
        onSolo={lanes.onSolo}
        onSynthType={lanes.onSynthType}
        onScale={lanes.onScale}
        onOctaveShift={lanes.onOctaveShift}
        onSendLevel={lanes.onSendLevel}
        onSidechain={lanes.onSidechain}
        onStopPitch={lanes.onStopPitch}
        onStopVelocity={lanes.onStopVelocity}
      />

      <MoreSheet
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        cityName={controls.cityName}
        mode={controls.mode}
        onMode={controls.onMode}
        liveAvailable={controls.liveAvailable}
        harmony={controls.harmony}
        onHarmony={controls.onHarmony}
        harmonyMixed={controls.harmonyMixed}
        onRepick={() => { setMoreOpen(false); controls.onRepick() }}
        onExportMidi={controls.onExportMidi}
        onExportWav={controls.onExportWav}
        canExport={controls.canExport}
        audioExporting={controls.audioExporting}
        canImportDrums={controls.canImportDrums}
        hasDrums={controls.hasDrums}
        onImportDrums={() => { setMoreOpen(false); controls.onImportDrums() }}
        onOpenAi={() => { setMoreOpen(false); controls.onOpenAi() }}
        onSoundCheck={() => { setMoreOpen(false); controls.onSoundCheck() }}
      />

      {/* SongMenu is an anchored dropdown on desktop; at 390px an anchored
          popover clips against the viewport edge, so it gets a sheet. */}
      <Sheet open={songOpen} onClose={() => setSongOpen(false)} title="Song" className="song-sheet">
        <SongMenu {...controls.song} />
      </Sheet>
    </div>
  )
}
