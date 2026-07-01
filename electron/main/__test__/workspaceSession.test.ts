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

    await fsService.settings.update({
      lastWorkspacePath: missingWorkspacePath,
      recentWorkspacePaths: [missingWorkspacePath, existingWorkspacePath],
    })

    const session = await getWorkspaceSessionForService(fsService)

    expect(session.workspacePath).toBeNull()
    expect(session.recentWorkspacePaths).toEqual([existingWorkspacePath])

    const settings = await fsService.settings.load()
    expect(settings.lastWorkspacePath).toBeNull()
    expect(settings.recentWorkspacePaths).toEqual([existingWorkspacePath])
  })

  it('keeps a valid lastWorkspacePath when workspace restore is disabled', async () => {
    const workspacePath = path.join(tmpDir, 'workspace')
    fs.mkdirSync(workspacePath, { recursive: true })

    await fsService.settings.update({
      lastWorkspacePath: workspacePath,
      recentWorkspacePaths: [workspacePath],
      restoreLastWorkspaceOnLaunch: false,
    })

    const session = await getWorkspaceSessionForService(fsService)

    expect(session.workspacePath).toBeNull()

    const settings = await fsService.settings.load()
    expect(settings.lastWorkspacePath).toBe(workspacePath)
    expect(settings.recentWorkspacePaths).toEqual([workspacePath])
  })
})
