import fs from 'node:fs'
import path from 'node:path'
import { atomicWrite } from './atomicWrite.js'
import type { WorkspaceState } from './types.js'

const STATE_FILE = 'state.json'
const MINDLANE_DIR = '.mindlane'

export const DEFAULT_WORKSPACE_STATE: WorkspaceState = {
  lastOpenedFilePath: null,
  expandedFolderPaths: [],
}

/** Coerce an untrusted value into a valid `lastOpenedFilePath` (string or null). */
export function coerceLastOpenedFilePath(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/** Coerce an untrusted value into a valid `expandedFolderPaths` (array of strings). */
export function coerceExpandedFolderPaths(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((p): p is string => typeof p === 'string') : []
}

export class WorkspaceStateManager {
  private cache = new Map<string, WorkspaceState>()
  private writeQueue = new Map<string, Promise<void>>()

  private statePath(workspacePath: string): string {
    return path.join(workspacePath, MINDLANE_DIR, STATE_FILE)
  }

  async load(workspacePath: string): Promise<WorkspaceState> {
    const pending = this.writeQueue.get(workspacePath)
    if (pending) await pending

    const cached = this.cache.get(workspacePath)
    if (cached) return { ...cached }

    return this.loadFromDisk(workspacePath)
  }

  private async loadFromDisk(workspacePath: string): Promise<WorkspaceState> {
    const statePath = this.statePath(workspacePath)
    try {
      if (fs.existsSync(statePath)) {
        const raw = await fs.promises.readFile(statePath, 'utf-8')
        const parsed = JSON.parse(raw) as Partial<WorkspaceState>
        const merged: WorkspaceState = {
          lastOpenedFilePath: coerceLastOpenedFilePath(parsed.lastOpenedFilePath),
          expandedFolderPaths: coerceExpandedFolderPaths(parsed.expandedFolderPaths),
        }
        this.cache.set(workspacePath, merged)
        return { ...merged }
      }
    } catch {
      // fall through to defaults
    }
    return { ...DEFAULT_WORKSPACE_STATE }
  }

  async save(workspacePath: string, partial: Partial<WorkspaceState>): Promise<void> {
    const previous = this.writeQueue.get(workspacePath) ?? Promise.resolve()
    const operation = previous.catch(() => {}).then(async () => {
      const current = await this.loadFromDisk(workspacePath)
      const next: WorkspaceState = { ...current, ...partial }
      const statePath = this.statePath(workspacePath)
      await fs.promises.mkdir(path.dirname(statePath), { recursive: true })
      await atomicWrite(statePath, JSON.stringify(next, null, 2))
      this.cache.set(workspacePath, next)
    })
    this.writeQueue.set(workspacePath, operation)
    try {
      await operation
    } finally {
      if (this.writeQueue.get(workspacePath) === operation) {
        this.writeQueue.delete(workspacePath)
      }
    }
  }
}
