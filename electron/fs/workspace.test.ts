import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { Workspace } from './workspace.js'
import { AppState } from './appState.js'
import { openInternalStore, type InternalStateStore } from '../store/internalStore.js'

describe('Workspace', () => {
  let tmpDir: string
  let workspace: Workspace
  let stateStore: InternalStateStore

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-workspace-'))
    const opened = openInternalStore(path.join(tmpDir, 'state.db'))
    if (!opened.ok) throw new Error(opened.error)
    stateStore = opened.store
    workspace = new Workspace(undefined, stateStore)
  })

  afterEach(() => {
    stateStore.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  /** Load a fresh workspace and return its stable identity. */
  async function loadWorkspaceUuid(workspacePath: string): Promise<string> {
    const state = await workspace.load(workspacePath)
    if (!state.ok || !state.data.workspaceUuid) throw new Error('workspace identity missing')
    return state.data.workspaceUuid
  }

  it('returns defaults when state file is missing', async () => {
    const workspacePath = path.join(tmpDir, 'workspace')
    fs.mkdirSync(workspacePath, { recursive: true })

    const result = await workspace.load(workspacePath)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.lastOpenedFilePath).toBeNull()
    expect(result.data.workspaceUuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
    expect(fs.existsSync(path.join(workspacePath, '.mindlane', 'state.json'))).toBe(true)
  })

  it('preserves workspace UUID after an external move', async () => {
    const appState = new AppState(tmpDir)
    const indexedWorkspace = new Workspace(appState)
    const originalPath = path.join(tmpDir, 'original')
    const movedPath = path.join(tmpDir, 'moved')
    fs.mkdirSync(originalPath, { recursive: true })

    const original = await indexedWorkspace.load(originalPath)
    expect(original.ok).toBe(true)
    if (!original.ok) return

    fs.renameSync(originalPath, movedPath)
    const moved = await indexedWorkspace.load(movedPath)

    expect(moved.ok).toBe(true)
    if (!moved.ok) return
    expect(moved.data.workspaceUuid).toBe(original.data.workspaceUuid)
  })

  it('assigns a fresh workspace UUID to a copied workspace', async () => {
    const appState = new AppState(tmpDir)
    const indexedWorkspace = new Workspace(appState)
    const originalPath = path.join(tmpDir, 'original')
    const copiedPath = path.join(tmpDir, 'copy')
    fs.mkdirSync(originalPath, { recursive: true })

    const original = await indexedWorkspace.load(originalPath)
    expect(original.ok).toBe(true)
    if (!original.ok) return
    fs.cpSync(originalPath, copiedPath, { recursive: true })

    const copied = await indexedWorkspace.load(copiedPath)

    expect(copied.ok).toBe(true)
    if (!copied.ok) return
    expect(copied.data.workspaceUuid).not.toBe(original.data.workspaceUuid)
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
        // unknown keys from older state files are ignored on load
        recentFiles: [
          { filePath: docPath, title: 'Doc', lastOpenedAt: '2024-01-01T00:00:00.000Z' },
        ],
      }),
    )

    const result = await workspace.load(workspacePath)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.lastOpenedFilePath).toBe(docPath)
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

  it('openFile records the last opened path and the file identity row', async () => {
    const workspacePath = path.join(tmpDir, 'workspace')
    fs.mkdirSync(workspacePath, { recursive: true })
    const filePath = path.join(workspacePath, 'note.mindlane')
    fs.writeFileSync(filePath, '{}')

    const result = await workspace.openFile(workspacePath, filePath, 'file-a')

    expect(result.ok).toBe(true)

    const loaded = await workspace.load(workspacePath)
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect(loaded.data.lastOpenedFilePath).toBe(filePath)
    expect(stateStore.getFilePath(loaded.data.workspaceUuid, 'file-a')).toBe(filePath)
  })

  it('renames a file through one identity update and keeps its session history', async () => {
    const workspacePath = path.join(tmpDir, 'workspace')
    fs.mkdirSync(workspacePath, { recursive: true })
    const oldPath = path.join(workspacePath, 'old.mindlane')
    const newPath = path.join(workspacePath, 'new.mindlane')
    fs.writeFileSync(oldPath, '{}')

    const workspaceUuid = await loadWorkspaceUuid(workspacePath)
    await workspace.openFile(workspacePath, oldPath, 'file-a')
    stateStore.createSession({
      sessionId: 'session-a',
      workspaceUuid,
      fileUuid: 'file-a',
      title: 'Chat',
    })
    stateStore.setActiveSession(workspaceUuid, 'file-a', 'session-a')

    workspace.moveFilePath(oldPath, newPath)

    expect(stateStore.getFilePath(workspaceUuid, 'file-a')).toBe(newPath)
    expect(stateStore.getActiveSession(workspaceUuid, 'file-a')).toBe('session-a')
    expect(
      stateStore.listSessions({ workspaceUuid, fileUuid: 'file-a' }).map((row) => row.sessionId),
    ).toEqual(['session-a'])
  })

  it('save-as is a new identity: its own row and no inherited session history', async () => {
    const workspacePath = path.join(tmpDir, 'workspace')
    fs.mkdirSync(workspacePath, { recursive: true })
    const originalPath = path.join(workspacePath, 'original.mindlane')
    const copyPath = path.join(workspacePath, 'copy.mindlane')
    fs.writeFileSync(originalPath, '{}')
    fs.writeFileSync(copyPath, '{}')

    const workspaceUuid = await loadWorkspaceUuid(workspacePath)
    await workspace.openFile(workspacePath, originalPath, 'file-original')
    stateStore.createSession({
      sessionId: 'session-original',
      workspaceUuid,
      fileUuid: 'file-original',
      title: 'Chat',
    })

    // Save-as mints a fresh fileUuid in the main process and opens the copy.
    await workspace.openFile(workspacePath, copyPath, 'file-copy')

    expect(stateStore.getFilePath(workspaceUuid, 'file-copy')).toBe(copyPath)
    expect(stateStore.getFilePath(workspaceUuid, 'file-original')).toBe(originalPath)
    expect(stateStore.listSessions({ workspaceUuid, fileUuid: 'file-copy' })).toEqual([])
    expect(stateStore.listSessions({ workspaceUuid, fileUuid: 'file-original' })).toHaveLength(1)
  })

  it('delete drops the identity row and active mapping while keeping the session', async () => {
    const workspacePath = path.join(tmpDir, 'workspace')
    fs.mkdirSync(workspacePath, { recursive: true })
    const filePath = path.join(workspacePath, 'gone.mindlane')
    fs.writeFileSync(filePath, '{}')

    const workspaceUuid = await loadWorkspaceUuid(workspacePath)
    await workspace.openFile(workspacePath, filePath, 'file-a')
    stateStore.createSession({
      sessionId: 'session-a',
      workspaceUuid,
      fileUuid: 'file-a',
      title: 'Chat',
    })
    stateStore.setActiveSession(workspaceUuid, 'file-a', 'session-a')

    workspace.deleteFileIdentitiesAtPath(filePath)

    expect(stateStore.getFilePath(workspaceUuid, 'file-a')).toBeNull()
    expect(stateStore.getActiveSession(workspaceUuid, 'file-a')).toBeNull()
    expect(stateStore.getSession('session-a')).not.toBeNull()
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
    fs.writeFileSync(existingFile, '{}')

    const migrateResult = await workspace.migrateLegacyState(workspacePath, {
      lastOpenedFilePath: existingFile,
    })
    expect(migrateResult.ok).toBe(true)

    const loaded = await workspace.load(workspacePath)
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect(loaded.data.lastOpenedFilePath).toBe(existingFile)
  })

  it('serializes concurrent state saves so no update is lost', async () => {
    const workspacePath = path.join(tmpDir, 'workspace')
    fs.mkdirSync(workspacePath, { recursive: true })

    const fileA = path.join(workspacePath, 'a.mindlane')
    const fileB = path.join(workspacePath, 'b.mindlane')
    fs.writeFileSync(fileA, '{}')
    fs.writeFileSync(fileB, '{}')
    // Establish the workspace identity once, as a real launch does, so the two
    // concurrent saves share it.
    await loadWorkspaceUuid(workspacePath)

    await Promise.all([
      workspace.openFile(workspacePath, fileA, 'file-a'),
      workspace.openFile(workspacePath, fileB, 'file-b'),
    ])

    const loaded = await workspace.load(workspacePath)
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect([fileA, fileB]).toContain(loaded.data.lastOpenedFilePath)
    expect(stateStore.getFilePath(loaded.data.workspaceUuid, 'file-a')).toBe(fileA)
    expect(stateStore.getFilePath(loaded.data.workspaceUuid, 'file-b')).toBe(fileB)
  })

  it('does not rewrite state.json when the workspace identity is unchanged', async () => {
    const indexedWorkspace = new Workspace(new AppState(path.join(tmpDir, 'userData')))
    const workspacePath = path.join(tmpDir, 'workspace')
    fs.mkdirSync(workspacePath, { recursive: true })
    await indexedWorkspace.load(workspacePath)

    const statePath = path.join(workspacePath, '.mindlane', 'state.json')
    const before = fs.readFileSync(statePath, 'utf-8')
    const writeFile = vi.spyOn(fs.promises, 'writeFile')
    const again = await indexedWorkspace.load(workspacePath)
    const calls = writeFile.mock.calls.length
    writeFile.mockRestore()

    expect(again.ok).toBe(true)
    expect(calls).toBe(0)
    expect(fs.readFileSync(statePath, 'utf-8')).toBe(before)
  })
})
