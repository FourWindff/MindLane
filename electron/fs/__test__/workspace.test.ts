import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { Workspace } from '../workspace.js'

describe('Workspace', () => {
  let tmpDir: string
  let workspace: Workspace

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-workspace-'))
    workspace = new Workspace()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns defaults when state file is missing', async () => {
    const workspacePath = path.join(tmpDir, 'workspace')
    fs.mkdirSync(workspacePath, { recursive: true })

    const result = await workspace.load(workspacePath)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.lastOpenedFilePath).toBeNull()
    expect(result.data.expandedFolderPaths).toEqual([])
    expect(result.data.recentFiles).toEqual([])
  })

  it('reads persisted state from disk', async () => {
    const workspacePath = path.join(tmpDir, 'workspace')
    const statePath = path.join(workspacePath, '.mindlane', 'state.json')
    const docPath = path.join(workspacePath, 'doc.mindlane')
    fs.mkdirSync(path.dirname(statePath), { recursive: true })
    fs.writeFileSync(docPath, '{}')
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        lastOpenedFilePath: docPath,
        expandedFolderPaths: ['a', 'b'],
        recentFiles: [
          { filePath: docPath, title: 'Doc', lastOpenedAt: '2024-01-01T00:00:00.000Z' },
        ],
      }),
    )

    const result = await workspace.load(workspacePath)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.lastOpenedFilePath).toBe(docPath)
    expect(result.data.expandedFolderPaths).toEqual(['a', 'b'])
    expect(result.data.recentFiles).toHaveLength(1)
  })

  it('corrects an invalid lastOpenedFilePath and persists the fix', async () => {
    const workspacePath = path.join(tmpDir, 'workspace')
    const statePath = path.join(workspacePath, '.mindlane', 'state.json')
    const missingFilePath = path.join(workspacePath, 'deleted.mindlane')
    fs.mkdirSync(path.dirname(statePath), { recursive: true })
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        lastOpenedFilePath: missingFilePath,
        expandedFolderPaths: [],
        recentFiles: [],
      }),
    )

    const result = await workspace.load(workspacePath)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.lastOpenedFilePath).toBeNull()

    const corrected = JSON.parse(fs.readFileSync(statePath, 'utf-8'))
    expect(corrected.lastOpenedFilePath).toBeNull()
  })

  it('openFile updates lastOpenedFilePath and prepends to recentFiles', async () => {
    const workspacePath = path.join(tmpDir, 'workspace')
    fs.mkdirSync(workspacePath, { recursive: true })
    const filePath = path.join(workspacePath, 'note.mindlane')
    fs.writeFileSync(filePath, '{}')

    const result = await workspace.openFile(workspacePath, filePath, 'Note', 10)

    expect(result.ok).toBe(true)

    const loaded = await workspace.load(workspacePath)
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect(loaded.data.lastOpenedFilePath).toBe(filePath)
    expect(loaded.data.recentFiles).toHaveLength(1)
    expect(loaded.data.recentFiles[0]?.filePath).toBe(filePath)
    expect(loaded.data.recentFiles[0]?.title).toBe('Note')
    expect(typeof loaded.data.recentFiles[0]?.lastOpenedAt).toBe('string')
  })

  it('falls back to defaults when state file is corrupt', async () => {
    const workspacePath = path.join(tmpDir, 'workspace')
    const statePath = path.join(workspacePath, '.mindlane', 'state.json')
    fs.mkdirSync(path.dirname(statePath), { recursive: true })
    fs.writeFileSync(statePath, 'not valid json')

    const result = await workspace.load(workspacePath)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.lastOpenedFilePath).toBeNull()
    expect(result.data.expandedFolderPaths).toEqual([])
    expect(result.data.recentFiles).toEqual([])
  })

  it('re-validates lastOpenedFilePath on every load', async () => {
    const workspacePath = path.join(tmpDir, 'workspace')
    const statePath = path.join(workspacePath, '.mindlane', 'state.json')
    const docPath = path.join(workspacePath, 'doc.mindlane')
    fs.mkdirSync(path.dirname(statePath), { recursive: true })
    fs.writeFileSync(docPath, '{}')
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        lastOpenedFilePath: docPath,
        expandedFolderPaths: [],
        recentFiles: [],
      }),
    )

    const first = await workspace.load(workspacePath)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.data.lastOpenedFilePath).toBe(docPath)

    fs.unlinkSync(docPath)

    const second = await workspace.load(workspacePath)
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.data.lastOpenedFilePath).toBeNull()
  })

  it('migrateLegacyState writes legacy keys and subsequent load validates them', async () => {
    const workspacePath = path.join(tmpDir, 'workspace')
    fs.mkdirSync(workspacePath, { recursive: true })
    const existingFile = path.join(workspacePath, 'legacy.mindlane')
    const missingFile = path.join(workspacePath, 'gone.mindlane')
    fs.writeFileSync(existingFile, '{}')

    const migrateResult = await workspace.migrateLegacyState(workspacePath, {
      lastOpenedFilePath: existingFile,
      expandedFolderPaths: ['a', 'b'],
      recentFiles: [
        { filePath: existingFile, title: 'Legacy', lastOpenedAt: '2024-01-01T00:00:00.000Z' },
        { filePath: missingFile, title: 'Missing', lastOpenedAt: '2024-01-01T00:00:00.000Z' },
      ],
    })
    expect(migrateResult.ok).toBe(true)

    const loaded = await workspace.load(workspacePath)
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect(loaded.data.lastOpenedFilePath).toBe(existingFile)
    expect(loaded.data.expandedFolderPaths).toEqual(['a', 'b'])
    expect(loaded.data.recentFiles).toHaveLength(2)
  })

  it('openFile respects maxEntries and moves existing entries to the top', async () => {
    const workspacePath = path.join(tmpDir, 'workspace')
    fs.mkdirSync(workspacePath, { recursive: true })

    for (let i = 0; i < 3; i++) {
      const filePath = path.join(workspacePath, `note-${i}.mindlane`)
      fs.writeFileSync(filePath, '{}')
      const result = await workspace.openFile(workspacePath, filePath, `Note ${i}`, 2)
      expect(result.ok).toBe(true)
    }

    const loaded = await workspace.load(workspacePath)
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect(loaded.data.recentFiles).toHaveLength(2)
    expect(loaded.data.recentFiles[0]?.title).toBe('Note 2')
    expect(loaded.data.recentFiles[1]?.title).toBe('Note 1')

    // Re-open an older file: it should move to the top
    const oldFilePath = path.join(workspacePath, 'note-1.mindlane')
    await workspace.openFile(workspacePath, oldFilePath, 'Note 1', 2)
    const reloaded = await workspace.load(workspacePath)
    expect(reloaded.ok).toBe(true)
    if (!reloaded.ok) return
    expect(reloaded.data.recentFiles[0]?.title).toBe('Note 1')
    expect(reloaded.data.recentFiles[1]?.title).toBe('Note 2')
  })

  it('serializes concurrent saves so no update is lost', async () => {
    const workspacePath = path.join(tmpDir, 'workspace')
    fs.mkdirSync(workspacePath, { recursive: true })

    const fileA = path.join(workspacePath, 'a.mindlane')
    const fileB = path.join(workspacePath, 'b.mindlane')
    fs.writeFileSync(fileA, '{}')
    fs.writeFileSync(fileB, '{}')

    await Promise.all([
      workspace.openFile(workspacePath, fileA, 'A', 10),
      workspace.updateExpandedFolders(workspacePath, ['x', 'y']),
    ])

    const loaded = await workspace.load(workspacePath)
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect(loaded.data.lastOpenedFilePath).toBe(fileA)
    expect(loaded.data.expandedFolderPaths).toEqual(['x', 'y'])
  })

  it('pruneRecentFiles removes entries whose files no longer exist', async () => {
    const workspacePath = path.join(tmpDir, 'workspace')
    fs.mkdirSync(workspacePath, { recursive: true })
    const existingFile = path.join(workspacePath, 'kept.mindlane')
    const missingFile = path.join(workspacePath, 'gone.mindlane')
    fs.writeFileSync(existingFile, '{}')
    fs.writeFileSync(missingFile, '{}')

    await workspace.openFile(workspacePath, existingFile, 'Kept', 10)
    await workspace.openFile(workspacePath, missingFile, 'Gone', 10)
    fs.unlinkSync(missingFile)

    const pruned = await workspace.pruneRecentFiles(workspacePath)
    expect(pruned.ok).toBe(true)

    const recent = await workspace.getRecentFiles(workspacePath)
    expect(recent.ok).toBe(true)
    if (!recent.ok) return
    expect(recent.data).toHaveLength(1)
    expect(recent.data[0]?.filePath).toBe(existingFile)
  })
})
