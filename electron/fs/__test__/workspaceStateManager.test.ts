import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { WorkspaceStateManager } from '../workspaceStateManager.js'

describe('WorkspaceStateManager', () => {
  let tmpDir: string
  let manager: WorkspaceStateManager

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-ws-state-'))
    manager = new WorkspaceStateManager()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns defaults when state file is missing', async () => {
    const workspacePath = path.join(tmpDir, 'workspace')
    fs.mkdirSync(workspacePath, { recursive: true })

    const result = await manager.load(workspacePath)

    expect(result.lastOpenedFilePath).toBeNull()
    expect(result.expandedFolderPaths).toEqual([])
    expect(result.recentFiles).toEqual([])
  })

  it('creates .mindlane directory and persists state', async () => {
    const workspacePath = path.join(tmpDir, 'workspace')
    fs.mkdirSync(workspacePath, { recursive: true })

    await manager.save(workspacePath, { lastOpenedFilePath: path.join(workspacePath, 'a.mindlane') })
    const result = await manager.load(workspacePath)

    expect(result.lastOpenedFilePath).toBe(path.join(workspacePath, 'a.mindlane'))
    expect(fs.existsSync(path.join(workspacePath, '.mindlane', 'state.json'))).toBe(true)
  })

  it('merges partial updates', async () => {
    const workspacePath = path.join(tmpDir, 'workspace')
    fs.mkdirSync(workspacePath, { recursive: true })

    await manager.save(workspacePath, { expandedFolderPaths: ['a', 'b'] })
    await manager.save(workspacePath, { lastOpenedFilePath: path.join(workspacePath, 'b.mindlane') })
    const result = await manager.load(workspacePath)

    expect(result.expandedFolderPaths).toEqual(['a', 'b'])
    expect(result.lastOpenedFilePath).toBe(path.join(workspacePath, 'b.mindlane'))
  })

  it('does not clobber lastOpenedFilePath when only expanded folders are saved', async () => {
    const workspacePath = path.join(tmpDir, 'workspace')
    fs.mkdirSync(workspacePath, { recursive: true })

    await manager.save(workspacePath, { lastOpenedFilePath: path.join(workspacePath, 'doc.mindlane') })
    await manager.save(workspacePath, { expandedFolderPaths: ['a', 'b'] })
    const result = await manager.load(workspacePath)

    expect(result.lastOpenedFilePath).toBe(path.join(workspacePath, 'doc.mindlane'))
    expect(result.expandedFolderPaths).toEqual(['a', 'b'])
  })

  it('serializes concurrent saves so no update is lost', async () => {
    const workspacePath = path.join(tmpDir, 'workspace')
    fs.mkdirSync(workspacePath, { recursive: true })

    await Promise.all([
      manager.save(workspacePath, { lastOpenedFilePath: path.join(workspacePath, 'a.mindlane') }),
      manager.save(workspacePath, { expandedFolderPaths: ['x', 'y'] }),
    ])
    const result = await manager.load(workspacePath)

    expect(result.lastOpenedFilePath).toBe(path.join(workspacePath, 'a.mindlane'))
    expect(result.expandedFolderPaths).toEqual(['x', 'y'])
  })

  it('falls back to defaults when state file is corrupt', async () => {
    const workspacePath = path.join(tmpDir, 'workspace')
    fs.mkdirSync(path.join(workspacePath, '.mindlane'), { recursive: true })
    fs.writeFileSync(path.join(workspacePath, '.mindlane', 'state.json'), 'not-json')

    const result = await manager.load(workspacePath)

    expect(result.lastOpenedFilePath).toBeNull()
    expect(result.expandedFolderPaths).toEqual([])
    expect(result.recentFiles).toEqual([])
  })

  it('persists recent files inside the workspace state file', async () => {
    const workspacePath = path.join(tmpDir, 'workspace')
    fs.mkdirSync(workspacePath, { recursive: true })
    const filePath = path.join(workspacePath, 'note.mindlane')
    fs.writeFileSync(filePath, '{}')

    await manager.touchRecentFile(workspacePath, { filePath, title: 'Note' }, 10)

    const statePath = path.join(workspacePath, '.mindlane', 'state.json')
    const state = JSON.parse(fs.readFileSync(statePath, 'utf-8')) as { recentFiles?: unknown }
    expect(state.recentFiles).toMatchObject([{ filePath, title: 'Note' }])
    expect(fs.existsSync(path.join(workspacePath, '.mindlane', 'recent-files.json'))).toBe(false)
    expect(await manager.listRecentFiles(workspacePath)).toMatchObject([{ filePath, title: 'Note' }])
  })

  it('keeps recent files isolated by workspace', async () => {
    const workspacePath = path.join(tmpDir, 'workspace')
    const otherWorkspacePath = path.join(tmpDir, 'other-workspace')
    fs.mkdirSync(workspacePath, { recursive: true })
    fs.mkdirSync(otherWorkspacePath, { recursive: true })
    const filePath = path.join(workspacePath, 'note.mindlane')
    const otherFilePath = path.join(otherWorkspacePath, 'other.mindlane')

    await manager.touchRecentFile(workspacePath, { filePath, title: 'Note' }, 10)
    await manager.touchRecentFile(otherWorkspacePath, { filePath: otherFilePath, title: 'Other' }, 10)

    expect(await manager.listRecentFiles(workspacePath)).toMatchObject([{ filePath, title: 'Note' }])
    expect(await manager.listRecentFiles(otherWorkspacePath)).toMatchObject([
      { filePath: otherFilePath, title: 'Other' },
    ])
  })

  it('prunes missing files from the workspace recent file list', async () => {
    const workspacePath = path.join(tmpDir, 'workspace')
    fs.mkdirSync(workspacePath, { recursive: true })
    const filePath = path.join(workspacePath, 'note.mindlane')

    await manager.touchRecentFile(workspacePath, { filePath, title: 'Note' }, 10)
    await manager.pruneRecentFiles(workspacePath)

    expect(await manager.listRecentFiles(workspacePath)).toEqual([])
  })
})
