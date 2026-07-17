import fs from 'node:fs'
import path from 'node:path'
import type { AppSettings, FsResult, WorkspaceState } from './types.js'
import { DEFAULT_SETTINGS } from './types.js'
import { atomicWrite } from './atomicWrite.js'
import { coerceLastOpenedFilePath, coerceExpandedFolderPaths } from './workspace.js'

export class AppState {
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

  async update(partial: Partial<AppSettings>): Promise<FsResult<void>> {
    try {
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
      return { ok: true, data: undefined }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  async reset(): Promise<FsResult<void>> {
    try {
      this.cache = { ...DEFAULT_SETTINGS }
      await atomicWrite(this.filePath, JSON.stringify(this.cache, null, 2))
      return { ok: true, data: undefined }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  async getRecentFilesMax(): Promise<number> {
    const settings = await this.load()
    return settings.recentFilesMax
  }

  /**
   * Compute the workspace session the app should launch into.
   * Dedupes and prunes stale recent-workspace entries, clears an invalid
   * lastWorkspacePath, and persists any corrections.
   */
  async getLaunchSession(): Promise<
    FsResult<{
      workspacePath: string | null
      recentWorkspacePaths: string[]
      restoreLastWorkspaceOnLaunch: boolean
    }>
  > {
    try {
      const settings = await this.load()
      const recentWorkspacePaths = this.dedupeWorkspacePaths(
        settings.recentWorkspacePaths,
        settings.recentFilesMax,
      )

      const lastWorkspacePath = settings.lastWorkspacePath
        ? path.resolve(settings.lastWorkspacePath)
        : null
      const lastWorkspaceExists = lastWorkspacePath ? directoryExists(lastWorkspacePath) : false
      const workspacePath =
        settings.restoreLastWorkspaceOnLaunch && lastWorkspaceExists ? lastWorkspacePath : null

      const update: Partial<AppSettings> = {}
      if (settings.lastWorkspacePath && !lastWorkspaceExists) {
        update.lastWorkspacePath = null
      }
      if (JSON.stringify(recentWorkspacePaths) !== JSON.stringify(settings.recentWorkspacePaths)) {
        update.recentWorkspacePaths = recentWorkspacePaths
      }
      if (Object.keys(update).length > 0) {
        const updateResult = await this.update(update)
        if (!updateResult.ok) return updateResult
      }

      return {
        ok: true,
        data: {
          workspacePath,
          recentWorkspacePaths,
          restoreLastWorkspaceOnLaunch: settings.restoreLastWorkspaceOnLaunch,
        },
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  /**
   * Switch to a workspace: update lastWorkspacePath and deduplicate
   * recentWorkspacePaths.
   */
  async switchWorkspace(workspacePath: string): Promise<FsResult<void>> {
    try {
      const settings = await this.load()
      const recentWorkspacePaths = this.dedupeWorkspacePaths(
        [workspacePath, ...settings.recentWorkspacePaths],
        settings.recentFilesMax,
      )
      return this.update({
        lastWorkspacePath: workspacePath,
        recentWorkspacePaths,
      })
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  async claimWorkspaceUuid(workspacePath: string, candidateUuid?: string): Promise<string> {
    const resolvedPath = path.resolve(workspacePath)
    const settings = await this.load()
    let workspaceUuid = candidateUuid ?? crypto.randomUUID()
    const indexedPath = settings.workspacePathsByUuid[workspaceUuid]

    if (indexedPath && path.resolve(indexedPath) !== resolvedPath && directoryExists(indexedPath)) {
      workspaceUuid = crypto.randomUUID()
    }

    await this.update({
      workspacePathsByUuid: {
        ...settings.workspacePathsByUuid,
        [workspaceUuid]: resolvedPath,
      },
    })
    return workspaceUuid
  }

  async claimFileUuid(filePath: string, candidateUuid: string): Promise<string> {
    const resolvedPath = path.resolve(filePath)
    const settings = await this.load()
    let fileUuid = candidateUuid
    const indexedPath = settings.filePathsByUuid[fileUuid]
    if (indexedPath && path.resolve(indexedPath) !== resolvedPath && fs.existsSync(indexedPath)) {
      fileUuid = crypto.randomUUID()
    }
    await this.update({
      filePathsByUuid: { ...settings.filePathsByUuid, [fileUuid]: resolvedPath },
    })
    return fileUuid
  }

  /**
   * One-time migration: read legacy workspace-scoped keys from global settings.json
   * and remove them. Returns null if no legacy keys exist or if the last workspace
   * does not match the requested path.
   */
  async migrateLegacyWorkspaceState(
    workspacePath: string,
  ): Promise<FsResult<Partial<WorkspaceState> | null>> {
    try {
      const current = await this.load()
      if (
        !current.lastWorkspacePath ||
        path.resolve(current.lastWorkspacePath) !== path.resolve(workspacePath)
      ) {
        return { ok: true, data: null }
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

      if (!hasLegacy) return { ok: true, data: null }

      const cleaned = { ...raw }
      delete cleaned.lastOpenedFilePath
      delete cleaned.expandedFolderPaths
      this.cache = this.merge(cleaned as Partial<AppSettings>)
      await atomicWrite(this.filePath, JSON.stringify(this.cache, null, 2))
      return { ok: true, data: migrated }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
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

  private dedupeWorkspacePaths(paths: string[], maxEntries: number): string[] {
    const unique = new Set<string>()
    const result: string[] = []
    for (const targetPath of paths) {
      const resolvedPath = path.resolve(targetPath)
      if (unique.has(resolvedPath) || !directoryExists(resolvedPath)) continue
      unique.add(resolvedPath)
      result.push(resolvedPath)
      if (result.length >= maxEntries) break
    }
    return result
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
      workspacePathsByUuid: partial.workspacePathsByUuid ?? DEFAULT_SETTINGS.workspacePathsByUuid,
      filePathsByUuid: partial.filePathsByUuid ?? DEFAULT_SETTINGS.filePathsByUuid,
      messagePipeline: partial.messagePipeline,
      mcpServers: partial.mcpServers ?? DEFAULT_SETTINGS.mcpServers,
    }
  }
}

function directoryExists(targetPath: string | null | undefined): boolean {
  if (!targetPath) return false
  try {
    return fs.statSync(targetPath).isDirectory()
  } catch {
    return false
  }
}
