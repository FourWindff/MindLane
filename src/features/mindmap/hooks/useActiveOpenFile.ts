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
 * 「当前打开的文件正在被 AI 写入」。读的是打开的文件自己的标记（chat 投影写入），
 * 不订阅导图 store —— 忙闲切换不会惊动自动保存。
 */
export function useActiveFileAiWriting(): boolean {
  const instance = useActiveOpenFile()
  return useSyncExternalStore(
    (listener) => instance.subscribeAiWriting(listener),
    () => instance.isAiWriting(),
  )
}
