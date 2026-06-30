import fs from 'node:fs'
import path from 'node:path'
import { atomicWrite } from './atomicWrite.js'
import type { WorkspaceState } from './types.js'

const STATE_FILE = 'state.json'
const MINDLANE_DIR = '.mindlane'

const DEFAULT_WORKSPACE_STATE: WorkspaceState = {
  lastOpenedFilePath: null,
  expandedFolderPaths: [],
}

export class WorkspaceStateManager {
  private cache = new Map<string, WorkspaceState>()

  private statePath(workspacePath: string): string {
    return path.join(workspacePath, MINDLANE_DIR, STATE_FILE)
  }

  async load(workspacePath: string): Promise<WorkspaceState> {
    const cached = this.cache.get(workspacePath)
    if (cached) return cached

    const statePath = this.statePath(workspacePath)
    try {
      if (fs.existsSync(statePath)) {
        const raw = await fs.promises.readFile(statePath, 'utf-8')
        const parsed = JSON.parse(raw) as Partial<WorkspaceState>
        const merged: WorkspaceState = {
          lastOpenedFilePath:
            typeof parsed.lastOpenedFilePath === 'string'
              ? parsed.lastOpenedFilePath
              : parsed.lastOpenedFilePath === null
                ? null
                : DEFAULT_WORKSPACE_STATE.lastOpenedFilePath,
          expandedFolderPaths: Array.isArray(parsed.expandedFolderPaths)
            ? parsed.expandedFolderPaths.filter((p): p is string => typeof p === 'string')
            : DEFAULT_WORKSPACE_STATE.expandedFolderPaths,
        }
        this.cache.set(workspacePath, merged)
        return merged
      }
    } catch {
      // fall through to defaults
    }
    return { ...DEFAULT_WORKSPACE_STATE }
  }

  async save(workspacePath: string, partial: Partial<WorkspaceState>): Promise<void> {
    const current = await this.load(workspacePath)
    const next: WorkspaceState = { ...current, ...partial }
    const statePath = this.statePath(workspacePath)
    await fs.promises.mkdir(path.dirname(statePath), { recursive: true })
    await atomicWrite(statePath, JSON.stringify(next, null, 2))
    this.cache.set(workspacePath, next)
  }

  invalidateCache(workspacePath: string): void {
    this.cache.delete(workspacePath)
  }
}
