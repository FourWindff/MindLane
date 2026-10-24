import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MindLaneFile } from '@contracts/fileFormat'
import { OpenFile } from './openFile'
import { saveOpenFile } from './saveOpenFile'
import { createEmptyFile } from '@contracts/fileFormat'
import { deserializeMindLaneFile, serializeMindLaneFile } from '@contracts/mindmapXml'

function createDirtyInstance(filePath: string | null): OpenFile {
  const instance = new OpenFile('test')
  instance.load(filePath ?? '', createEmptyFile('B'), filePath ? '/ws' : null)
  if (!filePath) instance.store.setState({ filePath: null })
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

  it('saves the document snapshot, never the view projection', async () => {
    const instance = new OpenFile('test')
    instance.load('/b.mindlane', createEmptyFile('B'), '/ws')
    const { nodeId } = instance.editor.addChild('root', { label: 'From the document' })
    const documentPosition = instance.store
      .getState()
      .documentNodes.find((node) => node.id === nodeId)!.position

    // View-only state: a drag preview and the editing flag must stay out of the file.
    instance.store.getState().previewNodePosition(nodeId, { x: 999, y: 999 })
    instance.store.getState().setNodeEditing(nodeId, true)

    const save = vi.fn().mockResolvedValue({ ok: true, data: { filePath: '/b.mindlane' } })
    vi.stubGlobal('window', { mindlane: { file: { save } } })

    await expect(saveOpenFile(instance.store, { syncAfterFileSaved })).resolves.toBe(true)

    const payload = save.mock.calls[0]![0] as { data: MindLaneFile }
    const saved = payload.data.mindmap.nodes.find((node) => node.id === nodeId)!
    expect(saved.position).toEqual(documentPosition)
    expect(saved.data).not.toHaveProperty('editing')
    expect(instance.store.getState().dirty).toBe(false)
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
    const file = savedPayload!.data as MindLaneFile
    const xml = serializeMindLaneFile(file)
    expect(xml.startsWith('<mindlane version="1.0">')).toBe(true)
    const parsed = await deserializeMindLaneFile(xml)
    expect(parsed.metadata.title).toBe('B')
    expect(parsed.mindmap.nodes).toHaveLength(3)
    const labels = parsed.mindmap.nodes.map((n) => (n.data as { label: string }).label)
    expect(labels).toEqual(expect.arrayContaining(['Child & <special>']))
    expect(instance.store.getState().dirty).toBe(false)
  })

  it('keeps the instance dirty (and does not retry) when the document changes during persistence', async () => {
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

    // Version guard: the saved version is no longer the shown one, so dirty stays
    // for the next autosave; the protocol itself never runs a second save.
    expect(instance.store.getState().dirty).toBe(true)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('persists a title-only change through the same protocol', async () => {
    const instance = new OpenFile('test')
    instance.load('/b.mindlane', createEmptyFile('B'), '/ws')
    instance.store.getState().setFileTitle('Renamed')
    const save = vi.fn().mockResolvedValue({ ok: true, data: { filePath: '/b.mindlane' } })
    vi.stubGlobal('window', { mindlane: { file: { save } } })

    expect(instance.store.getState().dirty).toBe(true)
    await expect(saveOpenFile(instance.store, { syncAfterFileSaved })).resolves.toBe(true)

    const payload = save.mock.calls[0]![0] as { data: MindLaneFile }
    expect(payload.data.metadata.title).toBe('Renamed')
    expect(instance.store.getState().dirty).toBe(false)
  })

  it('does not guard on a title change that lands while saving', async () => {
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
    instance.store.getState().setFileTitle('Renamed while saving')
    expect(instance.store.getState().dirty).toBe(true)
    finishSave?.({ ok: true, data: { filePath: '/b.mindlane' } })
    await saving

    // The guard compares document versions only: local metadata (title) is not
    // part of the document, so it does not fail the guard.
    expect(instance.store.getState().dirty).toBe(false)
  })

  it('is a no-op for a clean instance (no write, no thumbnail refresh)', async () => {
    const instance = new OpenFile('test')
    instance.load('/b.mindlane', createEmptyFile('B'), '/ws')
    const save = vi.fn()
    const afterSave = vi.fn()
    vi.stubGlobal('window', { mindlane: { file: { save } } })

    await expect(saveOpenFile(instance.store, { syncAfterFileSaved, afterSave })).resolves.toBe(
      true,
    )

    expect(save).not.toHaveBeenCalled()
    expect(afterSave).not.toHaveBeenCalled()
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
