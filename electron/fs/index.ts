import path from 'node:path'
import { ProjectFileManager } from './projectFileManager.js'
import { CacheManager } from './cacheManager.js'
import { AppState } from './appState.js'
import { WorkspaceTree } from './workspaceTree.js'
import { ThumbnailManager } from './thumbnailManager.js'
import { Workspace } from './workspace.js'

export class FileSystemService {
  readonly project: ProjectFileManager
  readonly cache: CacheManager
  readonly appState: AppState
  readonly workspace: Workspace
  readonly workspaceTree: WorkspaceTree
  readonly thumbnails: ThumbnailManager

  constructor(userDataPath: string) {
    this.project = new ProjectFileManager(userDataPath)
    this.cache = new CacheManager(path.join(userDataPath, 'cache'))
    this.appState = new AppState(userDataPath)
    this.workspace = new Workspace()
    this.workspaceTree = new WorkspaceTree()
    this.thumbnails = new ThumbnailManager(userDataPath)
  }

  async initialize(): Promise<void> {
    await this.project.initialize()
    await this.cache.initialize()
    await this.thumbnails.initialize()
    const settings = await this.appState.load()
    if (settings.editor.cachePruneDays > 0) {
      await this.cache.pruneOldCache(settings.editor.cachePruneDays).catch(() => {})
    }
  }
}
