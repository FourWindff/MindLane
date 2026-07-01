import fs from 'node:fs'
import path from 'node:path'
import type { AppSettings, WorkspaceState } from './types.js'
import { DEFAULT_SETTINGS } from './types.js'
import { atomicWrite } from './atomicWrite.js'
import { coerceLastOpenedFilePath, coerceExpandedFolderPaths } from './workspaceStateManager.js'

export class SettingsManager {
  private filePath: string
  private cache: AppSettings | null = null

  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, 'settings.json')
  }

  async load(): Promise<AppSettings> {
    if (this.cache) return this.cache
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = await fs.promises.readFile(this.filePath, 'utf-8')
        const parsed = JSON.parse(raw) as Partial<AppSettings>
        this.cache = this.merge(parsed)
        return this.cache
      }
    } catch {
      /* fall through to defaults */
    }
    this.cache = { ...DEFAULT_SETTINGS }
    return this.cache
  }

  async update(partial: Partial<AppSettings>): Promise<void> {
    const current = await this.load()
    const merged = { ...current, ...partial }
    // Deep merge providerConfigs to preserve existing provider configurations
    if (partial.providerConfigs) {
      const mergedConfigs = { ...current.providerConfigs }
      for (const [key, value] of Object.entries(partial.providerConfigs)) {
        mergedConfigs[key] = {
          ...mergedConfigs[key],
          ...value,
          messagePipeline: {
            ...mergedConfigs[key]?.messagePipeline,
            ...value?.messagePipeline,
          },
        }
      }
      merged.providerConfigs = mergedConfigs
    }
    this.cache = this.merge(merged)
    await atomicWrite(this.filePath, JSON.stringify(this.cache, null, 2))
  }

  async reset(): Promise<void> {
    this.cache = { ...DEFAULT_SETTINGS }
    await atomicWrite(this.filePath, JSON.stringify(this.cache, null, 2))
  }

  /**
   * One-time migration: read legacy workspace-scoped keys from global settings.json
   * and remove them. Returns null if no legacy keys exist or if the last workspace
   * does not match the requested path.
   */
  async migrateLegacyWorkspaceState(workspacePath: string): Promise<Partial<WorkspaceState> | null> {
    const current = await this.load()
    if (!current.lastWorkspacePath || path.resolve(current.lastWorkspacePath) !== path.resolve(workspacePath)) {
      return null
    }

    const raw = await this.readRaw()
    const migrated: Partial<WorkspaceState> = {}
    let hasLegacy = false

    if ('lastOpenedFilePath' in raw) {
      migrated.lastOpenedFilePath = coerceLastOpenedFilePath(raw.lastOpenedFilePath)
      hasLegacy = true
    }
    if ('expandedFolderPaths' in raw) {
      migrated.expandedFolderPaths = coerceExpandedFolderPaths(raw.expandedFolderPaths)
      hasLegacy = true
    }

    if (!hasLegacy) return null

    const cleaned = { ...raw }
    delete cleaned.lastOpenedFilePath
    delete cleaned.expandedFolderPaths
    this.cache = this.merge(cleaned as Partial<AppSettings>)
    await atomicWrite(this.filePath, JSON.stringify(this.cache, null, 2))
    return migrated
  }

  private async readRaw(): Promise<Record<string, unknown>> {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = await fs.promises.readFile(this.filePath, 'utf-8')
        return JSON.parse(raw) as Record<string, unknown>
      }
    } catch {
      /* fall through */
    }
    return {}
  }

  private merge(partial: Partial<AppSettings>): AppSettings {
    return {
      apiKey: partial.apiKey ?? DEFAULT_SETTINGS.apiKey,
      chatModel: partial.chatModel ?? DEFAULT_SETTINGS.chatModel,
      activeProviders: {
        ...DEFAULT_SETTINGS.activeProviders,
        ...partial.activeProviders,
      },
      providerConfigs: partial.providerConfigs ?? DEFAULT_SETTINGS.providerConfigs,
      editor: {
        ...DEFAULT_SETTINGS.editor,
        ...partial.editor,
      },
      recentFilesMax: partial.recentFilesMax ?? DEFAULT_SETTINGS.recentFilesMax,
      lastWorkspacePath: partial.lastWorkspacePath ?? DEFAULT_SETTINGS.lastWorkspacePath,
      recentWorkspacePaths: partial.recentWorkspacePaths ?? DEFAULT_SETTINGS.recentWorkspacePaths,
      restoreLastWorkspaceOnLaunch:
        partial.restoreLastWorkspaceOnLaunch ?? DEFAULT_SETTINGS.restoreLastWorkspaceOnLaunch,
      messagePipeline: partial.messagePipeline,
    }
  }
}
