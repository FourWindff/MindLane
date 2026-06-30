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

  it('falls back to defaults when state file is corrupt', async () => {
    const workspacePath = path.join(tmpDir, 'workspace')
    fs.mkdirSync(path.join(workspacePath, '.mindlane'), { recursive: true })
    fs.writeFileSync(path.join(workspacePath, '.mindlane', 'state.json'), 'not-json')

    const result = await manager.load(workspacePath)

    expect(result.lastOpenedFilePath).toBeNull()
    expect(result.expandedFolderPaths).toEqual([])
  })
})
