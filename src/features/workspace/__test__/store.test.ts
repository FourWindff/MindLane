import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mindmapRegistry } from '@/features/mindmap/model/mindmapRegistry'
import { createEmptyFile } from '@/shared/lib/fileFormat'
import { useWorkspaceStore } from '../store'

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
})
