/**
 * Validate a user-supplied file or folder name and return it trimmed.
 * `label` is the noun used in the error message (e.g. `文件名` -> `文件名包含非法字符`).
 */
export function assertEntryName(name: string, label: string): string {
  const trimmedName = name.trim()
  if (!trimmedName) {
    throw new Error(`${label}不能为空`)
  }
  if (trimmedName === '.' || trimmedName === '..' || /[\\/]/.test(trimmedName)) {
    throw new Error(`${label}包含非法字符`)
  }
  return trimmedName
}
