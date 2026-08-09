import type { MindmapInstance } from './mindmapInstance'

export interface SaveMindmapInstanceOptions {
  syncAfterFileSaved: (filePath: string) => Promise<void>
  onError?: (message: string) => void
  afterSave?: (filePath: string) => void
}

function formatError(error: unknown): string {
  return `保存失败：${error instanceof Error ? error.message : String(error)}`
}

/**
 * The single save protocol shared by every mindmap save path:
 * dirty-check -> guard snapshot -> serialize -> IPC save -> conditional
 * markClean -> syncAfterFileSaved -> afterSave.
 *
 * Only covers saving to a known filePath; null-filePath branches (save-as
 * dialog, silent workspace create) stay with the callers. Error routing is
 * injected via onError so this module has no chat-feature dependency.
 */
export async function saveMindmapInstance(
  instance: Pick<MindmapInstance, 'store'>,
  options: SaveMindmapInstanceOptions,
): Promise<boolean> {
  const onError = options?.onError ?? ((message: string) => console.error(message))
  const state = instance.store.getState()
  if (!state.hasDocumentOpen || !state.dirty) return true
  if (!state.filePath) {
    onError('导图尚未关联文件，无法保存')
    return false
  }

  try {
    // Save guard: snapshot references before the IPC round-trip; only
    // markClean if nodes/edges/documentRefs are untouched afterwards.
    const savedNodes = state.nodes
    const savedEdges = state.edges
    const savedDocumentRefs = state.documentRefs
    const result = await window.mindlane?.file.save({
      filePath: state.filePath,
      data: state.toMindLaneFile(),
    })
    if (!result?.ok) {
      onError(result?.error ?? '保存失败')
      return false
    }
    const latest = instance.store.getState()
    latest.setFilePath(result.data.filePath)
    if (
      latest.nodes === savedNodes &&
      latest.edges === savedEdges &&
      latest.documentRefs === savedDocumentRefs
    ) {
      latest.markClean()
    }
    await options.syncAfterFileSaved(result.data.filePath)
    options?.afterSave?.(result.data.filePath)
    return true
  } catch (error) {
    onError(formatError(error))
    return false
  }
}
