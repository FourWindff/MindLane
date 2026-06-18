import type { DocumentRef } from '@/shared/lib/fileFormat'

interface ContextNodeInfo {
  id: string
  type: 'text' | 'palace'
  label: string
  extra?: Record<string, unknown>
}

interface WorkspaceFileInfo {
  name: string
  filePath: string
}

export interface MindmapContextData {
  mindmapSummary?: string
  selectedNodes?: ContextNodeInfo[]
  filePath?: string
  fileTitle?: string
  hasDocumentOpen?: boolean
  workspacePath?: string
  workspaceFiles?: WorkspaceFileInfo[]
  /** Optional attached document reference for mindmap generation */
  attachedDocument?: DocumentRef
  /** Documents already linked to the currently opened .mindlane file */
  linkedDocuments?: DocumentRef[]
  /** Optional tags from the .mindlane file metadata */
  fileTags?: string[]
}
