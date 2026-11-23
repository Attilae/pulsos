// A guided tour can place its controls beside an open modal. Associate that
// popover with the exact panel so other overlays keep their normal contract.
const companions = []
export function registerModalCompanion(panel, root, onEscape) {
  const entry = { panel, root, onEscape }
  companions.push(entry)
  return () => { const index = companions.indexOf(entry); if (index >= 0) companions.splice(index, 1) }
}
export function getModalCompanion(panel) {
  return companions.findLast(entry => entry.panel === panel && entry.root.isConnected)
}
