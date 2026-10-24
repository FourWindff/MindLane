import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatStreamEvent } from '@contracts/ipc'
import type { PalaceRunPayload } from '@contracts/palace'
import { openFileRegistry } from '@/features/mindmap/model/openFileRegistry'
import type { MindmapEditor } from '@/features/mindmap/model/editor'
import { handlePalaceRunEvent, resumePalaceRun, startPalaceRun, stopPalaceRun } from './palaceRun'

vi.mock('@/features/mindmap/model/openFileRegistry', () => ({
  openFileRegistry: { getByFileUuid: vi.fn() },
}))

const FILE_UUID = 'file-a'
const NODE_ID = 'palace-1'

function svgDataUrl(): string {
  return `data:image/svg+xml;base64,${btoa('<svg viewBox="0 0 10 10"></svg>')}`
}

function palacePayload(): PalaceRunPayload {
  return {
    ok: true,
    label: 'Test palace',
    stations: [
      {
        order: 1,
        content: 'First stop',
        anchorVisual: 'Bronze bell',
        x: 0.2,
        y: 0.3,
        linkedNodeId: 'n1',
      },
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
  settle: ReturnType<typeof vi.fn>
  /** Stream id of the run's current start request (chosen by the renderer). */
  streamId: () => string
  resolveStart: () => Promise<void>
  start: () => Promise<{ ok: true } | { ok: false; error: string }>
  event: (event: Partial<ChatStreamEvent> & { type: ChatStreamEvent['type'] }) => boolean
}

function setup(
  options: { startDeferred?: boolean; streamResult?: { ok: false; error: string } } = {},
) {
  let pendingStart: ((value: { ok: true }) => void) | undefined
  const failure = options.streamResult
  const chatStream = vi.fn<
    (payload: { streamId: string }) => Promise<{ ok: true } | { ok: false; error: string }>
  >(
    failure
      ? async () => failure
      : async () =>
          options.startDeferred
            ? new Promise<{ ok: true }>((resolve) => {
                pendingStart = resolve
              })
            : { ok: true as const },
  )
  const stopStream = vi.fn(async () => ({ ok: true }))
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
  vi.mocked(openFileRegistry.getByFileUuid).mockReturnValue({
    editor: editor as unknown as MindmapEditor,
  } as never)

  const settle = vi.fn()
  // The run picks its own stream id before the invoke; read it off the request.
  const streamId = () =>
    (
      chatStream.mock.calls[chatStream.mock.calls.length - 1]?.[0] as
        { streamId: string } | undefined
    )?.streamId ?? ''
  const harness: Harness = {
    chatStream,
    stopStream,
    editor,
    settle,
    streamId,
    resolveStart: async () => {
      pendingStart?.({ ok: true })
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
        streamId: streamId(),
        sessionId: `session-${streamId()}`,
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
  it('starts an ephemeral run with an entry marker; stage progress lands on the placeholder node and the end only settles without landing', async () => {
    harness = setup()
    await expect(harness.start()).resolves.toEqual({ ok: true })

    const request = harness.chatStream.mock.calls[0]![0] as {
      streamId: string
      message: string
      ephemeral: { privateThreadId: string }
    }
    expect(request.message).toBe('')
    expect(request.streamId).toBe(harness.streamId())
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

    // The landing happened in the main process (the subgraph's `landPalace` write
    // request); the renderer only settles — no editor batch, no asset work here.
    expect(harness.editor.batch).not.toHaveBeenCalled()
    expect(harness.settle).toHaveBeenCalledTimes(1)
  })

  it('keeps the placeholder node and offers resume when landing fails (ok:false)', async () => {
    harness = setup()
    await harness.start()

    harness.event({
      type: 'end',
      payload: {
        content: '',
        palaceData: { ok: false, error: 'This file is not open, cannot land' },
      },
    } as never)

    expect(harness.editor.setNodeFlag).toHaveBeenLastCalledWith(NODE_ID, 'runStopped', true)
    expect(harness.editor.batch).not.toHaveBeenCalled()
    expect(harness.settle).toHaveBeenCalledTimes(1)
  })

  it('keeps the placeholder node after an abort; resuming reuses the same private thread and the marker continues', async () => {
    harness = setup()
    await harness.start()

    // A stopped run ends without a palace payload.
    harness.event({ type: 'end', payload: { content: '(Generation stopped)' } } as never)
    expect(harness.editor.setNodeFlag).toHaveBeenLastCalledWith(NODE_ID, 'runStopped', true)
    expect(harness.editor.batch).not.toHaveBeenCalled()
    expect(harness.settle).toHaveBeenCalledTimes(1)

    await resumePalaceRun(FILE_UUID, NODE_ID)
    const first = harness.chatStream.mock.calls[0]![0] as {
      streamId: string
      ephemeral: { privateThreadId: string }
    }
    const second = harness.chatStream.mock.calls[1]![0] as {
      streamId: string
      ephemeral: { privateThreadId: string; resume?: boolean }
    }
    expect(second.ephemeral.privateThreadId).toBe(first.ephemeral.privateThreadId)
    expect(second.ephemeral.resume).toBe(true)
    // Each attempt owns a fresh stream id, so the stopped stream's late tail
    // cannot be mistaken for the resumed run.
    expect(second.streamId).not.toBe(first.streamId)
    expect(harness.editor.clearNodeFlag).toHaveBeenCalledWith(NODE_ID, 'runStopped')
  })

  it('the abort button stops the stream of this run', async () => {
    harness = setup()
    await harness.start()
    stopPalaceRun(FILE_UUID, NODE_ID)
    expect(harness.stopStream).toHaveBeenCalledWith(harness.streamId())
  })

  it('routes events that arrive while the invoke is still pending', async () => {
    harness = setup({ startDeferred: true })
    const starting = harness.start()

    // The run's dispatch entry exists before the request is sent, so the first
    // event already reaches the placeholder — no buffering, no replay.
    const request = harness.chatStream.mock.calls[0]![0] as { streamId: string }
    expect(
      handlePalaceRunEvent({
        streamId: request.streamId,
        sessionId: 'session-early',
        type: 'step',
        payload: { step: 'generating-image' },
      } as ChatStreamEvent),
    ).toBe(true)
    expect(harness.editor.setNodeFlag).toHaveBeenCalledWith(NODE_ID, 'runStage', 'Generating image')

    await harness.resolveStart()
    await starting
  })

  it('hands stream events from another run back to the chat router', async () => {
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

  it('leaves no run behind when starting fails; the caller rolls back the placeholder node', async () => {
    harness = setup({ streamResult: { ok: false, error: 'Not ready' } })
    await expect(harness.start()).resolves.toEqual({ ok: false, error: 'Not ready' })
    await resumePalaceRun(FILE_UUID, NODE_ID)
    expect(harness.chatStream).toHaveBeenCalledTimes(1)
  })
})
