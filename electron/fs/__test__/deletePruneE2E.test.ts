import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Workspace } from '../workspace.js'
import { WorkspaceTree } from '../workspaceTree.js'

// shell.trashItem falls back to rm so deletion works headless.
vi.mock('electron', () => ({
  shell: {
    trashItem: vi.fn((targetPath: string) =>
      fs.promises.rm(targetPath, { recursive: true, force: true }),
    ),
  },
}))

describe('e2e: delete -> prune (handler sequence)', () => {
  it('prunes the deleted file mapping while keeping other mappings intact', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-e2e-'))
    const workspace = new Workspace()
    const tree = new WorkspaceTree()
    const wsPath = path.join(tmpDir, 'ws')
    fs.mkdirSync(wsPath, { recursive: true })
    const filePath = path.join(wsPath, 'a.mindlane')
    fs.writeFileSync(filePath, '{}')
    const keptPath = path.join(wsPath, 'kept.mindlane')
    fs.writeFileSync(keptPath, '{}')

    await workspace.updateFileUuidPath(wsPath, 'file-a', filePath)
    await workspace.updateFileUuidPath(wsPath, 'file-kept', keptPath)
    const initial = await workspace.load(wsPath)
    expect(initial.ok).toBe(true)
    if (!initial.ok) return
    expect(initial.data.fileUuidPaths).toEqual({
      'file-a': filePath,
      'file-kept': keptPath,
    })

    // Exact handler sequence for WorkspaceDeleteItem (thumbnail delete omitted).
    const del = await tree.deleteItem(filePath, wsPath)
    expect(del.ok).toBe(true)
    expect(fs.existsSync(filePath)).toBe(false)
    await workspace.pruneFileUuidPaths(wsPath)

    const after = await workspace.load(wsPath)
    expect(after.ok).toBe(true)
    if (!after.ok) return
    expect(after.data.fileUuidPaths).toEqual({ 'file-kept': keptPath })

    // Sessions are untouched (kept by design, option A); reopening re-registers the mapping.
    await workspace.updateFileUuidPath(wsPath, 'file-a', filePath)
    const restored = await workspace.load(wsPath)
    expect(restored.ok).toBe(true)
    if (!restored.ok) return
    expect(restored.data.fileUuidPaths).toEqual({
      'file-a': filePath,
      'file-kept': keptPath,
    })

    fs.rmSync(tmpDir, { recursive: true, force: true })
  })
})
