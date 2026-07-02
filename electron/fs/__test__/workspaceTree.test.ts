import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { WorkspaceTree } from '../workspaceTree.js'

vi.mock('electron', () => ({
  shell: { trashItem: vi.fn((targetPath: string) => fs.promises.rm(targetPath, { recursive: true, force: true })) },
}))

describe('WorkspaceTree', () => {
  let tmpDir: string
  let workspacePath: string
  let tree: WorkspaceTree

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-workspacetree-'))
    workspacePath = path.join(tmpDir, 'workspace')
    fs.mkdirSync(workspacePath, { recursive: true })
    tree = new WorkspaceTree()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('listFiles returns supported files sorted by name', async () => {
    fs.writeFileSync(path.join(workspacePath, 'b.mindlane'), '{}')
    fs.writeFileSync(path.join(workspacePath, 'a.mindlane'), '{}')
    fs.writeFileSync(path.join(workspacePath, 'ignored.txt'), 'text')

    const result = await tree.listFiles(workspacePath)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.map((f) => f.name)).toEqual(['a.mindlane', 'b.mindlane'])
  })

  it('listFiles returns an error when the workspace does not exist', async () => {
    const result = await tree.listFiles(path.join(workspacePath, 'missing'))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('工作目录不存在')
  })

  it('createDirectory creates a new directory and returns its path', async () => {
    const result = await tree.createDirectory(workspacePath, 'new-project')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(fs.existsSync(result.data)).toBe(true)
  })

  it('createDirectory returns an error when the target already exists', async () => {
    const existingPath = path.join(workspacePath, 'existing')
    fs.mkdirSync(existingPath)

    const result = await tree.createDirectory(workspacePath, 'existing')

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('已存在')
  })

  it('createSubdirectory returns an error when the target is outside the workspace', async () => {
    const outside = path.join(tmpDir, 'outside')
    fs.mkdirSync(outside)

    const result = await tree.createSubdirectory(outside, 'child', workspacePath)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('不在工作区内')
  })

  it('createSubdirectory creates a folder inside the workspace', async () => {
    const result = await tree.createSubdirectory(workspacePath, 'child', workspacePath)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(fs.existsSync(result.data)).toBe(true)
  })

  it('deleteItem returns an error when the target is outside the workspace', async () => {
    const outsideFile = path.join(tmpDir, 'outside.mindlane')
    fs.writeFileSync(outsideFile, '{}')

    const result = await tree.deleteItem(outsideFile, workspacePath)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('不在工作区内')
  })

  it('deleteItem moves an in-workspace item to trash', async () => {
    const targetFile = path.join(workspacePath, 'trash.mindlane')
    fs.writeFileSync(targetFile, '{}')

    const result = await tree.deleteItem(targetFile, workspacePath)

    expect(result.ok).toBe(true)
    expect(fs.existsSync(targetFile)).toBe(false)
  })

  it('rename appends .mindlane to supported files when missing', async () => {
    const oldFile = path.join(workspacePath, 'old.mindlane')
    fs.writeFileSync(oldFile, '{}')

    const result = await tree.rename(oldFile, 'new-name', workspacePath)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(path.basename(result.data)).toBe('new-name.mindlane')
  })

  it('rename returns an error when the new name already exists', async () => {
    const oldFile = path.join(workspacePath, 'old.mindlane')
    const existingFile = path.join(workspacePath, 'existing.mindlane')
    fs.writeFileSync(oldFile, '{}')
    fs.writeFileSync(existingFile, '{}')

    const result = await tree.rename(oldFile, 'existing', workspacePath)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('已存在')
  })

  it('move returns an error when the source is outside the workspace', async () => {
    const outsideFile = path.join(tmpDir, 'outside.mindlane')
    fs.writeFileSync(outsideFile, '{}')

    const result = await tree.move(outsideFile, workspacePath, workspacePath)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('源路径不在工作区内')
  })

  it('move relocates an item inside the workspace', async () => {
    const sourceFile = path.join(workspacePath, 'source.mindlane')
    const targetDir = path.join(workspacePath, 'target')
    fs.writeFileSync(sourceFile, '{}')
    fs.mkdirSync(targetDir)

    const result = await tree.move(sourceFile, targetDir, workspacePath)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(fs.existsSync(result.data)).toBe(true)
    expect(path.basename(result.data)).toBe('source.mindlane')
  })

  it('move returns an error when the target directory is outside the workspace', async () => {
    const sourceFile = path.join(workspacePath, 'source.mindlane')
    const outsideDir = path.join(tmpDir, 'outside')
    fs.writeFileSync(sourceFile, '{}')
    fs.mkdirSync(outsideDir)

    const result = await tree.move(sourceFile, outsideDir, workspacePath)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('目标目录不在工作区内')
  })
})
