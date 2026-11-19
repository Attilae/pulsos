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
import DrumLaneSheet from './DrumLaneSheet.jsx'
import MobileTransportBar from './MobileTransportBar.jsx'
import LaneSheet from './LaneSheet.jsx'
import MoreSheet from './MoreSheet.jsx'
import MixerSheet from './MixerSheet.jsx'
import SongMenu from '../SongMenu.jsx'
import Sheet from '../Sheet.jsx'
import LinePicker from '../LinePicker.jsx'
import DuplicateLaneDialog from '../DuplicateLaneDialog.jsx'
import { linePickerProps } from '@/lib/linePickerProps.js'
import './MobileDaw.css'

export default function MobileDaw({ controls, lanes }) {
  const [mixerOpen, setMixerOpen] = useState(false)
  const [drumOpen, setDrumOpen] = useState(false)
  const [linePicker, setLinePicker] = useState(null)
  const [dupPrompt, setDupPrompt] = useState(null)
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
            drums={lanes.drums}
            onOpenDrums={() => setDrumOpen(true)}
            mode={controls.mode}
            started={controls.started}
            liveSnapshot={controls.liveSnapshot}
            snapshotLoading={controls.snapshotLoading}
            onRefetch={controls.onRefetch}
            onAddLine={type => setLinePicker({ mode: 'add', type })}
            onRepickType={lanes.onRepickType}
            routes={lanes.routes}
            disabled={lanes.disabled}
            soloRoutes={lanes.soloRoutes}
            volumes={lanes.volumes}
            lockedIds={lanes.lockedIds}
            labels={lanes.labels}
            mergedConsumedIds={lanes.mergedConsumedIds}
            onDisable={lanes.onDisable}
            onSolo={lanes.onSolo}
            onVolume={lanes.onVolume}
            onOpenLane={setOpenLaneId}
          />
        )}
      </div>

      <MobileTransportBar
        onOpenMixer={() => setMixerOpen(true)}
        started={controls.started}
        onPlayPause={controls.onPlayPause}
        bpm={controls.bpm}
        onBpm={controls.onBpm}
        view={controls.view}
        onView={controls.onView}
        mapStyle={controls.mapStyle}
        onMapStyle={controls.onMapStyle}
        needsGesture={controls.needsGesture}
        onGestureStart={controls.onGestureStart}
        noOutput={controls.noOutput}
        onSoundCheck={controls.onSoundCheck}
      />

      {lanes.drums?.pattern && <DrumLaneSheet
        open={drumOpen} onClose={() => setDrumOpen(false)}
        drums={lanes.drums} started={controls.started}
        onVolume={lanes.onVolume} onFilter={lanes.onFilter} onSendLevel={lanes.onSendLevel}
        activeFxTracks={lanes.activeFxTracks} sendMatrix={lanes.sendMatrix}
        onClear={() => { setDrumOpen(false); lanes.drums.onClear() }}
      />}

      <LaneSheet
        route={openLane}
        onChangeLine={() => { setOpenLaneId(null); setLinePicker({ mode: 'change', type: openLane.type, routeId: openLane.id }) }}
        onRemoveLine={() => { lanes.onRemoveLine(openLane.id); setOpenLaneId(null) }}
        onDuplicate={() => { setOpenLaneId(null); setDupPrompt({ routeId: openLane.id, routeName: openLane.name }) }}
        onRemoveDuplicate={() => { lanes.onRemoveDuplicate(openLane.id); setOpenLaneId(null) }}
        onUnmerge={() => { lanes.onUnmerge(openLane.id); setOpenLaneId(null) }}
        open={openLane != null}
        onClose={() => setOpenLaneId(null)}
        volume={lanes.volumes?.[openLaneId] ?? 0}
        pan={lanes.pans?.[openLaneId] ?? 0}
        disabled={!!lanes.disabled?.[openLaneId]}
        soloed={!!lanes.soloRoutes?.has(openLaneId)}
        synthType={lanes.synthTypes?.[openLaneId]}
        adsr={lanes.adsrs?.[openLaneId]}
        granular={lanes.granulars?.[openLaneId]}
        scale={lanes.scales?.[openLaneId]}
        octave={lanes.octaves?.[openLaneId] ?? 0}
        semitone={lanes.semitones?.[openLaneId] ?? 0}
        pitchVariety={lanes.pitchVariety?.[openLaneId]}
        speed={lanes.speeds?.[openLaneId] ?? 1}
        gridResolution={lanes.gridResolutions?.[openLaneId]}
        loopRegion={lanes.loopRegions?.[openLaneId]}
        onTrackLoopRegion={lanes.onTrackLoopRegion}
        started={lanes.started}
        audioExporting={lanes.audioExporting}
        audioProgress={lanes.audioProgress}
        onExportMidi={lanes.onExportMidi}
        onExportWav={lanes.onExportWav}
        arp={lanes.arps?.[openLaneId]}
        perStopSteps={lanes.pitchOffsets?.[openLaneId]}
        stopVelocities={lanes.stopVelocities?.[openLaneId]}
        noteChance={lanes.noteChances?.[openLaneId]}
        noteLength={lanes.noteLengths?.[openLaneId]}
        stopNoteLength={lanes.stopNoteLengths?.[openLaneId]}
        stopVelocityMap={lanes.stopVelocityMaps?.[openLaneId]}
        legato={!!lanes.legatos?.[openLaneId]}
        glide={lanes.glides?.[openLaneId] ?? 0}
        automationLanes={lanes.automationLanes?.[openLaneId]}
        drone={!!lanes.droneModes?.[openLaneId]}
        stopChances={lanes.stopChances?.[openLaneId]}
        loopPattern={lanes.loopPatterns?.[openLaneId]}
        sendMatrix={lanes.sendMatrix}
        activeFxTracks={lanes.activeFxTracks}
        sidechain={lanes.sidechains?.[openLaneId]}
        sidechainSources={lanes.sidechainSources}
        filter={lanes.filters?.[openLaneId]}
        tag={lanes.labels?.[openLaneId]}
        onVolume={lanes.onVolume}
        onPan={lanes.onPan}
        onDisable={lanes.onDisable}
        onSolo={lanes.onSolo}
        onSynthType={lanes.onSynthType}
        onADSR={lanes.onADSR}
        onSamplerPreset={lanes.onSamplerPreset}
        onSamplerUpload={lanes.onSamplerUpload}
        onDrumVoice={lanes.onDrumVoice}
        onGranular={lanes.onGranular}
        onGlide={lanes.onGlide}
        onLegato={lanes.onLegato}
        onScale={lanes.onScale}
        onOctaveShift={lanes.onOctaveShift}
        onPitchVariety={lanes.onPitchVariety}
        onTrackSpeed={lanes.onTrackSpeed}
        onGridResolution={lanes.onGridResolution}
        onNoteLength={lanes.onNoteLength}
        onStopNoteLength={lanes.onStopNoteLength}
        onStopVelocityMap={lanes.onStopVelocityMap}
        onArp={lanes.onArp}
        onSendLevel={lanes.onSendLevel}
        onSidechain={lanes.onSidechain}
        onStopPitch={lanes.onStopPitch}
        onStopVelocity={lanes.onStopVelocity}
        onNoteChance={lanes.onNoteChance}
        onStopChance={lanes.onStopChance}
        onLoopPattern={lanes.onLoopPattern}
        onLaneTag={lanes.onLaneTag}
        onFilter={lanes.onFilter}
      />

      {linePicker && <LinePicker {...linePickerProps({
        prompt: linePicker, allRoutes: lanes.allRoutes,
        selectedIds: new Set(lanes.selectedRouteIds ?? []),
        onAddLine: lanes.onAddLine, onChangeLine: lanes.onChangeLine, onRemoveLine: lanes.onRemoveLine,
        onClose: () => setLinePicker(null),
      })} />}
      {dupPrompt && <DuplicateLaneDialog routeName={dupPrompt.routeName}
        onConfirm={semitones => { lanes.onDuplicateTrack(dupPrompt.routeId, semitones); setDupPrompt(null) }}
        onClose={() => setDupPrompt(null)} />}

      <MixerSheet open={mixerOpen} onClose={() => setMixerOpen(false)} mixer={controls.mixer} />

      <MoreSheet
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        cityName={controls.cityName}
        started={controls.started}
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
        audioProgress={controls.audioProgress}
        canImportDrums={controls.canImportDrums}
        hasDrums={controls.hasDrums}
        onImportDrums={() => { setMoreOpen(false); controls.onImportDrums() }}
        reference={controls.reference}
        bpm={controls.bpm}
        onOpenMixer={() => { setMoreOpen(false); setMixerOpen(true) }}
        onOpenAi={() => { setMoreOpen(false); controls.onOpenAi() }}
        onSoundCheck={() => { setMoreOpen(false); controls.onSoundCheck() }}
      />

      {/* SongMenu is an anchored dropdown on desktop; at 390px an anchored
          popover clips against the viewport edge, so it gets a sheet. The
          sheet *is* the menu, so SongMenu renders inline (no second trigger)
          and closes the sheet after an action. */}
      <Sheet open={songOpen} onClose={() => setSongOpen(false)} title="Song" className="song-sheet">
        <SongMenu {...controls.song} inline onDone={() => setSongOpen(false)} />
      </Sheet>
    </div>
  )
}
