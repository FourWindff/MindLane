/**
 * Validate a user-supplied file or folder name and return it trimmed.
 * `label` is the noun used in the error message (e.g. `File name` -> `File name contains illegal characters`).
 */
export function assertEntryName(name: string, label: string): string {
  const trimmedName = name.trim()
  if (!trimmedName) {
    throw new Error(`${label} cannot be empty`)
  }
  if (trimmedName === '.' || trimmedName === '..' || /[\\/]/.test(trimmedName)) {
    throw new Error(`${label} contains illegal characters`)
  }
  return trimmedName
}
