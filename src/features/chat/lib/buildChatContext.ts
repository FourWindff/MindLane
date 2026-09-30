import { openFileRegistry } from '@/features/mindmap/model/openFileRegistry'
import { useWorkspaceStore } from '@/app/workspace/store'
import type { WorkspaceTreeEntry } from '@/app/workspace/types'
import { useAiStore } from '@/features/chat/model/aiStore'
import { extractNodeInfoCompact } from '@/features/chat/lib/chatUtils'
import type { ChatContext, WorkspaceFileInfo } from '@contracts/ipc'

/** Flatten the workspace tree to the file list the model sees (nested files included). */
function collectWorkspaceFiles(entries: WorkspaceTreeEntry[]): WorkspaceFileInfo[] {
  const result: WorkspaceFileInfo[] = []
  for (const entry of entries) {
    if (entry.type === 'file') result.push({ name: entry.name, filePath: entry.path })
    if (entry.children) result.push(...collectWorkspaceFiles(entry.children))
  }
  return result
}

/**
 * Build the ChatContext for a chat send with no React hook dependencies.
 * Reads the active mindmap instance, workspace state, and aiStore directly so
 * the sendChatMessage store action can call it outside any component.
 *
 * 源头不变量：调用时必有活动文件。有文件时直接用；没有文件时发送路径先经入口分支
 * 建并打开一个新文件（编辑器就绪）才走到这里，所以这里不兜底默认实例、不做空 uuid 早退。
 * 导图树摘要（mindmapSummary）已删除：模型需要结构时按需调用读工具。
 */
export function buildChatContext(): ChatContext {
  const instance = openFileRegistry.getActive()
  if (!instance) {
    throw new Error('没有打开的文件，无法发起对话')
  }
  const openFileState = instance.store.getState()
  const wsState = useWorkspaceStore.getState()
  const ctx: ChatContext = { fileUuid: openFileState.fileUuid }

  if (openFileState.filePath) ctx.filePath = openFileState.filePath
  if (openFileState.fileTitle) ctx.fileTitle = openFileState.fileTitle
  ctx.hasDocumentOpen = openFileState.hasDocumentOpen

  if (openFileState.documentRefs.length > 0) {
    ctx.linkedDocuments = openFileState.documentRefs.map((doc) => ({ ...doc }))
  }

  const selected = openFileState.nodes.filter((n) => n.selected)
  if (selected.length > 0) {
    ctx.selectedNodes = selected.map((n) =>
      extractNodeInfoCompact(n, openFileState.nodes, openFileState.edges),
    )
  }

  if (wsState.workspacePath) {
    ctx.workspacePath = wsState.workspacePath
    ctx.workspaceFiles = collectWorkspaceFiles(wsState.tree)
  }

  const aiState = useAiStore.getState()
  if (aiState.attachedDocument) {
    ctx.attachedDocument = aiState.attachedDocument
  }

  return ctx
}
