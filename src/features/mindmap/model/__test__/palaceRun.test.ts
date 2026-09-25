import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Node } from '@xyflow/react'
import type { ChatStreamEvent, PalaceRunPayload } from '../../../../../electron/ipc'
import { mindmapRegistry } from '@/features/mindmap/model/mindmapRegistry'
import type { MindmapEditor } from '@/features/mindmap/model/mindmapEditor'
import { handlePalaceRunEvent, resumePalaceRun, startPalaceRun, stopPalaceRun } from '../palaceRun'

vi.mock('@/features/mindmap/model/mindmapRegistry', () => ({
  mindmapRegistry: { getByFileUuid: vi.fn() },
}))

const FILE_UUID = 'file-a'
const NODE_ID = 'palace-1'

function svgDataUrl(): string {
  return `data:image/svg+xml;base64,${btoa('<svg viewBox="0 0 10 10"></svg>')}`
}

function palacePayload(): PalaceRunPayload {
  return {
    ok: true,
    label: '测试宫殿',
    stations: [
      { order: 1, content: '第一站', anchorVisual: '铜钟', x: 0.2, y: 0.3, linkedNodeId: 'n1' },
    ],
    imageUrl: svgDataUrl(),
    sourceNodeIds: ['n1'],
  }
}

interface Harness {
  chatStream: ReturnType<typeof vi.fn>
  stopStream: ReturnType<typeof vi.fn>
  editor: {
    getState: ReturnType<typeof vi.fn>
    setNodeFlag: ReturnType<typeof vi.fn>
    clearNodeFlag: ReturnType<typeof vi.fn>
    batch: ReturnType<typeof vi.fn>
  }
  addAsset: ReturnType<typeof vi.fn>
  settle: ReturnType<typeof vi.fn>
  /** Resolve the pending chatStream invoke with a streamId. */
  streamId: string
  resolveStart: (streamId?: string) => Promise<void>
  start: () => Promise<{ ok: true } | { ok: false; error: string }>
  event: (event: Partial<ChatStreamEvent> & { type: ChatStreamEvent['type'] }) => boolean
}

/** Unique per test: the run registry is module state shared by the whole file. */
let nextStreamId = 0

function setup(
  options: { startDeferred?: boolean; streamResult?: { ok: false; error: string } } = {},
) {
  nextStreamId += 1
  const streamId = `stream-${nextStreamId}`
  let pendingStart: ((value: { ok: true; streamId: string }) => void) | undefined
  const chatStream = vi.fn(
    options.streamResult
      ? async () => options.streamResult
      : async () =>
          options.startDeferred
            ? new Promise<{ ok: true; streamId: string }>((resolve) => {
                pendingStart = resolve
              })
            : { ok: true as const, streamId },
  )
  const stopStream = vi.fn(async () => ({ ok: true }))
  const addAsset = vi.fn(() => 'asset-1')
  const editor = {
    getState: vi.fn(() => ({ fileUuid: FILE_UUID })),
    setNodeFlag: vi.fn(),
    clearNodeFlag: vi.fn(),
    batch: vi.fn(),
  }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: globalThis })
  Object.defineProperty(globalThis.window, 'mindlane', {
    configurable: true,
    value: { ai: { chatStream, stopStream } },
  })
  vi.mocked(mindmapRegistry.getByFileUuid).mockReturnValue({
    editor: editor as unknown as MindmapEditor,
    store: { getState: () => ({ addAsset }) },
  } as never)

  const settle = vi.fn()
  const harness: Harness = {
    chatStream,
    stopStream,
    editor,
    addAsset,
    settle,
    streamId,
    resolveStart: async (resolvedStreamId = streamId) => {
      pendingStart?.({ ok: true, streamId: resolvedStreamId })
      await new Promise((resolve) => setTimeout(resolve, 0))
    },
    start: () =>
      startPalaceRun({
        fileUuid: FILE_UUID,
        nodeId: NODE_ID,
        context: { fileUuid: FILE_UUID },
        handlers: { settle },
      }),
    event: (event) =>
      handlePalaceRunEvent({
        streamId,
        sessionId: `session-${streamId}`,
        ...event,
      } as ChatStreamEvent),
  }
  return harness
}

let harness: Harness

beforeEach(() => {
  vi.clearAllMocks()
})

describe('palaceRun', () => {
  it('启动一次带入口标记的临时运行，落图恰好一次', async () => {
    harness = setup()
    await expect(harness.start()).resolves.toEqual({ ok: true })

    const request = harness.chatStream.mock.calls[0]![0] as {
      message: string
      ephemeral: { privateThreadId: string; runEntry: string }
    }
    expect(request.message).toBe('')
    expect(request.ephemeral.runEntry).toBe('palace')
    expect(request.ephemeral.privateThreadId).toBeTruthy()

    // Stage progress lands on the placeholder node (beside the node, not in chat).
    harness.event({ type: 'step', payload: { step: 'planning-stations' } } as never)
    expect(harness.editor.setNodeFlag).toHaveBeenLastCalledWith(
      NODE_ID,
      'runStage',
      'Planning stations',
    )

    harness.event({ type: 'end', payload: { content: '', palaceData: palacePayload() } } as never)
    await new Promise((resolve) => setTimeout(resolve, 0))

    // Exactly one landing: one editor batch that turns the placeholder into the
    // palace node (asset materialized, source nodes' progress flags cleared).
    expect(harness.editor.batch).toHaveBeenCalledTimes(1)
    const commands = harness.editor.batch.mock.calls[0]![0] as Array<{
      type: string
      nodeId: string
    }>
    expect(commands.map((command) => command.type)).toEqual(['updateNode', 'updateNode'])
    expect(commands.map((command) => command.nodeId)).toEqual([NODE_ID, 'n1'])
    expect(harness.addAsset).toHaveBeenCalledTimes(1)
    expect(harness.settle).toHaveBeenCalledTimes(1)
  })

  it('中止后保留占位节点，续跑复用同一私有线程且标记继续', async () => {
    harness = setup()
    await harness.start()

    // A stopped run ends without a palace payload.
    harness.event({ type: 'end', payload: { content: '（已停止生成）' } } as never)
    expect(harness.editor.setNodeFlag).toHaveBeenLastCalledWith(NODE_ID, 'runStopped', true)
    expect(harness.editor.batch).not.toHaveBeenCalled()
    expect(harness.settle).toHaveBeenCalledTimes(1)

    await resumePalaceRun(FILE_UUID, NODE_ID)
    const first = harness.chatStream.mock.calls[0]![0] as {
      ephemeral: { privateThreadId: string }
    }
    const second = harness.chatStream.mock.calls[1]![0] as {
      ephemeral: { privateThreadId: string; resume?: boolean }
    }
    expect(second.ephemeral.privateThreadId).toBe(first.ephemeral.privateThreadId)
    expect(second.ephemeral.resume).toBe(true)
    expect(harness.editor.clearNodeFlag).toHaveBeenCalledWith(NODE_ID, 'runStopped')
  })

  it('中止按钮停的是这次运行的流', async () => {
    harness = setup()
    await harness.start()
    stopPalaceRun(FILE_UUID, NODE_ID)
    expect(harness.stopStream).toHaveBeenCalledWith(harness.streamId)
  })

  it('invoke 未 resolve 期间到达的事件在注册后补投', async () => {
    harness = setup({ startDeferred: true })
    const starting = harness.start()

    // The run's sessionId is generated by the caller, so early events are keyed
    // by it and replayed once the streamId is known.
    const request = harness.chatStream.mock.calls[0]![0] as { threadId: string }
    expect(
      handlePalaceRunEvent({
        streamId: harness.streamId,
        sessionId: request.threadId,
        type: 'step',
        payload: { step: 'generating-image' },
      } as ChatStreamEvent),
    ).toBe(true)
    expect(harness.editor.setNodeFlag).not.toHaveBeenCalled()

    await harness.resolveStart()
    await starting
    expect(harness.editor.setNodeFlag).toHaveBeenCalledWith(NODE_ID, 'runStage', 'Generating image')
  })

  it('非本次运行的流事件交回聊天路由', async () => {
    harness = setup()
    await harness.start()
    expect(
      handlePalaceRunEvent({
        streamId: 'stream-other',
        sessionId: 'session-other',
        type: 'token',
        payload: 'hi',
      } as ChatStreamEvent),
    ).toBe(false)
  })

  it('启动失败时不留下运行，占位节点由调用方回滚', async () => {
    harness = setup({ streamResult: { ok: false, error: '未就绪' } })
    await expect(harness.start()).resolves.toEqual({ ok: false, error: '未就绪' })
    await resumePalaceRun(FILE_UUID, NODE_ID)
    expect(harness.chatStream).toHaveBeenCalledTimes(1)
  })
})

describe('palaceRun landing payload', () => {
  it('画像缺失时仍然落图（宫殿可以没有画面）', async () => {
    harness = setup()
    await harness.start()
    harness.event({
      type: 'end',
      payload: { content: '', palaceData: { ...palacePayload(), imageUrl: '' } } as never,
    } as never)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(harness.addAsset).not.toHaveBeenCalled()
    expect(harness.editor.batch).toHaveBeenCalledTimes(1)
  })

  it('残留的远程 URL 内嵌失败时依然落图', async () => {
    harness = setup()
    Object.defineProperty(globalThis.window, 'mindlane', {
      configurable: true,
      value: {
        ai: {
          chatStream: harness.chatStream,
          stopStream: harness.stopStream,
          urlToDataUrl: vi.fn(async () => ({ ok: false as const, error: 'unreachable' })),
        },
      },
    })
    await harness.start()

    harness.event({
      type: 'end',
      payload: {
        content: '',
        palaceData: { ...palacePayload(), imageUrl: 'https://example.test/x.png' },
      } as never,
    } as never)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(harness.addAsset).not.toHaveBeenCalled()
    expect(harness.editor.batch).toHaveBeenCalledTimes(1)
    expect(harness.settle).toHaveBeenCalledTimes(1)
  })
})

describe('palaceRun node flags', () => {
  it('落图时清掉占位节点的运行标记', async () => {
    harness = setup()
    await harness.start()
    harness.event({ type: 'end', payload: { content: '', palaceData: palacePayload() } } as never)
    await new Promise((resolve) => setTimeout(resolve, 0))
    const node: Node = { id: NODE_ID, position: { x: 0, y: 0 }, data: {} }
    const commands = harness.editor.batch.mock.calls[0]![0] as Array<{
      patch: (node: Node) => Node
    }>
    const landed = commands[0]!.patch(node)
    expect(landed.data).toMatchObject({ label: '测试宫殿', assetId: 'asset-1', expanded: true })
    expect((landed.data as { generating?: boolean }).generating).toBeUndefined()
  })
})
