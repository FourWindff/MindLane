import { openFileRegistry } from '@/features/mindmap/model/openFileRegistry'

/**
 * Resolve the file path to open when a capsule is clicked: prefer the currently
 * loaded instance (freshest after a rename or move), falling back to the
 * persisted `fileUuidPaths` map when the file was not opened in this launch.
 */
export function resolveCapsuleOpenPath(
  fileUuid: string,
  fileUuidPaths: Record<string, string>,
): string | null {
  return (
    openFileRegistry.getByFileUuid(fileUuid)?.store.getState().filePath ??
    fileUuidPaths[fileUuid] ??
    null
  )
}
