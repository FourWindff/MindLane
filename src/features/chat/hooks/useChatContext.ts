import { useRef, useCallback } from 'react'
import { useActiveMindmapInstance } from '@/features/mindmap/hooks/useActiveMindmapInstance'
import { useActiveMindmapEditor } from '@/features/mindmap/hooks/useActiveMindmapEditor'
import { useWorkspaceStore } from '@/features/workspace/store'
import { useSettingsStore } from '@/features/settings/model/settingsStore'
import { useAiStore } from '@/features/chat/model/aiStore'
import { extractNodeInfo } from '@/features/chat/lib/chatUtils'
import type { ContextNodeInfo } from '@/features/chat/lib/chatUtils'
import type { DocumentRef } from '@/shared/lib/fileFormat'

function useShallowById<T, U extends { id: string }>(
  selector: (state: T) => U[],
): (state: T) => U[] {
  const prev = useRef<U[]>()
  return (state) => {
    const next = selector(state)
    if (
      prev.current &&
      prev.current.length === next.length &&
      prev.current.every((n, i) => n.id === next[i]!.id)
    ) {
      return prev.current
    }
    prev.current = next
    return next
  }
}

interface ChatContext {
  mindmapSummary?: string
  selectedNodes?: ContextNodeInfo[]
  filePath?: string
  fileTitle?: string
  hasDocumentOpen?: boolean
  workspacePath?: string
  workspaceFiles?: { name: string; filePath: string }[]
  /** Attached document reference for mindmap generation */
  attachedDocument?: DocumentRef
  /** Documents already linked to the current mindmap file */
  linkedDocuments?: DocumentRef[]
}

export interface QuickAction {
  label: string
  prompt: string
}

export function useChatContext() {
  const apiKey = useSettingsStore((s) => s.apiKey)
  const capabilities = useSettingsStore((s) => s.capabilities)

  const activeInstance = useActiveMindmapInstance()
  const selectedNodes = activeInstance.store(
    useShallowById((s) => s.nodes.filter((n) => n.selected)),
  )

  const editor = useActiveMindmapEditor()

  const buildContext = useCallback((): ChatContext => {
    const mindmapState = activeInstance.store.getState()
    const wsState = useWorkspaceStore.getState()
    const ctx: ChatContext = {}

    if (mindmapState.filePath) ctx.filePath = mindmapState.filePath
    if (mindmapState.fileTitle) ctx.fileTitle = mindmapState.fileTitle
    ctx.hasDocumentOpen = mindmapState.hasDocumentOpen

    if (typeof mindmapState.getContextSummary === 'function') {
      ctx.mindmapSummary = mindmapState.getContextSummary()
    }

    if (mindmapState.documentRefs.length > 0) {
      ctx.linkedDocuments = mindmapState.documentRefs.map((doc) => ({ ...doc }))
    }

    const selected = mindmapState.nodes.filter((n) => n.selected)
    if (selected.length > 0) {
      ctx.selectedNodes = selected.map(extractNodeInfo)
    }

    if (wsState.workspacePath) {
      ctx.workspacePath = wsState.workspacePath
      ctx.workspaceFiles = wsState.files.map((f) => ({
        name: f.name,
        filePath: f.filePath,
      }))
    }

    // Include attached document reference
    const aiState = useAiStore.getState()
    if (aiState.attachedDocument) {
      ctx.attachedDocument = aiState.attachedDocument
    }

    return ctx
  }, [activeInstance])

  const clearNodeSelection = useCallback(() => {
    editor.clearNodeSelection()
  }, [editor])

  const features = ['生成思维导图']
  if (capabilities.includes('embeddings')) {
    features.unshift('检索知识库')
  }
  if (capabilities.includes('imageGen') && capabilities.includes('vision')) {
    features.push('生成记忆宫殿')
  } else if (capabilities.includes('imageGen')) {
    features.push('生成图片')
  }

  const emptyHint = `AI 助手可以${features.join('、')}`

  const quickActions: QuickAction[] = [
    { label: '生成思维导图', prompt: '请帮我生成一个思维导图' },
    { label: '总结内容', prompt: '请总结当前思维导图的内容' },
    { label: '头脑风暴', prompt: '请帮我进行头脑风暴，生成一些创意想法' },
    { label: '优化结构', prompt: '请帮我优化当前思维导图的结构' },
  ]

  return {
    apiKey,
    capabilities,
    selectedNodes,
    buildContext,
    clearNodeSelection,
    emptyHint,
    quickActions,
  }
}
