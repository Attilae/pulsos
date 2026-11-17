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

