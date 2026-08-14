import { mindmapRegistry } from '@/features/mindmap/model/mindmapRegistry'
import { useWorkspaceStore } from '@/features/workspace/store'
import { useAiStore } from '@/features/chat/model/aiStore'
import { extractNodeInfo } from '@/features/chat/lib/chatUtils'
import type { ChatContext } from '../../../../electron/ipc'

/**
 * Build the ChatContext for a chat send with no React hook dependencies.
 * Reads the active mindmap instance, workspace state, and aiStore directly so
 * the sendChatMessage store action can call it outside any component.
 *
 * 源头不变量：发送必有活动文件（输入组件门控），因此这里不兜底默认实例、
 * 不做空 uuid 早退——调用时必有活动实例，其 fileUuid 创建即存在。
 * 导图树摘要（mindmapSummary）已删除：模型需要结构时按需调用读工具。
 */
export function buildChatContext(): ChatContext {
  const instance = mindmapRegistry.getActive()
  if (!instance) {
    throw new Error('没有打开的文件，无法发起对话')
  }
  const mindmapState = instance.store.getState()
  const wsState = useWorkspaceStore.getState()
  const ctx: ChatContext = { fileUuid: mindmapState.fileUuid }

  if (mindmapState.filePath) ctx.filePath = mindmapState.filePath
  if (mindmapState.fileTitle) ctx.fileTitle = mindmapState.fileTitle
  ctx.hasDocumentOpen = mindmapState.hasDocumentOpen

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
