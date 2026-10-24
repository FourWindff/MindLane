import fs from 'node:fs'
import path from 'node:path'
import { atomicWrite } from './atomicWrite.js'
import { isWithinWorkspace } from './paths.js'
import { fail } from './ipcResult.js'
import { isMindLaneFile } from './constants.js'
import type { IpcResult, WorkspaceState } from './types.js'
import type { AppState } from './appState.js'
import type { InternalStateStore } from '../store/internalStore.js'
import { logger } from '../shared/logger.js'

export const DEFAULT_WORKSPACE_STATE: WorkspaceState = {
  workspaceUuid: '',
  lastOpenedFilePath: null,
}

/** Coerce an untrusted value into a valid `lastOpenedFilePath` (string or null). */
export function coerceLastOpenedFilePath(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

const STATE_FILE = 'state.json'
const MINDLANE_DIR = '.mindlane'

export class Workspace {
  private writeQueue = new Map<string, Promise<void>>()

  constructor(
    private readonly appState?: AppState,
    /**
     * The file identity index (path per fileUuid) lives in the internal state
     * store, never in `state.json`: rename/move is one UPDATE, delete clears the
     * row, and nothing reconstructs it from the filesystem. Null when the state
     * store is unavailable (AI degraded), which only costs the capsule bar.
     */
    private readonly stateStore?: InternalStateStore,
  ) {}

  private statePath(workspacePath: string): string {
    return path.join(workspacePath, MINDLANE_DIR, STATE_FILE)
  }

  async load(workspacePath: string): Promise<IpcResult<WorkspaceState>> {
    const pending = this.writeQueue.get(workspacePath)
    if (pending) await pending

    const result = await this.loadFromDisk(workspacePath)
    if (!result.ok) return result
    if (!this.appState && result.data.workspaceUuid) return result
    return this.initializeIdentity(workspacePath, result.data)
  }

  /** Record the last opened file; its identity path is a separate store row. */
  async openFile(
    workspacePath: string,
    filePath: string,
    fileUuid?: string,
  ): Promise<IpcResult<void>> {
    if (fileUuid) {
      const state = await this.load(workspacePath)
      if (state.ok && state.data.workspaceUuid) {
        const workspaceUuid = state.data.workspaceUuid
        this.writeIdentity('record opened file', (store) =>
          store.setFilePath(workspaceUuid, fileUuid, filePath),
        )
      }
    }
    return this.saveState(workspacePath, async () => ({ lastOpenedFilePath: filePath }))
  }

  async clearLastOpenedFile(workspacePath: string): Promise<IpcResult<void>> {
    return this.saveState(workspacePath, async () => ({
      lastOpenedFilePath: null,
    }))
  }

  /**
   * Rename/move: re-point the path index in one UPDATE. The fileUuid does not
   * change, so sessions and the active-session mapping follow automatically.
   */
  moveFilePath(oldPath: string, newPath: string): void {
    const resolvedOldPath = path.resolve(oldPath)
    const resolvedNewPath = path.resolve(newPath)
    this.writeIdentity('move path', (store) => store.moveFilePath(resolvedOldPath, resolvedNewPath))
  }

  /**
   * Delete: drop the identity row and the active-session mapping at the removed
   * path (a file, or every file inside a deleted folder). Session data stays.
   */
  deleteFileIdentitiesAtPath(targetPath: string): void {
    const resolvedTargetPath = path.resolve(targetPath)
    this.writeIdentity('delete identity', (store) =>
      store.deleteFileIdentitiesAtPath(resolvedTargetPath),
    )
  }

  /**
   * Run one identity write. A database failure is logged and never turns a
   * successful file operation into a failed one; the path is not repaired
   * afterwards because the store is the only source.
   */
  private writeIdentity(operation: string, action: (store: InternalStateStore) => void): void {
    const store = this.stateStore
    if (!store) return
    try {
      action(store)
    } catch (error) {
      logger.warn('[Workspace] file identity write failed (%s):', operation, error)
    }
  }

  /**
   * One-time migration helper: write legacy workspace-scoped keys that were
   * previously stored in global settings.json. The written state is still
   * subject to the normal validation rules on the next load.
   */
  async migrateLegacyState(
    workspacePath: string,
    partial: Partial<WorkspaceState>,
  ): Promise<IpcResult<void>> {
    return this.saveState(workspacePath, async () => partial)
  }

  private async saveState(
    workspacePath: string,
    updater: () => Promise<Partial<WorkspaceState>>,
  ): Promise<IpcResult<void>> {
    const previous = this.writeQueue.get(workspacePath) ?? Promise.resolve()
    const operation = previous
      .catch(() => {})
      .then(async () => {
        const partial = await updater()
        const current = await this.loadFromDisk(workspacePath)
        const next: WorkspaceState = {
          ...(current.ok ? current.data : { ...DEFAULT_WORKSPACE_STATE }),
          ...partial,
        }
        const statePath = this.statePath(workspacePath)
        await fs.promises.mkdir(path.dirname(statePath), { recursive: true })
        await atomicWrite(statePath, JSON.stringify(next, null, 2))
      })
    this.writeQueue.set(workspacePath, operation)
    try {
      await operation
      return { ok: true, data: undefined }
    } catch (e) {
      return fail(e)
    } finally {
      if (this.writeQueue.get(workspacePath) === operation) {
        this.writeQueue.delete(workspacePath)
      }
    }
  }

  private async loadFromDisk(workspacePath: string): Promise<IpcResult<WorkspaceState>> {
    const statePath = this.statePath(workspacePath)
    try {
      if (fs.existsSync(statePath)) {
        const raw = await fs.promises.readFile(statePath, 'utf-8')
        const parsed = JSON.parse(raw) as Partial<WorkspaceState>
        const rawLastOpenedFilePath = coerceLastOpenedFilePath(parsed.lastOpenedFilePath)
        const lastOpenedFilePath = this.resolveLastOpenedFilePath(
          rawLastOpenedFilePath,
          workspacePath,
        )
        const corrected = lastOpenedFilePath !== rawLastOpenedFilePath
        const merged: WorkspaceState = {
          workspaceUuid: typeof parsed.workspaceUuid === 'string' ? parsed.workspaceUuid : '',
          lastOpenedFilePath,
        }
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

  private async initializeIdentity(
    workspacePath: string,
    state: WorkspaceState,
  ): Promise<IpcResult<WorkspaceState>> {
    try {
      const statePath = this.statePath(workspacePath)
      const candidateUuid = state.workspaceUuid || undefined
      const workspaceUuid = this.appState
        ? await this.appState.claimWorkspaceUuid(workspacePath, candidateUuid)
        : (candidateUuid ?? crypto.randomUUID())
      // The identity already on disk needs no rewrite: `load` is called on every
      // file switch, and `claimWorkspaceUuid` skipped its own write here too.
      if (workspaceUuid === state.workspaceUuid) return { ok: true, data: state }
      const next = { ...state, workspaceUuid }
      await fs.promises.mkdir(path.dirname(statePath), { recursive: true })
      await atomicWrite(statePath, JSON.stringify(next, null, 2))
      return { ok: true, data: next }
    } catch (error) {
      return fail(error)
    }
  }

  private resolveLastOpenedFilePath(
    candidate: string | null,
    workspacePath: string,
  ): string | null {
    if (
      candidate &&
      this.pathExists(candidate) &&
      isMindLaneFile(candidate) &&
      isWithinWorkspace(candidate, workspacePath)
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
}
