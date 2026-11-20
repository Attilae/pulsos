'use client'
import { useState } from 'react'
import Sheet from '../Sheet.jsx'
import MasterStrip from '../MasterStrip.jsx'
import MasterChainCard from '../MasterChainCard.jsx'
import FxTrackCard from '../fx/FxTrackCard.jsx'
import FxAddButton from '../fx/FxAddButton.jsx'
import { FX_BUSES } from '@/lib/fxSpecs.js'
import { GroupHead } from './lane/fields.jsx'

export default function MixerSheet({ open, onClose, mixer }) {
  const [segment, setSegment] = useState('fx')
  return <Sheet open={open} onClose={onClose} title="Mixer" className="mixer-sheet" tourId="mobile-mixer"
    toolbar={<div className="lsheet-segments" role="tablist" aria-label="Mixer sections">
      {[['fx', 'FX buses'], ['master', 'Master']].map(([id, label]) => <button key={id} type="button" role="tab"
        aria-selected={segment === id} className={`lsheet-segment${segment === id ? ' is-active' : ''}`}
        onClick={() => setSegment(id)}>{label}</button>)}
    </div>}>

    {segment === 'master' && <section className="lsheet-group">
      <GroupHead title="Master" description="Set the output level and shape the final mix." />
      <MasterStrip volume={mixer.masterVolume} onVolume={mixer.onMasterVolume} variant="sheet" />
      <MasterChainCard settings={mixer.masterChain} onChange={mixer.onMasterChain} active={open} variant="sheet" />
    </section>}
    {segment === 'fx' && <section className="lsheet-group">
      <GroupHead title="FX buses" description="Add a bus, then send lanes to it from their Mix controls. Expand a bus to shape its sound." />
      <FxAddButton activeFxTracks={mixer.activeFxTracks} onAdd={mixer.onAddFxTrack} />
      {mixer.activeFxTracks.length === 0 && <p className="lsheet-hint">No FX buses yet.</p>}
      {mixer.activeFxTracks.map(id => {
        const bus = FX_BUSES.find(b => b.id === id)
        if (!bus) return null
        return <FxTrackCard key={id} bus={bus} variant="sheet"
          wet={mixer.fxBusWet?.[id] ?? 1}
          muted={mixer.fxBusMuted?.[id] ?? false} soloed={mixer.fxBusSoloed?.[id] ?? false}
          params={mixer.fxBusParams?.[id]}
          onWet={v => mixer.onFxBusWet(id, v)} onMute={() => mixer.onFxBusMute(id)} onSolo={() => mixer.onFxBusSolo(id)}
          onParam={(paramId, value) => mixer.onFxBusParam(id, paramId, value)}
          onCustomIR={buffer => mixer.onFxBusCustomIR(id, buffer)} onRemove={() => mixer.onRemoveFxTrack(id)} />
      })}
    </section>}
  </Sheet>
}
