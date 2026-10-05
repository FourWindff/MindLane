import fs from 'node:fs'
import path from 'node:path'
import { atomicWrite } from './atomicWrite.js'
import { isWithinWorkspace } from './paths.js'
import { fail } from './ipcResult.js'
import { isMindLaneFile } from './constants.js'
import type { IpcResult, WorkspaceState } from './types.js'
import type { AppState } from './appState.js'

export const DEFAULT_WORKSPACE_STATE: WorkspaceState = {
  workspaceUuid: '',
  activeSessionIds: {},
  fileUuidPaths: {},
  lastOpenedFilePath: null,
}

/** Coerce an untrusted value into a valid `fileUuidPaths` map. */
function coerceFileUuidPaths(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, string] =>
        entry[0] !== '' &&
        typeof entry[1] === 'string' &&
        entry[1] !== '' &&
        isMindLaneFile(entry[1]),
    ),
  )
}

/** Coerce an untrusted value into a valid `lastOpenedFilePath` (string or null). */
export function coerceLastOpenedFilePath(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

const STATE_FILE = 'state.json'
const MINDLANE_DIR = '.mindlane'

export class Workspace {
  private writeQueue = new Map<string, Promise<void>>()

  constructor(private readonly appState?: AppState) {}

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

  async openFile(workspacePath: string, filePath: string): Promise<IpcResult<void>> {
    return this.saveState(workspacePath, async () => ({ lastOpenedFilePath: filePath }))
  }

  async clearLastOpenedFile(workspacePath: string): Promise<IpcResult<void>> {
    return this.saveState(workspacePath, async () => ({
      lastOpenedFilePath: null,
    }))
  }

  /**
   * Write/update one session file index mapping (fileUuid -> filePath).
   * Called by the open/new/save-as paths (main process) and the rename/move paths
   * (renderer via the bridge). Silently skipped when fileUuid or filePath is empty;
   * nothing is written to disk in that case.
   */
  async updateFileUuidPath(
    workspacePath: string,
    fileUuid: string,
    filePath: string,
  ): Promise<IpcResult<void>> {
    if (!fileUuid || !filePath) return { ok: true, data: undefined }
    return this.saveState(workspacePath, async () => {
      const current = await this.loadFromDisk(workspacePath)
      return {
        fileUuidPaths: {
          ...(current.ok ? current.data.fileUuidPaths : DEFAULT_WORKSPACE_STATE.fileUuidPaths),
          [fileUuid]: filePath,
        },
      }
    })
  }

  async setActiveSessionId(
    workspacePath: string,
    fileUuid: string,
    sessionId: string | null,
    expectedSessionId?: string,
  ): Promise<IpcResult<void>> {
    return this.saveState(workspacePath, async () => {
      const current = await this.loadFromDisk(workspacePath)
      const activeSessionIds = {
        ...(current.ok ? current.data.activeSessionIds : DEFAULT_WORKSPACE_STATE.activeSessionIds),
      }
      if (expectedSessionId !== undefined && activeSessionIds[fileUuid] !== expectedSessionId) {
        return {}
      }
      if (sessionId === null) delete activeSessionIds[fileUuid]
      else activeSessionIds[fileUuid] = sessionId
      return { activeSessionIds }
    })
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

  /** Drop session file index entries whose path no longer exists, so stale paths do not linger. */
  async pruneFileUuidPaths(workspacePath: string): Promise<IpcResult<void>> {
    return this.saveState(workspacePath, async () => {
      const current = await this.loadFromDisk(workspacePath)
      const state = current.ok ? current.data : { ...DEFAULT_WORKSPACE_STATE }
      const valid = Object.fromEntries(
        Object.entries(state.fileUuidPaths).filter(([, filePath]) => {
          try {
            return fs.existsSync(filePath)
          } catch {
            return false
          }
        }),
      )
      return { fileUuidPaths: valid }
    })
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
          activeSessionIds:
            parsed.activeSessionIds && typeof parsed.activeSessionIds === 'object'
              ? Object.fromEntries(
                  Object.entries(parsed.activeSessionIds).filter(
                    (entry): entry is [string, string] => typeof entry[1] === 'string',
                  ),
                )
              : {},
          fileUuidPaths: coerceFileUuidPaths(parsed.fileUuidPaths),
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
