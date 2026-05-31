import { MindLaneEdge, MindLaneNode, type DocumentRef } from '@/shared/lib/fileFormat'

export interface ContextNodeInfo {
  id: string
  type: 'text' | 'palace'
  label: string
  extra?: Record<string, unknown>
}

export interface WorkspaceFileInfo {
  name: string
  filePath: string
}

export interface MindmapContextData {
  mindmapSummary?: string
  selectedNodes?: ContextNodeInfo[]
  allNodes?: MindLaneNode[]
  allEdges?: MindLaneEdge[]
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
