import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MindmapInstance } from '../mindmapInstance'
import { saveMindmapInstance } from '../saveMindmapInstance'
import { createEmptyFile } from '@/shared/lib/fileFormat'

function createDirtyInstance(filePath: string | null): MindmapInstance {
  const instance = new MindmapInstance('test')
  if (filePath) {
    instance.load(filePath, createEmptyFile('B'))
  } else {
    instance.newFile('B')
  }
  instance.editor.addChild('root', { label: '后台新增节点' })
  return instance
}

describe('saveMindmapInstance', () => {
  let syncAfterFileSaved: ReturnType<typeof vi.fn<(filePath: string) => Promise<void>>>

  beforeEach(() => {
    syncAfterFileSaved = vi.fn<(filePath: string) => Promise<void>>().mockResolvedValue(undefined)
  })

  it('persists a dirty instance, marks it clean and syncs via the injected callback', async () => {
    const instance = createDirtyInstance('/b.mindlane')
    const save = vi.fn().mockResolvedValue({
      ok: true,
      data: { filePath: '/b.mindlane' },
    })
    vi.stubGlobal('window', { mindlane: { file: { save } } })

    await expect(saveMindmapInstance(instance, { syncAfterFileSaved })).resolves.toBe(true)

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
    expect(instance.store.getState().dirty).toBe(false)
    expect(syncAfterFileSaved).toHaveBeenCalledWith('/b.mindlane')
  })

  it('keeps the instance dirty when it changes again during persistence', async () => {
    const instance = createDirtyInstance('/b.mindlane')
    let finishSave: ((result: unknown) => void) | undefined
    const save = vi.fn(
      () =>
        new Promise((resolve) => {
          finishSave = resolve
        }),
    )
    vi.stubGlobal('window', { mindlane: { file: { save } } })

    const saving = saveMindmapInstance(instance, { syncAfterFileSaved })
    instance.editor.addChild('root', { label: '保存期间的修改' })
    finishSave?.({ ok: true, data: { filePath: '/b.mindlane' } })
    await saving

    expect(instance.store.getState().dirty).toBe(true)
  })

  it('is a no-op for a clean instance', async () => {
    const instance = new MindmapInstance('test')
    instance.load('/b.mindlane', createEmptyFile('B'))
    const save = vi.fn()
    vi.stubGlobal('window', { mindlane: { file: { save } } })

    await expect(saveMindmapInstance(instance, { syncAfterFileSaved })).resolves.toBe(true)

    expect(save).not.toHaveBeenCalled()
    expect(syncAfterFileSaved).not.toHaveBeenCalled()
  })

  it('routes to onError and skips IPC when filePath is null', async () => {
    const instance = createDirtyInstance(null)
    const save = vi.fn()
    const onError = vi.fn()
    vi.stubGlobal('window', { mindlane: { file: { save } } })

    await expect(saveMindmapInstance(instance, { syncAfterFileSaved, onError })).resolves.toBe(
      false,
    )

    expect(save).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledOnce()
    expect(instance.store.getState().dirty).toBe(true)
    expect(syncAfterFileSaved).not.toHaveBeenCalled()
  })

  it('routes IPC failures to onError and keeps the instance dirty', async () => {
    const instance = createDirtyInstance('/b.mindlane')
    const save = vi.fn().mockResolvedValue({ ok: false, error: '写入失败' })
    const onError = vi.fn()
    vi.stubGlobal('window', { mindlane: { file: { save } } })

    await expect(saveMindmapInstance(instance, { syncAfterFileSaved, onError })).resolves.toBe(
      false,
    )

    expect(onError).toHaveBeenCalledWith('写入失败')
    expect(instance.store.getState().dirty).toBe(true)
    expect(syncAfterFileSaved).not.toHaveBeenCalled()
  })
})
