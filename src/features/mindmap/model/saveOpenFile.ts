import type { MindmapStore } from './store'

interface SaveOpenFileOptions {
  syncAfterFileSaved: (filePath: string) => Promise<void>
  onError?: (message: string) => void
  afterSave?: (filePath: string) => void
}

function formatError(error: unknown): string {
  return `Save failed: ${error instanceof Error ? error.message : String(error)}`
}

/**
 * The single save protocol shared by every mindmap save path:
 * dirty-check -> document snapshot -> IPC save -> version-guarded markClean ->
 * syncAfterFileSaved -> afterSave.
 *
 * The input is the document snapshot (version + document value), never the
 * renderer's view projection: drag previews, editing flags and selection stay
 * out of the file. The save guard compares document versions, so a change that
 * lands while saving keeps the document dirty for the next autosave - the
 * protocol never retries on its own. The document service re-checks the same
 * version when acknowledging the save.
 *
 * Only covers saving to a known filePath; null-filePath branches (save-as
 * dialog, silent workspace create) stay with the callers. Error routing is
 * injected via onError so this module has no chat-feature dependency.
 */
export async function saveOpenFile(
  store: MindmapStore,
  options: SaveOpenFileOptions,
): Promise<boolean> {
  const onError = options?.onError ?? ((message: string) => console.error(message))
  const state = store.getState()
  if (!state.hasDocumentOpen || !state.dirty) return true
  if (!state.filePath) {
    onError('The mindmap is not linked to a file yet, cannot save')
    return false
  }

  try {
    // Snapshot before the IPC round-trip: the guard only clears dirty when the
    // document still shows this version afterwards.
    const snapshot = state.documentSnapshot()
    const result = await window.mindlane?.file.save({
      filePath: state.filePath,
      data: state.toMindLaneFile(snapshot),
    })
    if (!result?.ok) {
      onError(result?.error ?? 'Save failed')
      return false
    }
    const latest = store.getState()
    latest.setFilePath(result.data.filePath)
    latest.markClean(snapshot.version)
    await options.syncAfterFileSaved(result.data.filePath)
    options?.afterSave?.(result.data.filePath)
    return true
  } catch (error) {
    onError(formatError(error))
    return false
  }
}
