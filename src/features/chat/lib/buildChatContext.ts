import { mindmapRegistry } from '@/features/mindmap/model/mindmapRegistry'
import { useWorkspaceStore } from '@/features/workspace/store'
import { useAiStore } from '@/features/chat/model/aiStore'
import { extractNodeInfo } from '@/features/chat/lib/chatUtils'
import type { ChatContext } from '../../../../electron/preload'

/**
 * Build the ChatContext for a chat send with no React hook dependencies.
 * Reads the active mindmap instance, workspace state, and aiStore directly so
 * the sendChatMessage store action can call it outside any component.
 */
export function buildChatContext(): ChatContext {
  const instance = mindmapRegistry.getActive() ?? mindmapRegistry.getDefault()
  const mindmapState = instance.store.getState()
  const wsState = useWorkspaceStore.getState()
  const ctx: ChatContext = { fileUuid: mindmapState.fileUuid ?? '' }

  if (!ctx.fileUuid) return ctx
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

  const aiState = useAiStore.getState()
  if (aiState.attachedDocument) {
    ctx.attachedDocument = aiState.attachedDocument
  }

  return ctx
}
