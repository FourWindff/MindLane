import { createContext, useContext } from 'react'
import type { MindmapHistory } from '@/features/mindmap/model/mindmapHistory'
import type { MindmapEditor } from '@/features/mindmap/model/mindmapEditor'
import type { MindmapStore } from '@/features/mindmap/model/mindmapStore'

export interface ActiveMindmapInstance {
  key: string
  store: MindmapStore
  history: MindmapHistory
  editor: MindmapEditor
}

export const MindmapInstanceContext = createContext<ActiveMindmapInstance | null>(null)

export function useActiveMindmapInstance(): ActiveMindmapInstance {
  const instance = useContext(MindmapInstanceContext)
  if (!instance) {
    throw new Error('useActiveMindmapInstance must be used within MindmapEditorProvider')
  }
  return instance
}
