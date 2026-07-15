import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { FileSystemService } from '../../fs/index.js'
import { getWorkspaceSessionForService } from '../../main.js'

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

  it('returns workspace identity and per-file active sessions', async () => {
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
    await fsService.workspace.updateActiveSessionIds(workspacePath, {
      'file-uuid': 'session-uuid',
    })

    const session = await getWorkspaceSessionForService(fsService)

    expect(session.workspaceUuid).toBe(workspaceState.data.workspaceUuid)
    expect(session.activeSessionIds).toEqual({ 'file-uuid': 'session-uuid' })
  })
})
