import { createContext, useContext, useSyncExternalStore } from 'react'
import type { MindmapHistory } from '@/features/mindmap/model/history'
import type { MindmapEditor } from '@/features/mindmap/model/editor'
import type { MindmapStore, OpenFileState } from '@/features/mindmap/model/store'

export interface ActiveOpenFile {
  key: string
  store: MindmapStore
  history: MindmapHistory
  editor: MindmapEditor
  isAiWriting(): boolean
  subscribeAiWriting(listener: () => void): () => void
}

export const OpenFileContext = createContext<ActiveOpenFile | null>(null)

export function useActiveOpenFile(): ActiveOpenFile {
  const openFile = useContext(OpenFileContext)
  if (!openFile) {
    throw new Error('useActiveOpenFile must be used within MindmapEditorProvider')
  }
  return openFile
}

export function useActiveMindmapEditor(): MindmapEditor {
  return useActiveOpenFile().editor
}

export function useActiveMindmapStore<T>(selector: (state: OpenFileState) => T): T {
  return useActiveOpenFile().store(selector)
}

/**
 * "The currently open file is being written by AI". This reads the open file's own flag (written by
 * the chat projection) and does not subscribe to the mindmap store -- toggling busy/idle never
 * wakes auto-save.
 */
export function useActiveFileAiWriting(): boolean {
  const instance = useActiveOpenFile()
  return useSyncExternalStore(
    (listener) => instance.subscribeAiWriting(listener),
    () => instance.isAiWriting(),
  )
}
