// Read-only response calculation: include both cascaded sections of 24 dB filters.
export function eqResponse(runtime, count = 256) {
  const maxHz = runtime.audioCtx.sampleRate / 2
  const frequencies = Float32Array.from({ length: count }, (_, i) => 10 * (maxHz / 10) ** (i / (count - 1)))
  const total = new Float32Array(count).fill(1)
  const magnitude = new Float32Array(count), phase = new Float32Array(count)
  runtime.spec.forEach((band, index) => {
    const sections = band.type === 'noop' ? 0 : band.type.endsWith('24') ? 2 : 1
    for (let section = 0; section < sections; section++) {
      if (runtime.getFrequencyResponse(index, section, frequencies, magnitude, phase)) {
        for (let i = 0; i < count; i++) total[i] *= magnitude[i]
      }
    }
  })
  return { frequencies, db: Float32Array.from(total, v => 20 * Math.log10(Math.max(v, 1e-12))) }
}

export const eqHasGain = type => /^(lowshelf|highshelf|peaking)/.test(type)
export const eqHasQ = type => type !== 'noop' && !/shelf/.test(type)
export const eqTypeLabel = type => type === 'noop' ? 'Unused' : `${({ lowpass: 'Low pass', highpass: 'High pass', bandpass: 'Band pass', lowshelf: 'Low shelf', highshelf: 'High shelf', peaking: 'Bell', notch: 'Notch' })[type.replace(/\d+$/, '')] ?? type} ${type.endsWith('24') ? '24' : '12'} dB`
