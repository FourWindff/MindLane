import { createEmptyFile } from '@contracts/fileFormat'
import { createFileChatState, useAiStore, type FileChatState } from '@/features/chat/model/aiStore'
import { openFileRegistry } from '@/features/mindmap/model/openFileRegistry'

/** Minimal stand-in for the active-file registry: only the subscriber loop and the active file. */
export function createRegistryHarness() {
  let listener: (() => void) | undefined
  let active: { fileUuid: string; filePath: string; fileTitle: string } | null = null
  return {
    registry: {
      getActiveFile: () => active,
      subscribe: (next: () => void) => {
        listener = next
        return () => {
          listener = undefined
        }
      },
    },
    activate(fileUuid: string, filePath: string, fileTitle: string) {
      active = { fileUuid, filePath, fileTitle }
      listener?.()
    },
  }
}

/**
 * Source invariant: a send always has an active file. Registers a mindmap
 * instance whose uuid/path/title exist from creation and points both the
 * registry and the chat store at it.
 */
export function activateFile(fileUuid: string, overrides?: Partial<FileChatState>) {
  const key = `test-${fileUuid}`
  const instance = openFileRegistry.getOrCreate(key)
  const file = createEmptyFile('Test mindmap')
  file.metadata.fileUuid = fileUuid
  instance.store.getState().loadFile(`/${fileUuid}.mindlane`, file, '/workspace')
  openFileRegistry.setActive(key)
  useAiStore.setState({
    currentFileUuid: fileUuid,
    currentFilePath: `/${fileUuid}.mindlane`,
    fileChats: { [fileUuid]: { ...createFileChatState('session-a'), ...overrides } },
    sessionFileUuids: { 'session-a': fileUuid },
  })
  return instance
}
