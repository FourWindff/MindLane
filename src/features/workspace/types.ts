export interface WorkspaceFileEntry {
  filePath: string
  name: string
  lastModifiedAt: string
}

export interface WorkspaceTreeEntry {
  name: string
  path: string
  type: 'file' | 'directory'
  lastModifiedAt: string
  children?: WorkspaceTreeEntry[]
  previewUrl?: string
}

export interface WorkspaceSessionState {
  workspacePath: string | null
  workspaceUuid?: string | null
  activeSessionIds?: Record<string, string>
  recentWorkspacePaths: string[]
  lastOpenedFilePath: string | null
  expandedFolderPaths: string[]
  restoreLastWorkspaceOnLaunch: boolean
}
