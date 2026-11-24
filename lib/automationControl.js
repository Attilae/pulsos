import { denormalizeExp, denormalizeToRange } from './mappings.js'

export function autoCtl(autoTargets, ids, { divide = 1 } = {}) {
  for (const id of [].concat(ids)) {
    const a = autoTargets?.[id]
    if (!a) continue
    const { spec, value } = a
    const display = (value == null || !spec) ? null
      : ((spec.curve === 'exp'
          ? denormalizeExp(value, spec.min, spec.max)
          : denormalizeToRange(value, spec.min, spec.max)) / divide)
    return { disabled: true, display }
  }
  return { disabled: false, display: null }
}


// A device's power button while a device on/off lane (lib/toggleAutomation.js)
// may own it. `automated` locks the button; `on` is the lane's live state while
// playing, else the manual setting; `editable` keeps the device's other controls
// usable while the lane may switch it on.
export function deviceToggleState(autoTargets, id, manualOn) {
  const a = autoTargets?.[id]
  if (!a) return { automated: false, on: !!manualOn, editable: !!manualOn }
  const on = typeof a.value === 'number' ? a.value >= 0.5 : !!manualOn
  return { automated: true, on, editable: true }
}
