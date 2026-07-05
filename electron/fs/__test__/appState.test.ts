import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { AppState } from '../appState.js'

describe('AppState', () => {
  let tmpDir: string
  let appState: AppState

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-appstate-'))
    appState = new AppState(tmpDir)
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('drops legacy workspace-scoped keys when saving', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'settings.json'),
      JSON.stringify({
        apiKey: 'key',
        lastOpenedFilePath: '/old/file.mindlane',
        expandedFolderPaths: ['/a'],
      }),
    )

    const result = await appState.update({ chatModel: 'new-model' })
    expect(result.ok).toBe(true)

    const raw = fs.readFileSync(path.join(tmpDir, 'settings.json'), 'utf-8')
    const parsed = JSON.parse(raw)

    expect(parsed.chatModel).toBe('new-model')
    expect(parsed.lastOpenedFilePath).toBeUndefined()
    expect(parsed.expandedFolderPaths).toBeUndefined()
  })

  it('migrates legacy workspace-scoped keys once when lastWorkspacePath matches', async () => {
    const workspacePath = path.join(tmpDir, 'workspace')
    fs.mkdirSync(workspacePath, { recursive: true })
    fs.writeFileSync(
      path.join(tmpDir, 'settings.json'),
      JSON.stringify({
        apiKey: 'key',
        lastWorkspacePath: workspacePath,
        lastOpenedFilePath: '/old/file.mindlane',
        expandedFolderPaths: ['/a', '/b'],
      }),
    )

    const migrated = await appState.migrateLegacyWorkspaceState(workspacePath)

    expect(migrated.ok).toBe(true)
    if (!migrated.ok) return
    expect(migrated.data).toEqual({
      lastOpenedFilePath: '/old/file.mindlane',
      expandedFolderPaths: ['/a', '/b'],
    })

    const raw = fs.readFileSync(path.join(tmpDir, 'settings.json'), 'utf-8')
    const parsed = JSON.parse(raw)
    expect(parsed.lastOpenedFilePath).toBeUndefined()
    expect(parsed.expandedFolderPaths).toBeUndefined()
    expect(parsed.lastWorkspacePath).toBe(workspacePath)
    expect(parsed.apiKey).toBe('key')
  })

  it('does not migrate legacy keys when lastWorkspacePath does not match', async () => {
    const workspacePath = path.join(tmpDir, 'workspace')
    fs.mkdirSync(workspacePath, { recursive: true })
    fs.writeFileSync(
      path.join(tmpDir, 'settings.json'),
      JSON.stringify({
        apiKey: 'key',
        lastWorkspacePath: '/other/workspace',
        lastOpenedFilePath: '/old/file.mindlane',
        expandedFolderPaths: ['/a'],
      }),
    )

    const migrated = await appState.migrateLegacyWorkspaceState(workspacePath)

    expect(migrated.ok).toBe(true)
    if (!migrated.ok) return
    expect(migrated.data).toBeNull()

    const raw = fs.readFileSync(path.join(tmpDir, 'settings.json'), 'utf-8')
    const parsed = JSON.parse(raw)
    expect(parsed.lastOpenedFilePath).toBe('/old/file.mindlane')
    expect(parsed.expandedFolderPaths).toEqual(['/a'])
  })

  it('returns null when no legacy workspace-scoped keys exist', async () => {
    const workspacePath = path.join(tmpDir, 'workspace')
    fs.mkdirSync(workspacePath, { recursive: true })
    fs.writeFileSync(
      path.join(tmpDir, 'settings.json'),
      JSON.stringify({
        apiKey: 'key',
        lastWorkspacePath: workspacePath,
      }),
    )

    const migrated = await appState.migrateLegacyWorkspaceState(workspacePath)

    expect(migrated.ok).toBe(true)
    if (!migrated.ok) return
    expect(migrated.data).toBeNull()
  })

  it('getRecentFilesMax returns the configured limit', async () => {
    fs.writeFileSync(path.join(tmpDir, 'settings.json'), JSON.stringify({ recentFilesMax: 7 }))

    const max = await appState.getRecentFilesMax()

    expect(max).toBe(7)
  })

  it('switchWorkspace updates lastWorkspacePath and dedupes recentWorkspacePaths', async () => {
    const workspaceA = path.join(tmpDir, 'workspace-a')
    const workspaceB = path.join(tmpDir, 'workspace-b')
    fs.mkdirSync(workspaceA, { recursive: true })
    fs.mkdirSync(workspaceB, { recursive: true })

    const first = await appState.switchWorkspace(workspaceB)
    expect(first.ok).toBe(true)

    const second = await appState.switchWorkspace(workspaceA)
    expect(second.ok).toBe(true)

    const third = await appState.switchWorkspace(workspaceB)
    expect(third.ok).toBe(true)

    const settings = await appState.load()
    expect(settings.lastWorkspacePath).toBe(workspaceB)
    expect(settings.recentWorkspacePaths).toEqual([workspaceB, workspaceA])
  })

  it('switchWorkspace respects recentFilesMax', async () => {
    const workspaces = Array.from({ length: 4 }, (_, i) => path.join(tmpDir, `workspace-${i}`))
    for (const workspacePath of workspaces) {
      fs.mkdirSync(workspacePath, { recursive: true })
    }

    fs.writeFileSync(path.join(tmpDir, 'settings.json'), JSON.stringify({ recentFilesMax: 2 }))

    for (const workspacePath of workspaces) {
      const result = await appState.switchWorkspace(workspacePath)
      expect(result.ok).toBe(true)
    }

    const settings = await appState.load()
    expect(settings.recentWorkspacePaths).toHaveLength(2)
    expect(settings.recentWorkspacePaths[0]).toBe(workspaces[3])
    expect(settings.recentWorkspacePaths[1]).toBe(workspaces[2])
  })

  it('getLaunchSession restores the last workspace when it exists and restore is enabled', async () => {
    const workspacePath = path.join(tmpDir, 'workspace')
    fs.mkdirSync(workspacePath, { recursive: true })

    const update = await appState.update({
      lastWorkspacePath: workspacePath,
      recentWorkspacePaths: [workspacePath],
      restoreLastWorkspaceOnLaunch: true,
    })
    expect(update.ok).toBe(true)

    const session = await appState.getLaunchSession()

    expect(session.ok).toBe(true)
    if (!session.ok) return
    expect(session.data.workspacePath).toBe(workspacePath)
    expect(session.data.restoreLastWorkspaceOnLaunch).toBe(true)
  })

  it('getLaunchSession clears an invalid lastWorkspacePath and prunes stale recent paths', async () => {
    const missingWorkspacePath = path.join(tmpDir, 'missing-workspace')
    const existingWorkspacePath = path.join(tmpDir, 'existing-workspace')
    fs.mkdirSync(existingWorkspacePath, { recursive: true })

    const update = await appState.update({
      lastWorkspacePath: missingWorkspacePath,
      recentWorkspacePaths: [missingWorkspacePath, existingWorkspacePath],
    })
    expect(update.ok).toBe(true)

    const session = await appState.getLaunchSession()

    expect(session.ok).toBe(true)
    if (!session.ok) return
    expect(session.data.workspacePath).toBeNull()
    expect(session.data.recentWorkspacePaths).toEqual([existingWorkspacePath])

    const settings = await appState.load()
    expect(settings.lastWorkspacePath).toBeNull()
    expect(settings.recentWorkspacePaths).toEqual([existingWorkspacePath])
  })

  it('getLaunchSession returns no workspace when restore is disabled', async () => {
    const workspacePath = path.join(tmpDir, 'workspace')
    fs.mkdirSync(workspacePath, { recursive: true })

    const update = await appState.update({
      lastWorkspacePath: workspacePath,
      recentWorkspacePaths: [workspacePath],
      restoreLastWorkspaceOnLaunch: false,
    })
    expect(update.ok).toBe(true)

    const session = await appState.getLaunchSession()

    expect(session.ok).toBe(true)
    if (!session.ok) return
    expect(session.data.workspacePath).toBeNull()

    const settings = await appState.load()
    expect(settings.lastWorkspacePath).toBe(workspacePath)
  })
})
