import fs from 'node:fs'
import path from 'node:path'
import { atomicWrite } from './atomicWrite.js'
import type { FsResult, RecentFileEntry, WorkspaceState } from './types.js'

export const DEFAULT_WORKSPACE_STATE: WorkspaceState = {
  lastOpenedFilePath: null,
  expandedFolderPaths: [],
  recentFiles: [],
}

/** Coerce an untrusted value into a valid `lastOpenedFilePath` (string or null). */
export function coerceLastOpenedFilePath(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/** Coerce an untrusted value into a valid `expandedFolderPaths` (array of strings). */
export function coerceExpandedFolderPaths(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((p): p is string => typeof p === 'string') : []
}

/** Coerce an untrusted value into valid recent file entries. */
export function coerceRecentFiles(value: unknown): RecentFileEntry[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (entry): entry is RecentFileEntry =>
      entry != null &&
      typeof entry === 'object' &&
      typeof (entry as Record<string, unknown>).filePath === 'string' &&
      typeof (entry as Record<string, unknown>).title === 'string' &&
      typeof (entry as Record<string, unknown>).lastOpenedAt === 'string',
  )
}

const STATE_FILE = 'state.json'
const MINDLANE_DIR = '.mindlane'

export class Workspace {
  private cache = new Map<string, WorkspaceState>()
  private writeQueue = new Map<string, Promise<void>>()

  private statePath(workspacePath: string): string {
    return path.join(workspacePath, MINDLANE_DIR, STATE_FILE)
  }

  async load(workspacePath: string): Promise<FsResult<WorkspaceState>> {
    const pending = this.writeQueue.get(workspacePath)
    if (pending) await pending

    return this.loadFromDisk(workspacePath)
  }

  async openFile(
    workspacePath: string,
    filePath: string,
    title: string,
    maxEntries: number,
  ): Promise<FsResult<void>> {
    return this.saveState(workspacePath, async () => {
      const current = await this.loadFromDisk(workspacePath)
      const state = current.ok ? current.data : { ...DEFAULT_WORKSPACE_STATE }
      const filtered = state.recentFiles.filter((recentFile) => recentFile.filePath !== filePath)
      filtered.unshift({
        filePath,
        title,
        lastOpenedAt: new Date().toISOString(),
      })
      return {
        lastOpenedFilePath: filePath,
        recentFiles: filtered.slice(0, maxEntries),
      }
    })
  }

  async clearLastOpenedFile(workspacePath: string): Promise<FsResult<void>> {
    return this.saveState(workspacePath, async () => ({
      lastOpenedFilePath: null,
    }))
  }

  async updateExpandedFolders(workspacePath: string, paths: string[]): Promise<FsResult<void>> {
    return this.saveState(workspacePath, async () => ({
      expandedFolderPaths: paths,
    }))
  }

  /**
   * One-time migration helper: write legacy workspace-scoped keys that were
   * previously stored in global settings.json. The written state is still
   * subject to the normal validation rules on the next load.
   */
  async migrateLegacyState(
    workspacePath: string,
    partial: Partial<WorkspaceState>,
  ): Promise<FsResult<void>> {
    return this.saveState(workspacePath, async () => partial)
  }

  async getRecentFiles(workspacePath: string): Promise<FsResult<RecentFileEntry[]>> {
    const result = await this.load(workspacePath)
    if (!result.ok) return result
    return { ok: true, data: result.data.recentFiles }
  }

  async pruneRecentFiles(workspacePath: string): Promise<FsResult<void>> {
    return this.saveState(workspacePath, async () => {
      const current = await this.loadFromDisk(workspacePath)
      const state = current.ok ? current.data : { ...DEFAULT_WORKSPACE_STATE }
      const valid = state.recentFiles.filter((entry) => {
        try {
          return fs.existsSync(entry.filePath)
        } catch {
          return false
        }
      })
      return { recentFiles: valid }
    })
  }

  private async saveState(
    workspacePath: string,
    updater: () => Promise<Partial<WorkspaceState>>,
  ): Promise<FsResult<void>> {
    const previous = this.writeQueue.get(workspacePath) ?? Promise.resolve()
    const operation = previous.catch(() => {}).then(async () => {
      const partial = await updater()
      const current = await this.loadFromDisk(workspacePath)
      const next: WorkspaceState = { ...(current.ok ? current.data : { ...DEFAULT_WORKSPACE_STATE }), ...partial }
      const statePath = this.statePath(workspacePath)
      await fs.promises.mkdir(path.dirname(statePath), { recursive: true })
      await atomicWrite(statePath, JSON.stringify(next, null, 2))
      this.cache.set(workspacePath, next)
    })
    this.writeQueue.set(workspacePath, operation)
    try {
      await operation
      return { ok: true, data: undefined }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    } finally {
      if (this.writeQueue.get(workspacePath) === operation) {
        this.writeQueue.delete(workspacePath)
      }
    }
  }

  private async loadFromDisk(workspacePath: string): Promise<FsResult<WorkspaceState>> {
    const statePath = this.statePath(workspacePath)
    try {
      if (fs.existsSync(statePath)) {
        const raw = await fs.promises.readFile(statePath, 'utf-8')
        const parsed = JSON.parse(raw) as Partial<WorkspaceState>
        const rawLastOpenedFilePath = coerceLastOpenedFilePath(parsed.lastOpenedFilePath)
        const lastOpenedFilePath = this.resolveLastOpenedFilePath(rawLastOpenedFilePath, workspacePath)
        const corrected = lastOpenedFilePath !== rawLastOpenedFilePath
        const merged: WorkspaceState = {
          lastOpenedFilePath,
          expandedFolderPaths: coerceExpandedFolderPaths(parsed.expandedFolderPaths),
          recentFiles: coerceRecentFiles(parsed.recentFiles),
        }
        this.cache.set(workspacePath, merged)
        if (corrected) {
          await atomicWrite(statePath, JSON.stringify(merged, null, 2))
        }
        return { ok: true, data: { ...merged } }
      }
    } catch {
      // fall through to defaults
    }
    return { ok: true, data: { ...DEFAULT_WORKSPACE_STATE } }
  }

  private resolveLastOpenedFilePath(candidate: string | null, workspacePath: string): string | null {
    if (
      candidate &&
      this.pathExists(candidate) &&
      this.isSupportedFile(candidate) &&
      this.isWithinWorkspace(candidate, workspacePath)
    ) {
      return candidate
    }
    return null
  }

  private pathExists(filePath: string): boolean {
    try {
      return fs.existsSync(filePath)
    } catch {
      return false
    }
  }

  private isSupportedFile(filePath: string): boolean {
    return path.extname(filePath).toLowerCase() === '.mindlane'
  }

  private isWithinWorkspace(filePath: string, workspacePath: string): boolean {
    const resolvedWorkspacePath = path.resolve(workspacePath)
    const resolvedFilePath = path.resolve(filePath)
    const relativePath = path.relative(resolvedWorkspacePath, resolvedFilePath)
    return relativePath !== '' && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)
  }
}
