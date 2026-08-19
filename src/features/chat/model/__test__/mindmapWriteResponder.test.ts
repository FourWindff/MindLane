import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Edge, Node } from '@xyflow/react'
import type { MindmapEditor } from '@/features/mindmap/model/mindmapEditor'
import { MindmapXmlError, formatXmlError } from '@/shared/lib/mindmapXml'
import type { MindmapWriteRequest } from '../../../../../electron/ipc'
import { createMindmapWriteResponder } from '../mindmapWriteResponder'

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
  const responder = createMindmapWriteResponder({
    subscribe: (next) => {
      listener = next
      return () => undefined
    },
    resolveEditor: (fileUuid) => editors[fileUuid],
    persistFile,
    respond,
  })
  const stop = responder.start()
  return { send: (request: MindmapWriteRequest) => listener?.(request), persistFile, respond, stop }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

afterEach(() => {
  vi.useRealTimers()
})

describe('MindmapWriteResponder', () => {
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

  it('maps move validation failures to block_not_found with the shared recovery copy', async () => {
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
      error:
        '[block_not_found] 节点「missing」不存在，请先 readMindmap 重新定位。恢复策略：先调用 readMindmap 重新定位后再操作',
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
