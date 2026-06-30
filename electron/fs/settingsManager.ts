import fs from 'node:fs'
import path from 'node:path'
import type { AppSettings } from './types.js'
import { DEFAULT_SETTINGS } from './types.js'
import { atomicWrite } from './atomicWrite.js'

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
