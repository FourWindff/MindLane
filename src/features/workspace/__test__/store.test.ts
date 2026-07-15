import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mindmapRegistry } from '@/features/mindmap/model/mindmapRegistry'
import { createEmptyFile } from '@/shared/lib/fileFormat'
import { saveMindmapFileByUuidSilently, useWorkspaceStore } from '../store'

describe('workspace file switching', () => {
  beforeEach(() => {
    mindmapRegistry.releaseAll()
    useWorkspaceStore.setState({ busy: false, lastError: null })
  })

  it('preserves dirty background changes when the file is reopened before persistence finishes', async () => {
    const fileAData = createEmptyFile('A')
    const staleFileBData = createEmptyFile('B')
    const fileA = mindmapRegistry.getOrCreate('/a.mindlane')
    fileA.load('/a.mindlane', fileAData)
    const fileB = mindmapRegistry.getOrCreate('/b.mindlane')
    fileB.load('/b.mindlane', staleFileBData)
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

  it('persists a dirty background file by uuid and marks it clean', async () => {
    const file = mindmapRegistry.getOrCreate('/b.mindlane')
    file.load('/b.mindlane', createEmptyFile('B'))
    file.editor.addChild('root', { label: '后台新增节点' })
    const fileUuid = file.store.getState().fileUuid
    const save = vi.fn().mockResolvedValue({
      ok: true,
      data: { filePath: '/b.mindlane' },
    })
    const syncAfterFileSaved = vi.fn().mockResolvedValue(undefined)
    useWorkspaceStore.setState({ syncAfterFileSaved })
    vi.stubGlobal('window', { mindlane: { file: { save } } })

    await expect(saveMindmapFileByUuidSilently(fileUuid)).resolves.toBe(true)

    expect(save).toHaveBeenCalledWith({
      filePath: '/b.mindlane',
      data: expect.objectContaining({
        mindmap: expect.objectContaining({
          nodes: expect.arrayContaining([
            expect.objectContaining({ data: expect.objectContaining({ label: '后台新增节点' }) }),
          ]),
        }),
      }),
    })
    expect(file.store.getState().dirty).toBe(false)
    expect(syncAfterFileSaved).toHaveBeenCalledWith('/b.mindlane')
  })

  it('keeps a background file dirty when it changes again during persistence', async () => {
    const file = mindmapRegistry.getOrCreate('/b.mindlane')
    file.load('/b.mindlane', createEmptyFile('B'))
    file.editor.addChild('root', { label: '第一次修改' })
    const fileUuid = file.store.getState().fileUuid
    let finishSave: ((result: unknown) => void) | undefined
    const save = vi.fn(
      () =>
        new Promise((resolve) => {
          finishSave = resolve
        }),
    )
    useWorkspaceStore.setState({ syncAfterFileSaved: vi.fn().mockResolvedValue(undefined) })
    vi.stubGlobal('window', { mindlane: { file: { save } } })

    const saving = saveMindmapFileByUuidSilently(fileUuid)
    file.editor.addChild('root', { label: '保存期间的修改' })
    finishSave?.({ ok: true, data: { filePath: '/b.mindlane' } })
    await saving

    expect(file.store.getState().dirty).toBe(true)
  })
})
