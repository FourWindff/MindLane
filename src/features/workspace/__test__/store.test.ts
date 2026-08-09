import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mindmapRegistry } from '@/features/mindmap/model/mindmapRegistry'
import { createEmptyFile } from '@/shared/lib/fileFormat'
import { useWorkspaceStore } from '../store'

type WorkspaceApiOverrides = Partial<{
  openDirectory: () => Promise<unknown>
  createDirectory: (payload: { name: string }) => Promise<unknown>
  switchDirectory: (payload: { workspacePath: string }) => Promise<unknown>
  getSession: () => Promise<unknown>
  listFiles: (payload: { workspacePath: string }) => Promise<unknown>
  listTree: (payload: { workspacePath: string }) => Promise<unknown>
}>

function installWorkspaceApis(overrides: WorkspaceApiOverrides = {}) {
  const api = {
    openDirectory: vi.fn(async () => ({ ok: true as const, data: { workspacePath: '/ws' } })),
    createDirectory: vi.fn(async () => ({ ok: true as const, data: { workspacePath: '/ws' } })),
    switchDirectory: vi.fn(async () => ({ ok: true as const, data: { workspacePath: '/ws' } })),
    getSession: vi.fn(async () => ({
      workspacePath: '/ws',
      workspaceUuid: null,
      activeSessionIds: {},
      recentWorkspacePaths: ['/ws'],
      lastOpenedFilePath: null,
      restoreLastWorkspaceOnLaunch: true,
    })),
    listFiles: vi.fn(async () => ({
      ok: true as const,
      data: [{ filePath: '/ws/a.mindlane', name: 'a', lastModifiedAt: '2026-01-01T00:00:00.000Z' }],
    })),
    listTree: vi.fn(async () => ({
      ok: true as const,
      data: [
        {
          name: 'a',
          path: '/ws/a.mindlane',
          type: 'file' as const,
          lastModifiedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    })),
    ...overrides,
  }
  vi.stubGlobal('window', { mindlane: { workspace: api } })
  return api
}

function activateLegacyFile(filePath = '/old.mindlane') {
  const data = createEmptyFile('Old')
  const instance = mindmapRegistry.getOrCreate(filePath)
  instance.load(filePath, data, null)
  mindmapRegistry.setActive(filePath)
}

describe('workspace file switching', () => {
  beforeEach(() => {
    mindmapRegistry.releaseAll()
    useWorkspaceStore.setState({ busy: false, lastError: null })
  })

  it('preserves dirty background changes when the file is reopened before persistence finishes', async () => {
    const fileAData = createEmptyFile('A')
    const staleFileBData = createEmptyFile('B')
    const fileA = mindmapRegistry.getOrCreate('/a.mindlane')
    fileA.load('/a.mindlane', fileAData, '/ws')
    const fileB = mindmapRegistry.getOrCreate('/b.mindlane')
    fileB.load('/b.mindlane', staleFileBData, '/ws')
    fileB.editor.addChild('root', { label: '后台新增节点' })
    mindmapRegistry.setActive('/a.mindlane')

    vi.stubGlobal('window', {
      mindlane: {
        workspace: {
          openFilePath: vi.fn().mockResolvedValue({
            ok: true,
            data: { filePath: '/b.mindlane', data: staleFileBData },
          }),
        },
      },
    })

    await useWorkspaceStore.getState().openWorkspaceFile('/b.mindlane')

    expect(mindmapRegistry.getActive()).toBe(fileB)
    expect(fileB.store.getState().nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          data: expect.objectContaining({ label: '后台新增节点' }),
        }),
      ]),
    )
  })
})

describe('workspace switch restore protocol', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    mindmapRegistry.releaseAll()
    useWorkspaceStore.setState({
      busy: false,
      lastError: null,
      workspacePath: null,
      files: [],
      tree: [],
    })
  })

  it('open/create treat cancel as silent and write lastError only when a message is available', async () => {
    installWorkspaceApis({
      openDirectory: vi.fn(async () => ({ ok: false as const, error: '已取消' })),
    })
    await expect(useWorkspaceStore.getState().openWorkspaceDirectory()).resolves.toBe(false)
    expect(useWorkspaceStore.getState().lastError).toBeNull()

    installWorkspaceApis({
      createDirectory: vi.fn(async () => ({ ok: false as const, error: '创建目录失败' })),
    })
    await expect(useWorkspaceStore.getState().createWorkspaceDirectory('ws')).resolves.toBe(false)
    expect(useWorkspaceStore.getState().lastError).toBe('创建目录失败')
  })

  it('switch falls back to the default error copy when the main process returns no message', async () => {
    installWorkspaceApis({
      switchDirectory: vi.fn(async () => ({ ok: false as const })),
    })
    await expect(useWorkspaceStore.getState().switchWorkspace('/ws')).resolves.toBe(false)
    expect(useWorkspaceStore.getState().lastError).toBe('切换仓库失败')
  })

  it.each([
    {
      name: 'openWorkspaceDirectory',
      run: () => useWorkspaceStore.getState().openWorkspaceDirectory(),
    },
    {
      name: 'createWorkspaceDirectory',
      run: () => useWorkspaceStore.getState().createWorkspaceDirectory('ws'),
    },
    {
      name: 'switchWorkspace',
      run: () => useWorkspaceStore.getState().switchWorkspace('/ws'),
    },
  ])(
    '$name restores the scene from freshly fetched files/tree and clears the active mindlane',
    async ({ run }) => {
      const api = installWorkspaceApis()
      useWorkspaceStore.setState({
        files: [{ filePath: '/stale.mindlane', name: 'stale', lastModifiedAt: 'old' }],
      })
      activateLegacyFile('/old.mindlane')

      const ok = await run()

      expect(ok).toBe(true)
      const state = useWorkspaceStore.getState()
      expect(state.workspacePath).toBe('/ws')
      expect(state.files).toEqual([
        { filePath: '/ws/a.mindlane', name: 'a', lastModifiedAt: '2026-01-01T00:00:00.000Z' },
      ])
      expect(state.tree).toEqual([
        {
          name: 'a',
          path: '/ws/a.mindlane',
          type: 'file',
          lastModifiedAt: '2026-01-01T00:00:00.000Z',
        },
      ])
      expect(api.listFiles).toHaveBeenCalledWith({ workspacePath: '/ws' })
      expect(api.listTree).toHaveBeenCalledWith({ workspacePath: '/ws' })
      expect(mindmapRegistry.getActive()).toBeNull()
    },
  )

  it('no longer exposes the dead tree-expansion state', () => {
    const state = useWorkspaceStore.getState() as unknown as Record<string, unknown>
    expect(state.expandedFolders).toBeUndefined()
    expect(state.toggleFolder).toBeUndefined()
    expect(state.expandAllFolders).toBeUndefined()
    expect(state.collapseAllFolders).toBeUndefined()
  })
})
