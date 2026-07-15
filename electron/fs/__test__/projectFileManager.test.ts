import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createEmptyFile } from '../../../src/shared/lib/fileFormat'
import { ProjectFileManager } from '../projectFileManager.js'
import { AppState } from '../appState.js'

const { showSaveDialog } = vi.hoisted(() => ({ showSaveDialog: vi.fn() }))

vi.mock('electron', () => ({
  dialog: { showSaveDialog },
}))

describe('ProjectFileManager file identity', () => {
  let tmpDir: string
  let manager: ProjectFileManager

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-file-manager-'))
    manager = new ProjectFileManager(tmpDir)
    await manager.initialize()
    showSaveDialog.mockReset()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('saveAs writes and returns a copy with a fresh file UUID', async () => {
    const targetPath = path.join(tmpDir, 'copy.mindlane')
    const source = createEmptyFile('Copy')
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: targetPath })

    const result = await manager.saveAs(source, {} as never)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.data.metadata.fileUuid).not.toBe(source.metadata.fileUuid)
    expect(JSON.parse(fs.readFileSync(targetPath, 'utf-8')).metadata.fileUuid).toBe(
      result.data.data.metadata.fileUuid,
    )
  })

  it('preserves a file UUID after an external move', async () => {
    const indexed = new ProjectFileManager(tmpDir, 5, new AppState(tmpDir))
    const originalPath = path.join(tmpDir, 'original.mindlane')
    const movedPath = path.join(tmpDir, 'moved.mindlane')
    const source = createEmptyFile('Move')
    fs.writeFileSync(originalPath, JSON.stringify(source))

    await indexed.loadFromPath(originalPath)
    fs.renameSync(originalPath, movedPath)
    const moved = await indexed.loadFromPath(movedPath)

    expect(moved.ok).toBe(true)
    if (!moved.ok) return
    expect(moved.data.data.metadata.fileUuid).toBe(source.metadata.fileUuid)
  })

  it('assigns a fresh file UUID to an external copy', async () => {
    const indexed = new ProjectFileManager(tmpDir, 5, new AppState(tmpDir))
    const originalPath = path.join(tmpDir, 'original.mindlane')
    const copyPath = path.join(tmpDir, 'copy.mindlane')
    const source = createEmptyFile('Copy')
    fs.writeFileSync(originalPath, JSON.stringify(source))

    await indexed.loadFromPath(originalPath)
    fs.copyFileSync(originalPath, copyPath)
    const copied = await indexed.loadFromPath(copyPath)

    expect(copied.ok).toBe(true)
    if (!copied.ok) return
    expect(copied.data.data.metadata.fileUuid).not.toBe(source.metadata.fileUuid)
  })

  it('returns the fresh UUID written when creating a copy in the workspace', async () => {
    const indexed = new ProjectFileManager(tmpDir, 5, new AppState(tmpDir))
    const originalPath = path.join(tmpDir, 'original.mindlane')
    const source = createEmptyFile('Copy')
    fs.writeFileSync(originalPath, JSON.stringify(source))
    await indexed.loadFromPath(originalPath)

    const copied = await indexed.createInDirectory(tmpDir, 'copy', source)

    expect(copied.ok).toBe(true)
    if (!copied.ok) return
    const written = JSON.parse(fs.readFileSync(copied.data.filePath, 'utf-8'))
    expect(copied.data.data.metadata.fileUuid).not.toBe(source.metadata.fileUuid)
    expect(copied.data.data.metadata.fileUuid).toBe(written.metadata.fileUuid)
  })
})
