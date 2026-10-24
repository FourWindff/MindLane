import { describe, expect, it, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Workspace } from './workspace.js'
import { WorkspaceTree } from './workspaceTree.js'
import { ThumbnailManager } from './thumbnailManager.js'
import { openInternalStore, type InternalStateStore } from '../store/internalStore.js'

// shell.trashItem falls back to rm so deletion works headless.
vi.mock('electron', () => ({
  shell: {
    trashItem: vi.fn((targetPath: string) =>
      fs.promises.rm(targetPath, { recursive: true, force: true }),
    ),
  },
}))

// The exact handler sequences for WorkspaceRenameItem / WorkspaceDeleteItem:
// the filesystem operation succeeds first, then the identity index follows.
describe('e2e: file identity follows the filesystem (handler sequence)', () => {
  let tmpDir: string
  let store: InternalStateStore | null = null

  afterEach(() => {
    store?.close()
    store = null
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  function setup() {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-identity-e2e-'))
    const opened = openInternalStore(path.join(tmpDir, 'state.db'))
    if (!opened.ok) throw new Error(opened.error)
    store = opened.store
    const workspace = new Workspace(undefined, store)
    const tree = new WorkspaceTree(new ThumbnailManager(tmpDir))
    const wsPath = path.join(tmpDir, 'ws')
    fs.mkdirSync(wsPath, { recursive: true })
    return { workspace, tree, wsPath }
  }

  async function workspaceUuid(workspace: Workspace, wsPath: string): Promise<string> {
    const state = await workspace.load(wsPath)
    if (!state.ok) throw new Error(state.error)
    return state.data.workspaceUuid
  }

  it('rename re-points the identity row and leaves the session history reachable', async () => {
    const { workspace, tree, wsPath } = setup()
    const oldPath = path.join(wsPath, 'draft.mindlane')
    fs.writeFileSync(oldPath, '{}')
    const uuid = await workspaceUuid(workspace, wsPath)
    await workspace.openFile(wsPath, oldPath, 'file-a')
    store!.createSession({
      sessionId: 'session-a',
      workspaceUuid: uuid,
      fileUuid: 'file-a',
      title: 'Chat',
    })

    const renamed = await tree.rename(oldPath, 'final', wsPath)
    expect(renamed.ok).toBe(true)
    if (!renamed.ok) return
    workspace.moveFilePath(oldPath, renamed.data)

    expect(store!.getFilePath(uuid, 'file-a')).toBe(renamed.data)
    expect(store!.listCapsuleFiles(uuid)).toEqual([
      {
        fileUuid: 'file-a',
        filePath: renamed.data,
        lastActivityAt: expect.any(String),
      },
    ])
  })

  it('delete clears the identity row while keeping the session data', async () => {
    const { workspace, tree, wsPath } = setup()
    const keptPath = path.join(wsPath, 'kept.mindlane')
    const gonePath = path.join(wsPath, 'gone.mindlane')
    fs.writeFileSync(keptPath, '{}')
    fs.writeFileSync(gonePath, '{}')
    const uuid = await workspaceUuid(workspace, wsPath)
    await workspace.openFile(wsPath, keptPath, 'file-kept')
    await workspace.openFile(wsPath, gonePath, 'file-gone')
    store!.createSession({
      sessionId: 'session-gone',
      workspaceUuid: uuid,
      fileUuid: 'file-gone',
      title: 'Chat',
    })
    store!.setActiveSession(uuid, 'file-gone', 'session-gone')

    const deleted = await tree.deleteItem(gonePath, wsPath)
    expect(deleted.ok).toBe(true)
    workspace.deleteFileIdentitiesAtPath(gonePath)

    expect(store!.getFilePath(uuid, 'file-gone')).toBeNull()
    expect(store!.getActiveSession(uuid, 'file-gone')).toBeNull()
    expect(store!.getFilePath(uuid, 'file-kept')).toBe(keptPath)
    expect(store!.getSession('session-gone')).not.toBeNull()
  })
})
