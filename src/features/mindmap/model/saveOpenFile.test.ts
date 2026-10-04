import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OpenFile } from './openFile'
import { saveOpenFile } from './saveOpenFile'
import { createEmptyFile } from '@contracts/fileFormat'
import { deserializeMindLaneFile } from '@contracts/mindmapXml'

function createDirtyInstance(filePath: string | null): OpenFile {
  const instance = new OpenFile('test')
  if (filePath) {
    instance.load(filePath, createEmptyFile('B'), '/ws')
  } else {
    instance.newFile('B')
  }
  instance.editor.addChild('root', { label: 'Node added in the background' })
  return instance
}

describe('saveOpenFile', () => {
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

    await expect(saveOpenFile(instance.store, { syncAfterFileSaved })).resolves.toBe(true)

    expect(save).toHaveBeenCalledWith({
      filePath: '/b.mindlane',
      data: expect.objectContaining({
        mindmap: expect.objectContaining({
          nodes: expect.arrayContaining([
            expect.objectContaining({
              data: expect.objectContaining({ label: 'Node added in the background' }),
            }),
          ]),
        }),
      }),
    })
    expect(instance.store.getState().dirty).toBe(false)
    expect(syncAfterFileSaved).toHaveBeenCalledWith('/b.mindlane')
  })

  it('save payload is legal XML that roundtrips back to the same structure', async () => {
    const instance = createDirtyInstance('/b.mindlane')
    instance.editor.addChild('root', { label: 'Child & <special>' })
    let savedPayload: { filePath: string; data: unknown } | null = null
    const save = vi.fn((payload: { filePath: string; data: unknown }) => {
      savedPayload = payload
      return Promise.resolve({ ok: true, data: { filePath: '/b.mindlane' } })
    })
    vi.stubGlobal('window', { mindlane: { file: { save } } })

    await saveOpenFile(instance.store, { syncAfterFileSaved })

    // The payload serialized on the main-process side must be legal XML that roundtrips back
    const file = savedPayload!.data as Parameters<typeof serializeMindLaneFile>[0]
    const { serializeMindLaneFile } = await import('@contracts/mindmapXml')
    const xml = serializeMindLaneFile(file)
    expect(xml.startsWith('<mindlane version="1.0">')).toBe(true)
    const parsed = await deserializeMindLaneFile(xml)
    expect(parsed.metadata.title).toBe('B')
    expect(parsed.mindmap.nodes).toHaveLength(3)
    const labels = parsed.mindmap.nodes.map((n) => (n.data as { label: string }).label)
    expect(labels).toEqual(expect.arrayContaining(['Child & <special>']))
    // Save-guard semantics unchanged: markClean only when nodes/edges/documentRefs are reference-equal
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

    const saving = saveOpenFile(instance.store, { syncAfterFileSaved })
    instance.editor.addChild('root', { label: 'Changed while saving' })
    finishSave?.({ ok: true, data: { filePath: '/b.mindlane' } })
    await saving

    expect(instance.store.getState().dirty).toBe(true)
  })

  it('is a no-op for a clean instance', async () => {
    const instance = new OpenFile('test')
    instance.load('/b.mindlane', createEmptyFile('B'), '/ws')
    const save = vi.fn()
    vi.stubGlobal('window', { mindlane: { file: { save } } })

    await expect(saveOpenFile(instance.store, { syncAfterFileSaved })).resolves.toBe(true)

    expect(save).not.toHaveBeenCalled()
    expect(syncAfterFileSaved).not.toHaveBeenCalled()
  })

  it('routes to onError and skips IPC when filePath is null', async () => {
    const instance = createDirtyInstance(null)
    const save = vi.fn()
    const onError = vi.fn()
    vi.stubGlobal('window', { mindlane: { file: { save } } })

    await expect(saveOpenFile(instance.store, { syncAfterFileSaved, onError })).resolves.toBe(false)

    expect(save).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledOnce()
    expect(instance.store.getState().dirty).toBe(true)
    expect(syncAfterFileSaved).not.toHaveBeenCalled()
  })

  it('routes IPC failures to onError and keeps the instance dirty', async () => {
    const instance = createDirtyInstance('/b.mindlane')
    const save = vi.fn().mockResolvedValue({ ok: false, error: 'Write failed' })
    const onError = vi.fn()
    vi.stubGlobal('window', { mindlane: { file: { save } } })

    await expect(saveOpenFile(instance.store, { syncAfterFileSaved, onError })).resolves.toBe(false)

    expect(onError).toHaveBeenCalledWith('Write failed')
    expect(instance.store.getState().dirty).toBe(true)
    expect(syncAfterFileSaved).not.toHaveBeenCalled()
  })
})
