export function setActionReference(
  existing: Record<string, any>,
  action: Record<string, any>,
  options?: { addActionReferenceToObject?: boolean }
) {
  if (options?.addActionReferenceToObject) {
    existing.actions ??= []
    existing.actions.push(action)
  }
}
