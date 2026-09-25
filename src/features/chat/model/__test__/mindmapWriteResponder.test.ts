import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Edge, Node } from '@xyflow/react'
import type { MindmapEditor } from '@/features/mindmap/model/mindmapEditor'
import { MindmapEditor as RealMindmapEditor } from '@/features/mindmap/model/mindmapEditor'
import { MindmapHistory } from '@/features/mindmap/model/mindmapHistory'
import { createMindmapStore } from '@/features/mindmap/model/mindmapStore'
import { MindmapXmlError, formatXmlError } from '@/shared/lib/mindmapXml'
import type { MindmapWriteRequest } from '../../../../../electron/ipc'
import { createMindmapWriteResponder, insertPalacePlaceholder } from '../mindmapWriteResponder'
import { serializePalaceNodeXml } from '@/shared/lib/mindmapXml'

/** 可观察的假编辑器：记录方法调用，state 可注入，落图方法可挂起/放行。 */
function createFakeEditor() {
  const state = {
    nodes: [] as Node[],
    edges: [] as Edge[],
    assets: [] as Array<{ id: string }>,
  }
  const editor = {
    getState: vi.fn(() => state),
    insertFromXml: vi.fn(async () => {}),
    replaceNodeFromXml: vi.fn(async () => {}),
    moveSubtree: vi.fn(),
    deleteSubtree: vi.fn(),
  }
  return { editor, state }
}

/** 测试中的编辑器按 DI 缝注入（伪造活编辑器，与生产装配同构）。 */
function asEditor(fake: ReturnType<typeof createFakeEditor>): MindmapEditor {
  return fake.editor as unknown as MindmapEditor
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function setupResponder(editors: Record<string, MindmapEditor>) {
  let listener: ((request: MindmapWriteRequest) => void) | undefined
  const persistFile = vi.fn()
  const respond = vi.fn(async () => undefined)
  const warn = vi.fn()
  const responder = createMindmapWriteResponder({
    subscribe: (next) => {
      listener = next
      return () => undefined
    },
    resolveEditor: (fileUuid) => editors[fileUuid],
    persistFile,
    respond,
    warn,
  })
  const stop = responder.start()
  return {
    send: (request: MindmapWriteRequest) => listener?.(request),
    persistFile,
    respond,
    warn,
    stop,
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

function createRealEditor() {
  const store = createMindmapStore()
  const editor = new RealMindmapEditor(store, new MindmapHistory())
  editor.newFile('Responder test')
  return { editor, store }
}

function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${btoa(svg)}`
}

afterEach(() => {
  vi.useRealTimers()
})

describe('MindmapWriteResponder', () => {
  it('materializes palace SVG data URLs as assets before insert and update writes', async () => {
    const { editor, store } = createRealEditor()
    const { send, respond, stop } = setupResponder({ 'file-a': editor })
    const imageUrl = svgDataUrl(
      '<svg viewBox="0 0 1000 1000"><g data-station="1"><circle cx="100" cy="100" r="20" /></g></svg>',
    )

    send({
      requestId: 'palace-insert',
      fileUuid: 'file-a',
      action: 'insertXmlFragment',
      args: {
        parentId: 'root',
        xml: `<node type="palace" content="宫殿" imageUrl="${imageUrl}"><station order="1" x="0.1" y="0.1">入口</station></node>`,
      },
    })
    await vi.waitFor(() => expect(respond).toHaveBeenCalled())

    const state = store.getState()
    const palace = state.nodes.find((node) => node.type === 'palace')
    expect(state.assets).toHaveLength(1)
    expect(state.assets[0]).toMatchObject({ mime: 'image/svg+xml' })
    expect(palace?.data).toMatchObject({ assetId: state.assets[0]!.id })
    expect(palace?.data).not.toHaveProperty('imageUrl')

    const updatedImageUrl = svgDataUrl(
      '<svg viewBox="0 0 1000 1000"><g data-station="1"><rect width="200" height="200" /></g></svg>',
    )
    respond.mockClear()
    send({
      requestId: 'palace-update',
      fileUuid: 'file-a',
      action: 'updateMindmapNode',
      args: {
        xml: `<node id="${palace!.id}" type="palace" content="更新宫殿" imageUrl="${updatedImageUrl}"><station order="1" x="0.2" y="0.2">大厅</station></node>`,
      },
    })
    await vi.waitFor(() => expect(respond).toHaveBeenCalled())

    const updatedState = store.getState()
    const updatedPalace = updatedState.nodes.find((node) => node.id === palace!.id)
    expect(updatedState.assets).toHaveLength(2)
    expect(updatedPalace?.data).toMatchObject({ assetId: updatedState.assets[1]!.id })
    expect(updatedPalace?.data).not.toHaveProperty('imageUrl')
    stop()
  })

  it('drops malformed palace SVG artwork, inserts an artwork-less palace, and logs a warning', async () => {
    const { editor, store } = createRealEditor()
    const { send, respond, warn, stop } = setupResponder({ 'file-a': editor })
    const imageUrl = svgDataUrl('<svg><g data-station="1" /></svg>').replace(
      'image/svg+xml',
      'image/SVG+XML',
    )

    send({
      requestId: 'palace-invalid-svg',
      fileUuid: 'file-a',
      action: 'insertXmlFragment',
      args: {
        parentId: 'root',
        xml: `<node type="palace" content="宫殿" imageUrl="${imageUrl}"><station order="1">入口</station></node>`,
      },
    })
    await vi.waitFor(() => expect(respond).toHaveBeenCalled())

    const state = store.getState()
    const palace = state.nodes.find((node) => node.type === 'palace')
    expect(state.assets).toHaveLength(0)
    expect(palace).toBeDefined()
    expect(palace?.data).not.toHaveProperty('assetId')
    expect(palace?.data).not.toHaveProperty('imageUrl')
    expect(warn).toHaveBeenCalledOnce()
    stop()
  })

  it('passes through palace asset references without creating another asset', async () => {
    const { editor, store } = createRealEditor()
    const existingAssetId = store.getState().addAsset({
      id: 'existing-palace-artwork',
      mime: 'image/svg+xml',
      sha256: 'existing-sha',
      data: 'PHN2ZyB2aWV3Qm94PSIwIDAgMSAxIiAvPg==',
    })
    const { send, respond, warn, stop } = setupResponder({ 'file-a': editor })

    send({
      requestId: 'palace-existing-asset',
      fileUuid: 'file-a',
      action: 'insertXmlFragment',
      args: {
        parentId: 'root',
        xml: `<node type="palace" content="既有宫殿" asset="${existingAssetId}" />`,
      },
    })
    await vi.waitFor(() => expect(respond).toHaveBeenCalled())

    const state = store.getState()
    const palace = state.nodes.find((node) => node.type === 'palace')
    expect(state.assets).toHaveLength(1)
    expect(palace?.data).toMatchObject({ assetId: existingAssetId })
    expect(warn).not.toHaveBeenCalled()
    stop()
  })

  it('does not retain a materialized asset when the palace write is rejected', async () => {
    const { editor, store } = createRealEditor()
    const duplicateId = editor.addChild('root', { label: '已有节点' }).nodeId
    const { send, respond, stop } = setupResponder({ 'file-a': editor })
    const imageUrl = svgDataUrl('<svg viewBox="0 0 10 10" />')

    send({
      requestId: 'palace-rejected',
      fileUuid: 'file-a',
      action: 'insertXmlFragment',
      args: {
        parentId: 'root',
        xml: `<node id="${duplicateId}" type="palace" imageUrl="${imageUrl}" />`,
      },
    })
    await vi.waitFor(() => expect(respond).toHaveBeenCalled())

    expect(respond).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'palace-rejected', ok: false }),
    )
    expect(store.getState().assets).toHaveLength(0)
    stop()
  })

  it('does not retain a materialized asset when sibling placement has no target', async () => {
    const { editor, store } = createRealEditor()
    const { send, respond, stop } = setupResponder({ 'file-a': editor })
    const imageUrl = svgDataUrl('<svg viewBox="0 0 10 10" />')

    send({
      requestId: 'palace-missing-sibling',
      fileUuid: 'file-a',
      action: 'insertXmlFragment',
      args: {
        position: 'after',
        xml: `<node type="palace" imageUrl="${imageUrl}" />`,
      },
    })
    await vi.waitFor(() => expect(respond).toHaveBeenCalled())

    expect(respond).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'palace-missing-sibling', ok: false }),
    )
    expect(store.getState().assets).toHaveLength(0)
    expect(store.getState().nodes.filter((node) => node.type === 'palace')).toHaveLength(0)
    stop()
  })

  it('resolves the live editor by fileUuid and answers with a structured {ok, action, data} ack', async () => {
    const fake = createFakeEditor()
    fake.state.nodes = [
      { id: 'root', type: 'text', position: { x: 0, y: 0 }, data: { label: 'Root' } },
    ]
    const { send, persistFile, respond, stop } = setupResponder({ 'file-a': asEditor(fake) })

    send({
      requestId: 'r1',
      fileUuid: 'file-a',
      action: 'insertXmlFragment',
      args: { xml: '<node type="text" content="分支" />', parentId: 'root' },
    })
    await flush()

    expect(fake.editor.insertFromXml).toHaveBeenCalledWith('<node type="text" content="分支" />', {
      parentId: 'root',
      position: 'child',
    })
    expect(persistFile).toHaveBeenCalledWith('file-a')
    expect(respond).toHaveBeenCalledWith({
      requestId: 'r1',
      ok: true,
      action: 'insertXmlFragment',
      data: { nodeCount: 1, parentId: 'root', position: 'child' },
    })
    stop()
  })

  it('maps editor-side insert validation failures to the shared error vocabulary', async () => {
    const fake = createFakeEditor()
    fake.state.nodes = [
      { id: 'root', type: 'text', position: { x: 0, y: 0 }, data: { label: 'Root' } },
      { id: 'n1', type: 'text', position: { x: 200, y: 0 }, data: { label: 'N1' } },
    ]
    // Structural validation lives in MindmapEditor.insertFromXml (the responder
    // no longer pre-validates); the fake rejects with the shared error and the
    // responder must surface it with the same vocabulary and no persist.
    fake.editor.insertFromXml.mockRejectedValueOnce(
      new MindmapXmlError(
        'tree_invalid',
        '节点 id「n1」已存在于导图中（纯树不允许重复 id，否则产生多父/环）',
      ),
    )
    const { send, respond, persistFile, stop } = setupResponder({ 'file-a': asEditor(fake) })

    send({
      requestId: 'r1',
      fileUuid: 'file-a',
      action: 'insertXmlFragment',
      args: { xml: '<node id="n1" type="text" content="x" />', parentId: 'root' },
    })
    await flush()

    expect(persistFile).not.toHaveBeenCalled()
    expect(respond).toHaveBeenCalledWith({
      requestId: 'r1',
      ok: false,
      error: formatXmlError(
        new MindmapXmlError(
          'tree_invalid',
          '节点 id「n1」已存在于导图中（纯树不允许重复 id，否则产生多父/环）',
        ),
      ),
    })
    stop()
  })

  it('maps move validation failures to block_not_found with the shared error prefix', async () => {
    const fake = createFakeEditor()
    fake.state.nodes = [
      { id: 'root', type: 'text', position: { x: 0, y: 0 }, data: { label: 'Root' } },
    ]
    const { send, respond, stop } = setupResponder({ 'file-a': asEditor(fake) })

    send({
      requestId: 'r1',
      fileUuid: 'file-a',
      action: 'moveMindmapNode',
      args: { nodeId: 'missing', targetId: 'root' },
    })
    await flush()

    expect(fake.editor.moveSubtree).not.toHaveBeenCalled()
    expect(respond).toHaveBeenCalledWith({
      requestId: 'r1',
      ok: false,
      error: '[block_not_found] 节点「missing」不存在，请先 readMindmap 重新定位',
    })
    stop()
  })

  it('answers a clear error for an unknown fileUuid without throwing', async () => {
    const { send, respond, stop } = setupResponder({})

    send({
      requestId: 'r1',
      fileUuid: 'file-unknown',
      action: 'deleteNode',
      args: { nodeId: 'n1' },
    })
    await flush()

    expect(respond).toHaveBeenCalledWith({
      requestId: 'r1',
      ok: false,
      error: '该文件未打开，无法落盘',
    })
    stop()
  })

  it('serializes concurrent requests per fileUuid: the second apply waits for the first', async () => {
    const fake = createFakeEditor()
    fake.state.nodes = [
      { id: 'root', type: 'text', position: { x: 0, y: 0 }, data: { label: 'Root' } },
    ]
    const firstApply = deferred<void>()
    fake.editor.insertFromXml.mockReturnValueOnce(firstApply.promise)
    const { send, stop } = setupResponder({ 'file-a': asEditor(fake) })

    send({
      requestId: 'r1',
      fileUuid: 'file-a',
      action: 'insertXmlFragment',
      args: { xml: '<node type="text" content="A" />', parentId: 'root' },
    })
    send({
      requestId: 'r2',
      fileUuid: 'file-a',
      action: 'updateMindmapNode',
      args: { xml: '<node id="n1" type="text" content="B" />' },
    })
    await flush()

    // 第一个请求挂起时，第二个请求不得开始应用
    expect(fake.editor.insertFromXml).toHaveBeenCalledTimes(1)
    expect(fake.editor.replaceNodeFromXml).not.toHaveBeenCalled()

    firstApply.resolve()
    await flush()

    expect(fake.editor.replaceNodeFromXml).toHaveBeenCalledTimes(1)
    expect(fake.editor.insertFromXml.mock.invocationCallOrder[0]!).toBeLessThan(
      fake.editor.replaceNodeFromXml.mock.invocationCallOrder[0]!,
    )
    stop()
  })

  it('does not let one fileUuid block another', async () => {
    const fakeA = createFakeEditor()
    const fakeB = createFakeEditor()
    fakeA.state.nodes = [
      { id: 'root', type: 'text', position: { x: 0, y: 0 }, data: { label: 'Root' } },
    ]
    fakeB.state.nodes = [
      { id: 'root', type: 'text', position: { x: 0, y: 0 }, data: { label: 'Root' } },
    ]
    const firstApply = deferred<void>()
    fakeA.editor.insertFromXml.mockReturnValueOnce(firstApply.promise)
    const { send, stop } = setupResponder({
      'file-a': asEditor(fakeA),
      'file-b': asEditor(fakeB),
    })

    send({
      requestId: 'r1',
      fileUuid: 'file-a',
      action: 'insertXmlFragment',
      args: { xml: '<node type="text" content="A" />', parentId: 'root' },
    })
    send({
      requestId: 'r2',
      fileUuid: 'file-b',
      action: 'insertXmlFragment',
      args: { xml: '<node type="text" content="B" />', parentId: 'root' },
    })
    await flush()

    // file-a 挂起时 file-b 照常执行
    expect(fakeA.editor.insertFromXml).toHaveBeenCalledTimes(1)
    expect(fakeB.editor.insertFromXml).toHaveBeenCalledTimes(1)

    firstApply.resolve()
    await flush()
    stop()
  })

  it('honors confirmDeleteSubtree=false by declining the delete', async () => {
    const fake = createFakeEditor()
    fake.state.nodes = [
      { id: 'root', type: 'text', position: { x: 0, y: 0 }, data: { label: 'Root' } },
      { id: 'n1', type: 'text', position: { x: 200, y: 0 }, data: { label: 'N1' } },
    ]
    const { send, respond, stop } = setupResponder({ 'file-a': asEditor(fake) })

    send({
      requestId: 'r1',
      fileUuid: 'file-a',
      action: 'deleteNode',
      args: { nodeId: 'n1', confirmDeleteSubtree: false },
    })
    await flush()

    expect(fake.editor.deleteSubtree).not.toHaveBeenCalled()
    expect(respond).toHaveBeenCalledWith({
      requestId: 'r1',
      ok: true,
      action: 'deleteNode',
      data: { nodeId: 'n1', deleted: false },
    })
    stop()
  })

  it('rejects deleting root with a tree_invalid error', async () => {
    const fake = createFakeEditor()
    const { send, respond, stop } = setupResponder({ 'file-a': asEditor(fake) })

    send({
      requestId: 'r1',
      fileUuid: 'file-a',
      action: 'deleteNode',
      args: { nodeId: 'root' },
    })
    await flush()

    expect(fake.editor.deleteSubtree).not.toHaveBeenCalled()
    expect(respond).toHaveBeenCalledWith({
      requestId: 'r1',
      ok: false,
      error: formatXmlError(new MindmapXmlError('tree_invalid', 'root 是导图锚点，不可删除')),
    })
    stop()
  })

  it('rejects deleting a nonexistent node with block_not_found and never touches the editor', async () => {
    const fake = createFakeEditor()
    fake.state.nodes = [
      { id: 'root', type: 'text', position: { x: 0, y: 0 }, data: { label: 'Root' } },
    ]
    const { send, respond, persistFile, stop } = setupResponder({ 'file-a': asEditor(fake) })

    send({ requestId: 'r1', fileUuid: 'file-a', action: 'deleteNode', args: { nodeId: 'ghost' } })
    await flush()

    expect(fake.editor.deleteSubtree).not.toHaveBeenCalled()
    expect(persistFile).not.toHaveBeenCalled()
    expect(respond).toHaveBeenCalledWith({
      requestId: 'r1',
      ok: false,
      error: formatXmlError(
        new MindmapXmlError('block_not_found', '节点「ghost」不存在，请先 readMindmap 重新定位'),
      ),
    })
    stop()
  })

  it('rejects an invalid insert position instead of silently coercing to child', async () => {
    const fake = createFakeEditor()
    fake.state.nodes = [
      { id: 'root', type: 'text', position: { x: 0, y: 0 }, data: { label: 'Root' } },
    ]
    const { send, respond, stop } = setupResponder({ 'file-a': asEditor(fake) })

    send({
      requestId: 'r1',
      fileUuid: 'file-a',
      action: 'insertXmlFragment',
      args: { xml: '<node>a</node>', position: 'sideways' },
    })
    await flush()

    expect(fake.editor.insertFromXml).not.toHaveBeenCalled()
    expect(respond).toHaveBeenCalledWith({
      requestId: 'r1',
      ok: false,
      error: 'position 参数无效：sideways，只能是 root/child/after/before',
    })
    stop()
  })

  it('rejects an invalid move position instead of silently coercing to child', async () => {
    const fake = createFakeEditor()
    fake.state.nodes = [
      { id: 'root', type: 'text', position: { x: 0, y: 0 }, data: { label: 'Root' } },
      { id: 'n1', type: 'text', position: { x: 200, y: 0 }, data: { label: 'N1' } },
    ]
    const { send, respond, stop } = setupResponder({ 'file-a': asEditor(fake) })

    send({
      requestId: 'r1',
      fileUuid: 'file-a',
      action: 'moveMindmapNode',
      args: { nodeId: 'n1', targetId: 'root', position: 'root' },
    })
    await flush()

    expect(fake.editor.moveSubtree).not.toHaveBeenCalled()
    expect(respond).toHaveBeenCalledWith({
      requestId: 'r1',
      ok: false,
      error: 'position 参数无效：root，只能是 child/after/before',
    })
    stop()
  })

  it('keeps xml in the updateMindmapNode ack data (pre-proxy tool shape)', async () => {
    const fake = createFakeEditor()
    fake.state.nodes = [
      { id: 'root', type: 'text', position: { x: 0, y: 0 }, data: { label: 'Root' } },
    ]
    const { send, respond, stop } = setupResponder({ 'file-a': asEditor(fake) })

    send({
      requestId: 'r1',
      fileUuid: 'file-a',
      action: 'updateMindmapNode',
      args: { xml: '<node id="n1" type="text" content="B" />' },
    })
    await flush()

    expect(respond).toHaveBeenCalledWith({
      requestId: 'r1',
      ok: true,
      action: 'updateMindmapNode',
      data: { xml: '<node id="n1" type="text" content="B" />', nodeId: 'n1', nodeCount: 1 },
    })
    stop()
  })
})

/**
 * 宫殿落图（landPalace）：手动与 AI 两条触发面共用的新写动作。位置、层级与
 * 图片物化都由代码确定（不依模型选择），XML 由代码从子图 payload 序列化而来。
 */
describe('MindmapWriteResponder landPalace', () => {
  const station = (order: number, content: string) => ({ order, content, x: 0.2, y: 0.3 })

  it('无占位节点时新建宫殿，并按「新宫殿 → 选中节点」重挂父边', async () => {
    const { editor, store } = createRealEditor()
    const chapter = editor.addChild('root', { label: '章节' }).nodeId
    const first = editor.addChild(chapter, { label: '第一站' }).nodeId
    const second = editor.addChild(chapter, { label: '第二站' }).nodeId
    const { send, respond, stop } = setupResponder({ 'file-a': editor })
    const xml = serializePalaceNodeXml({
      label: '测试宫殿',
      imageUrl: svgDataUrl('<svg viewBox="0 0 10 10"><g data-station="1" /></svg>'),
      stations: [station(1, '第一站')],
      sourceNodeIds: [first, second],
    })

    send({ requestId: 'palace-land', fileUuid: 'file-a', action: 'landPalace', args: { xml } })
    await vi.waitFor(() => expect(respond).toHaveBeenCalled())

    const state = store.getState()
    const palace = state.nodes.find((node) => node.type === 'palace')!
    expect(state.assets).toHaveLength(1)
    expect(palace.data).toMatchObject({
      label: '测试宫殿',
      assetId: state.assets[0]!.id,
      sourceNodeIds: [first, second],
      expanded: true,
    })
    expect(palace.data).not.toHaveProperty('imageUrl')
    expect(palace.data).not.toHaveProperty('generating')
    const hasEdge = (source: string, target: string) =>
      state.edges.some((edge) => edge.source === source && edge.target === target)
    expect(hasEdge(chapter, palace.id)).toBe(true)
    expect(hasEdge(palace.id, first)).toBe(true)
    expect(hasEdge(palace.id, second)).toBe(true)
    expect(hasEdge(chapter, first)).toBe(false)
    expect(hasEdge(chapter, second)).toBe(false)
    expect(respond).toHaveBeenCalledWith({
      requestId: 'palace-land',
      ok: true,
      action: 'landPalace',
      data: { nodeId: palace.id, updatedPlaceholder: false, sourceNodeIds: [first, second] },
    })
    stop()
  })

  it('跨父选择全部收进新宫殿下，纯树不破且 root 不被重挂', async () => {
    const { editor, store } = createRealEditor()
    const first = editor.addChild('root', { label: '第一站' }).nodeId
    const nested = editor.addChild(first, { label: '嵌套站' }).nodeId
    const { send, respond, stop } = setupResponder({ 'file-a': editor })
    const xml = serializePalaceNodeXml({
      label: '测试宫殿',
      imageUrl: '',
      stations: [station(1, '第一站')],
      // A selection spanning parents, plus the root anchor itself.
      sourceNodeIds: ['root', first, nested],
    })

    send({ requestId: 'palace-tree', fileUuid: 'file-a', action: 'landPalace', args: { xml } })
    await vi.waitFor(() => expect(respond).toHaveBeenCalled())

    const state = store.getState()
    const palace = state.nodes.find((node) => node.type === 'palace')!
    const incoming = (target: string) => state.edges.filter((edge) => edge.target === target)
    // Parent derivation: the palace sits where the first source node was.
    expect(incoming(palace.id)).toEqual([expect.objectContaining({ source: 'root' })])
    expect(incoming(first)).toEqual([expect.objectContaining({ source: palace.id })])
    expect(incoming(nested)).toEqual([expect.objectContaining({ source: palace.id })])
    // The root anchor stays the tree's root.
    expect(incoming('root')).toEqual([])
    stop()
  })

  it('有手动运行的占位节点时就地更新：id 不变、运行标记清掉、图片物化', async () => {
    const { editor, store } = createRealEditor()
    const first = editor.addChild('root', { label: '第一站' }).nodeId
    const { nodeId: placeholderId } = insertPalacePlaceholder(editor, [first])

    // Placeholder: progress node under root, source node rewired under it.
    const placed = store.getState()
    expect(placed.nodes.find((node) => node.id === placeholderId)?.data).toMatchObject({
      generating: true,
      sourceNodeIds: [first],
    })
    expect(
      placed.edges.some((edge) => edge.source === 'root' && edge.target === placeholderId),
    ).toBe(true)
    expect(
      placed.edges.some((edge) => edge.source === placeholderId && edge.target === first),
    ).toBe(true)
    expect(placed.edges.some((edge) => edge.source === 'root' && edge.target === first)).toBe(false)
    expect(placed.nodes.find((node) => node.id === first)?.data.processing).toBe(true)

    const { send, respond, stop } = setupResponder({ 'file-a': editor })
    const xml = serializePalaceNodeXml({
      label: '测试宫殿',
      imageUrl: svgDataUrl('<svg viewBox="0 0 10 10"><g data-station="1" /></svg>'),
      stations: [station(1, '第一站')],
      sourceNodeIds: [first],
    })
    send({ requestId: 'palace-update', fileUuid: 'file-a', action: 'landPalace', args: { xml } })
    await vi.waitFor(() => expect(respond).toHaveBeenCalled())

    const state = store.getState()
    expect(state.nodes.filter((node) => node.type === 'palace')).toHaveLength(1)
    const palace = state.nodes.find((node) => node.id === placeholderId)!
    expect(state.assets).toHaveLength(1)
    expect(palace.data).toMatchObject({ label: '测试宫殿', assetId: state.assets[0]!.id })
    expect(palace.data.generating).toBeUndefined()
    expect(palace.data.runStage).toBeUndefined()
    expect(palace.data.runStopped).toBeUndefined()
    expect(state.nodes.find((node) => node.id === first)?.data.processing).toBeUndefined()
    expect(respond).toHaveBeenCalledWith({
      requestId: 'palace-update',
      ok: true,
      action: 'landPalace',
      data: { nodeId: placeholderId, updatedPlaceholder: true, sourceNodeIds: [first] },
    })
    stop()
  })

  it('输入节点已不存在时跳过它，不产生悬空边', async () => {
    const { editor, store } = createRealEditor()
    const first = editor.addChild('root', { label: '第一站' }).nodeId
    const { send, respond, stop } = setupResponder({ 'file-a': editor })
    const xml = serializePalaceNodeXml({
      label: '测试宫殿',
      imageUrl: '',
      stations: [station(1, '第一站')],
      sourceNodeIds: [first, 'ghost'],
    })

    send({ requestId: 'palace-ghost', fileUuid: 'file-a', action: 'landPalace', args: { xml } })
    await vi.waitFor(() => expect(respond).toHaveBeenCalled())

    const state = store.getState()
    const palace = state.nodes.find((node) => node.type === 'palace')!
    expect(state.edges.some((edge) => edge.target === 'ghost')).toBe(false)
    expect(state.edges.some((edge) => edge.source === palace.id && edge.target === first)).toBe(
      true,
    )
    stop()
  })

  it('没有画面时仍然落图（宫殿可以没有画面）', async () => {
    const { editor, store } = createRealEditor()
    const first = editor.addChild('root', { label: '第一站' }).nodeId
    const { send, respond, stop } = setupResponder({ 'file-a': editor })
    const xml = serializePalaceNodeXml({
      label: '无图宫殿',
      imageUrl: '',
      stations: [station(1, '第一站')],
      sourceNodeIds: [first],
    })

    send({ requestId: 'palace-no-art', fileUuid: 'file-a', action: 'landPalace', args: { xml } })
    await vi.waitFor(() => expect(respond).toHaveBeenCalled())

    const state = store.getState()
    expect(state.assets).toHaveLength(0)
    expect(state.nodes.find((node) => node.type === 'palace')?.data).toMatchObject({
      label: '无图宫殿',
    })
    expect(respond).toHaveBeenCalledWith(expect.objectContaining({ ok: true }))
    stop()
  })
})
