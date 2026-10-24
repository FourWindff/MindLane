import { ProjectFileManager } from './projectFileManager.js'
import { AppState } from './appState.js'
import { WorkspaceTree } from './workspaceTree.js'
import { ThumbnailManager } from './thumbnailManager.js'
import { Workspace } from './workspace.js'
import type { InternalStateStore } from '../store/internalStore.js'

export class FileSystemService {
  readonly project: ProjectFileManager
  readonly appState: AppState
  readonly workspace: Workspace
  readonly workspaceTree: WorkspaceTree
  readonly thumbnails: ThumbnailManager

  constructor(userDataPath: string, stateStore?: InternalStateStore) {
    this.appState = new AppState(userDataPath)
    this.project = new ProjectFileManager(this.appState)
    this.workspace = new Workspace(this.appState, stateStore)
    this.thumbnails = new ThumbnailManager(userDataPath)
    this.workspaceTree = new WorkspaceTree(this.thumbnails)
  }

  async initialize(): Promise<void> {
    await this.thumbnails.initialize()
    await this.appState.load()
  }
}
