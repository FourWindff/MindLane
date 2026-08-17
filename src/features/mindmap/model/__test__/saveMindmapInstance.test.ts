import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MindmapInstance } from '../mindmapInstance'
import { saveMindmapInstance } from '../saveMindmapInstance'
import { createEmptyFile } from '@/shared/lib/fileFormat'
import { deserializeMindlaneFile } from '@/shared/lib/mindmapXml'

function createDirtyInstance(filePath: string | null): MindmapInstance {
  const instance = new MindmapInstance('test')
  if (filePath) {
    instance.load(filePath, createEmptyFile('B'), '/ws')
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

  it('save payload is legal XML that roundtrips back to the same structure', async () => {
    const instance = createDirtyInstance('/b.mindlane')
    instance.editor.addChild('root', { label: '子 & <特殊>' })
    let savedPayload: { filePath: string; data: unknown } | null = null
    const save = vi.fn((payload: { filePath: string; data: unknown }) => {
      savedPayload = payload
      return Promise.resolve({ ok: true, data: { filePath: '/b.mindlane' } })
    })
    vi.stubGlobal('window', { mindlane: { file: { save } } })

    await saveMindmapInstance(instance, { syncAfterFileSaved })

    // 主进程序列化端产物必须是合法 XML，读回 roundtrip 一致
    const file = savedPayload!.data as Parameters<typeof serializeMindlaneFile>[0]
    const { serializeMindlaneFile } = await import('@/shared/lib/mindmapXml')
    const xml = serializeMindlaneFile(file)
    expect(xml.startsWith('<mindlane version="1.0">')).toBe(true)
    const parsed = await deserializeMindlaneFile(xml)
    expect(parsed.metadata.title).toBe('B')
    expect(parsed.mindmap.nodes).toHaveLength(3)
    const labels = parsed.mindmap.nodes.map((n) => (n.data as { label: string }).label)
    expect(labels).toEqual(expect.arrayContaining(['子 & <特殊>']))
    // 保存守卫语义不变：nodes/edges/documentRefs 引用相等才 markClean
    expect(instance.store.getState().dirty).toBe(false)
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
    instance.load('/b.mindlane', createEmptyFile('B'), '/ws')
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
