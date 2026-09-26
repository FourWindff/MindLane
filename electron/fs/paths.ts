import path from 'node:path'

/**
 * True when `filePath` is strictly inside `workspacePath` (the workspace root
 * itself is not "within"). Both inputs are resolved first, so callers may pass
 * either raw or already-resolved paths; `../` cannot escape.
 */
export function isWithinWorkspace(filePath: string, workspacePath: string): boolean {
  const resolvedWorkspacePath = path.resolve(workspacePath)
  const resolvedFilePath = path.resolve(filePath)
  const relativePath = path.relative(resolvedWorkspacePath, resolvedFilePath)
  return relativePath !== '' && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)
}
