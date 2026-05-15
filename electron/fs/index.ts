import path from 'node:path'
import { ProjectFileManager } from './projectFileManager.js'
import { CacheManager } from './cacheManager.js'
import { SettingsManager } from './settingsManager.js'
import { RecentFilesManager } from './recentFilesManager.js'
import { WorkspaceManager } from './workspaceManager.js'
import { ThumbnailManager } from './thumbnailManager.js'

export class FileSystemService {
  readonly project: ProjectFileManager
  readonly cache: CacheManager
  readonly settings: SettingsManager
  readonly recentFiles: RecentFilesManager
  readonly workspace: WorkspaceManager
  readonly thumbnails: ThumbnailManager

  constructor(userDataPath: string) {
    this.project = new ProjectFileManager(userDataPath)
    this.cache = new CacheManager(path.join(userDataPath, 'cache'))
    this.settings = new SettingsManager(userDataPath)
    this.recentFiles = new RecentFilesManager(userDataPath)
    this.workspace = new WorkspaceManager()
    this.thumbnails = new ThumbnailManager(userDataPath)
  }

  async initialize(): Promise<void> {
    await this.project.initialize()
    await this.cache.initialize()
    await this.thumbnails.initialize()
    await this.recentFiles.prune()
    const settings = await this.settings.load()
    if (settings.editor.cachePruneDays > 0) {
      await this.cache.pruneOldCache(settings.editor.cachePruneDays).catch(() => {})
    }
  }
}

export { ProjectFileManager } from './projectFileManager.js'
export { CacheManager } from './cacheManager.js'
export { SettingsManager } from './settingsManager.js'
export { RecentFilesManager } from './recentFilesManager.js'
export { WorkspaceManager } from './workspaceManager.js'
export type {
  FsResult,
  RecentFileEntry,
  WorkspaceFileEntry,
  WorkspaceTreeEntry,
  WorkspaceSession,
  AppSettings,
  ProviderConfig,
} from './types.js'
