import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { FileSystemService } from '../fs/index.js'
import {
  getWorkspaceSessionForService,
  persistActiveSessionForService,
} from './workspaceSession.js'
import { logger } from '../shared/logger.js'
import { openInternalStore, type InternalStateStore } from '../store/internalStore.js'

vi.mock('electron', () => ({
  app: {
    commandLine: { appendSwitch: vi.fn() },
    getPath: vi.fn(() => ''),
    on: vi.fn(),
    quit: vi.fn(),
    whenReady: vi.fn(() => ({ then: vi.fn() })),
  },
  BrowserWindow: Object.assign(vi.fn(), {
    getAllWindows: vi.fn(() => []),
  }),
  dialog: {},
  ipcMain: { handle: vi.fn() },
  Menu: { buildFromTemplate: vi.fn(), setApplicationMenu: vi.fn() },
}))

describe('getWorkspaceSessionForService', () => {
  let tmpDir: string
  let fsService: FileSystemService

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-main-session-'))
    fsService = new FileSystemService(tmpDir)
    await fsService.initialize()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('clears persisted lastWorkspacePath when the directory no longer exists', async () => {
    const missingWorkspacePath = path.join(tmpDir, 'missing-workspace')
    const existingWorkspacePath = path.join(tmpDir, 'existing-workspace')
    fs.mkdirSync(existingWorkspacePath, { recursive: true })

    const update = await fsService.appState.update({
      lastWorkspacePath: missingWorkspacePath,
      recentWorkspacePaths: [missingWorkspacePath, existingWorkspacePath],
    })
    expect(update.ok).toBe(true)

    const session = await getWorkspaceSessionForService(fsService)

    expect(session.workspacePath).toBeNull()
    expect(session.recentWorkspacePaths).toEqual([existingWorkspacePath])

    const settings = await fsService.appState.load()
    expect(settings.lastWorkspacePath).toBeNull()
    expect(settings.recentWorkspacePaths).toEqual([existingWorkspacePath])
  })

  it('keeps a valid lastWorkspacePath when workspace restore is disabled', async () => {
    const workspacePath = path.join(tmpDir, 'workspace')
    fs.mkdirSync(workspacePath, { recursive: true })

    const update = await fsService.appState.update({
      lastWorkspacePath: workspacePath,
      recentWorkspacePaths: [workspacePath],
      restoreLastWorkspaceOnLaunch: false,
    })
    expect(update.ok).toBe(true)

    const session = await getWorkspaceSessionForService(fsService)

    expect(session.workspacePath).toBeNull()

    const settings = await fsService.appState.load()
    expect(settings.lastWorkspacePath).toBe(workspacePath)
    expect(settings.recentWorkspacePaths).toEqual([workspacePath])
  })

  it('returns workspace identity and per-file active sessions from the store', async () => {
    const workspacePath = path.join(tmpDir, 'workspace')
    fs.mkdirSync(workspacePath, { recursive: true })
    await fsService.appState.update({
      lastWorkspacePath: workspacePath,
      recentWorkspacePaths: [workspacePath],
      restoreLastWorkspaceOnLaunch: true,
    })
    const workspaceState = await fsService.workspace.load(workspacePath)
    expect(workspaceState.ok).toBe(true)
    if (!workspaceState.ok) return
    const workspaceUuid = workspaceState.data.workspaceUuid

    const store = openTestStore()
    try {
      store.setActiveSession(workspaceUuid, 'file-uuid', 'session-uuid')
      // The state.json mirror is stale on purpose: restore must read the store only.
      await fsService.workspace.setActiveSessionId(workspacePath, 'file-uuid', 'stale-session')

      const session = await getWorkspaceSessionForService(fsService, store)

      expect(session.activeSessionIds).toEqual({ 'file-uuid': 'session-uuid' })
    } finally {
      store.close()
    }
  })

  it('drops the active mapping when the session is deleted, so the next restore sees none', async () => {
    const workspacePath = path.join(tmpDir, 'workspace')
    fs.mkdirSync(workspacePath, { recursive: true })
    const workspaceState = await fsService.workspace.load(workspacePath)
    expect(workspaceState.ok).toBe(true)
    if (!workspaceState.ok) return
    const workspaceUuid = workspaceState.data.workspaceUuid

    const store = openTestStore()
    try {
      store.createSession({
        sessionId: 'session-uuid',
        workspaceUuid,
        fileUuid: 'file-uuid',
        title: 'New chat',
      })
      store.setActiveSession(workspaceUuid, 'file-uuid', 'session-uuid')

      store.deleteSession('session-uuid')

      const session = await getWorkspaceSessionForService(fsService, store)
      expect(session.activeSessionIds).toEqual({})
    } finally {
      store.close()
    }
  })

  it('persists an active session to the store and mirrors it into state.json', async () => {
    const workspacePath = path.join(tmpDir, 'workspace')
    fs.mkdirSync(workspacePath, { recursive: true })
    const workspaceState = await fsService.workspace.load(workspacePath)
    expect(workspaceState.ok).toBe(true)
    if (!workspaceState.ok) return
    const workspaceUuid = workspaceState.data.workspaceUuid

    const store = openTestStore()
    try {
      const result = await persistActiveSessionForService(
        fsService,
        store,
        workspacePath,
        'file-uuid',
        'session-uuid',
      )

      expect(result).toEqual({ ok: true })
      expect(store.getActiveSession(workspaceUuid, 'file-uuid')).toBe('session-uuid')
      const mirrored = await fsService.workspace.load(workspacePath)
      expect(mirrored.ok).toBe(true)
      if (!mirrored.ok) return
      expect(mirrored.data.activeSessionIds).toEqual({ 'file-uuid': 'session-uuid' })
    } finally {
      store.close()
    }
  })

  it('keeps the store mapping when the state.json mirror cannot be written', async () => {
    const store = openTestStore()
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    try {
      const brokenService = {
        workspace: {
          load: async () => ({
            ok: true,
            data: { workspaceUuid: 'workspace-uuid', activeSessionIds: {}, fileUuidPaths: {} },
          }),
          setActiveSessionId: async () => ({ ok: false, error: 'disk is full' }),
        },
      } as unknown as FileSystemService

      const result = await persistActiveSessionForService(
        brokenService,
        store,
        '/workspace',
        'file-uuid',
        'session-uuid',
      )

      expect(result).toEqual({ ok: true })
      expect(store.getActiveSession('workspace-uuid', 'file-uuid')).toBe('session-uuid')
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('active-session mirror failed'),
        'disk is full',
      )
    } finally {
      warn.mockRestore()
      store.close()
    }
  })

  function openTestStore(): InternalStateStore {
    const opened = openInternalStore(path.join(tmpDir, 'state.db'))
    if (!opened.ok) throw new Error(opened.error)
    return opened.store
  }
})
