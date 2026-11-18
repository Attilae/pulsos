// Both layouts use the same picker payload and action dispatch. MixerTab owns
// the actual edits, including playback/plan gates and sidechain remapping.
export function linePickerProps({ prompt, allRoutes, selectedIds, onAddLine, onChangeLine, onRemoveLine, onClose }) {
  return {
    mode: prompt.mode,
    allRoutes: allRoutes ?? [],
    selectedIds,
    currentType: prompt.type ?? null,
    currentRouteId: prompt.routeId ?? null,
    onPick: picked => {
      if (prompt.mode === 'add') onAddLine?.(picked)
      else onChangeLine?.(prompt.routeId, picked)
      onClose()
    },
    onRemove: prompt.mode === 'change' && onRemoveLine
      ? () => { onRemoveLine(prompt.routeId); onClose() }
      : undefined,
    onClose,
  }
}
