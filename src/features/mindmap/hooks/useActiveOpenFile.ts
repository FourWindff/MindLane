import { createContext, useContext } from 'react'
import type { MindmapHistory } from '@/features/mindmap/model/history'
import type { MindmapEditor } from '@/features/mindmap/model/editor'
import type { MindmapStore, OpenFileState } from '@/features/mindmap/model/store'

export interface ActiveOpenFile {
  key: string
  store: MindmapStore
  history: MindmapHistory
  editor: MindmapEditor
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
