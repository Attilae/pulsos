'use client'
import { useRef, useState } from 'react'
import * as Tone from 'tone'
import { decodeCustomAudio } from '@/lib/customAudio.js'
import { useCustomUploadGate } from '@/lib/shared/useCustomUploadGate.js'

export default function CustomIRPicker({ onCustomIR }) {
  const inputRef = useRef(null)
  const [name, setName] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const { allowed, choose } = useCustomUploadGate(inputRef)

  async function handleFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''   // so picking the same file again still fires onChange
    if (!file) return
    setError(null)
    setLoading(true)
    try {
      const raw = Tone.getContext().rawContext
      const audioBuffer = await decodeCustomAudio(file, 'ir', buf => raw.decodeAudioData(buf))
      setName(file.name)
      onCustomIR(audioBuffer)
    } catch (err) {
      console.error('Custom IR load failed:', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fx-param-row">
      <span className="fx-param-label">Load IR</span>
      <button
        type="button"
        aria-label="Load custom impulse response"
        disabled={loading}
        aria-busy={loading}
        className="fx-param-select"
        onClick={choose}
        title={allowed ? undefined : 'Custom impulse responses are a Pro feature'}
      >
        {loading ? 'Loading…' : allowed ? (error ?? name ?? 'Choose WAV…') : 'Pro'}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="audio/wav,audio/x-wav,audio/wave,.wav"
        style={{ display: 'none' }}
        onChange={handleFile}
      />
    </div>
  )
}
