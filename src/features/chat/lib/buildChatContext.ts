import { openFileRegistry } from '@/features/mindmap/model/openFileRegistry'
import { useWorkspaceStore } from '@/features/workspace/store'
import type { WorkspaceTreeEntry } from '@/features/workspace/types'
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
 * Source invariant: an active file always exists at call time. With a file it is
 * used directly; without one the send path goes through the entry branch first,
 * which creates and opens a new file (editor ready) before reaching here, so this
 * function has no default-instance fallback and no empty-uuid early return. The
 * mindmap summary (mindmapSummary) was removed: the model calls read tools on
 * demand when it needs structure.
 */
export function buildChatContext(): ChatContext {
  const instance = openFileRegistry.getActive()
  if (!instance) {
    throw new Error('No file is open, cannot start a chat')
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
