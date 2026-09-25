import type { Node } from '@xyflow/react'
import type { ChatContext, ChatStreamEvent, PalaceRunPayload } from '../../../../electron/ipc'
import { assetFromDataUrl, parseDataUrl } from '@/shared/lib/mindmapXml/asset'
import { stageDisplayName } from '@/shared/lib/stageLabels'
import { reportRendererError } from '@/shared/lib/reportRendererError'
import { mindmapRegistry } from './mindmapRegistry'
import type { MindmapEditor } from './mindmapEditor'

/**
 * Manual palace generation (CONTEXT.md「触发面」/「临时运行」): a plain ephemeral
 * graph run, not a direct subgraph call.
 *
 * One run = one `chatStream` carrying an entry marker; the main process mounts
 * the palace subgraph straight off START (no compaction, no supervisor), writes
 * no session record, and emits the same stream events as any other run. This
 * module is the renderer end of that contract: it owns the run registry (the
 * private thread to resume on, the node showing progress), routes the run's
 * events away from the chat history, and lands the payload with code — the model
 * never repeats the image data URL.
 *
 * Events can arrive before `chatStream` resolves with the streamId, so they wait
 * in a buffer keyed by the correlation id (same handshake as a chat send).
 */

export interface PalaceRunHandlers {
  /** Run settled — landed, stopped or failed: release the chat busy flag. */
  settle: () => void
}

export interface StartPalaceRunOptions {
  fileUuid: string
  /** Placeholder palace node the caller inserted into the canvas. */
  nodeId: string
  /** Turn context; its `selectedNodes` are the palace input. */
  context: ChatContext
  handlers: PalaceRunHandlers
}

interface ActiveRun {
  fileUuid: string
  nodeId: string
  /** Private checkpoint thread: resume by re-running it with empty input. */
  threadId: string
  /** Stream-event correlation id. */
  sessionId: string
  context: ChatContext
  handlers: PalaceRunHandlers
  streamId: string | null
  /** True while the start invoke is in flight (a second click must not re-send). */
  starting: boolean
}

const runsByNode = new Map<string, ActiveRun>()
const runsByStream = new Map<string, ActiveRun>()
const runsBySession = new Map<string, ActiveRun>()
/** Events that arrived before the run's streamId was known, keyed by sessionId. */
const pendingEvents = new Map<string, ChatStreamEvent[]>()

function runKey(fileUuid: string, nodeId: string): string {
  return `${fileUuid}\0${nodeId}`
}

function editorOf(run: ActiveRun): MindmapEditor | undefined {
  return mindmapRegistry.getByFileUuid(run.fileUuid)?.editor
}

async function startRun(
  run: ActiveRun,
  options: { resume?: boolean } = {},
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (run.starting) return { ok: true }
  run.starting = true
  try {
    return await sendRun(run, options)
  } finally {
    run.starting = false
  }
}

async function sendRun(
  run: ActiveRun,
  options: { resume?: boolean },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const api = window.mindlane?.ai
  if (!api) {
    forgetRun(run)
    return { ok: false, error: 'IPC 通道不可用，请确认 Electron 环境' }
  }

  const result = await api.chatStream({
    threadId: run.sessionId,
    message: '',
    context: run.context,
    ephemeral: {
      privateThreadId: run.threadId,
      runEntry: 'palace',
      ...(options.resume ? { resume: true } : {}),
    },
  })
  if (!result.ok) {
    forgetRun(run)
    return { ok: false, error: result.error }
  }

  run.streamId = result.streamId
  runsByStream.set(result.streamId, run)
  const buffered = pendingEvents.get(run.sessionId) ?? []
  pendingEvents.delete(run.sessionId)
  for (const event of buffered) {
    if (event.streamId === result.streamId) handleRunEvent(run, event)
  }
  return { ok: true }
}

/** Start a manual palace generation; resolves once the run is registered. */
export async function startPalaceRun(
  options: StartPalaceRunOptions,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const run: ActiveRun = {
    fileUuid: options.fileUuid,
    nodeId: options.nodeId,
    threadId: crypto.randomUUID(),
    sessionId: crypto.randomUUID(),
    context: options.context,
    handlers: options.handlers,
    streamId: null,
    starting: false,
  }
  runsByNode.set(runKey(run.fileUuid, run.nodeId), run)
  runsBySession.set(run.sessionId, run)
  return startRun(run)
}

/**
 * Resume a stopped/failed run on its own private thread with empty input: the
 * completed super-steps are checkpointed, so only the interrupted one re-runs.
 */
export async function resumePalaceRun(fileUuid: string, nodeId: string): Promise<void> {
  const run = runsByNode.get(runKey(fileUuid, nodeId))
  if (!run || run.streamId || run.starting) return
  const editor = editorOf(run)
  editor?.clearNodeFlag(nodeId, 'runStage')
  editor?.clearNodeFlag(nodeId, 'runStopped')
  const result = await startRun(run, { resume: true })
  if (!result.ok) {
    reportRendererError(`继续生成失败：${result.error}`)
    editor?.setNodeFlag(nodeId, 'runStopped', true)
  }
}

/** Stop the run's stream; the node keeps its placeholder for a later resume. */
export function stopPalaceRun(fileUuid: string, nodeId: string): void {
  const run = runsByNode.get(runKey(fileUuid, nodeId))
  if (run?.streamId) void window.mindlane?.ai.stopStream(run.streamId)
}

/**
 * Route one stream event to its palace run. Returns false when no palace run
 * owns the stream (the chat session route handles it then).
 */
export function handlePalaceRunEvent(event: ChatStreamEvent): boolean {
  const run = runsByStream.get(event.streamId)
  if (run) {
    handleRunEvent(run, event)
    return true
  }
  if (!runsBySession.has(event.sessionId)) return false
  pendingEvents.set(event.sessionId, [...(pendingEvents.get(event.sessionId) ?? []), event])
  return true
}

function handleRunEvent(run: ActiveRun, event: ChatStreamEvent): void {
  switch (event.type) {
    case 'step':
      editorOf(run)?.setNodeFlag(
        run.nodeId,
        'runStage',
        stageDisplayName(event.payload.step, event.payload.completed, event.payload.total),
      )
      break
    case 'end': {
      const payload = event.payload.palaceData
      forgetStream(run)
      if (payload?.ok) void landPalace(run, payload)
      else settleStopped(run, payload?.error)
      break
    }
    case 'error':
      forgetStream(run)
      settleStopped(run, event.payload)
      break
    default:
      // token / tool events: an ephemeral run writes no session record, so
      // nothing here reaches the chat history.
      break
  }
}

function forgetStream(run: ActiveRun): void {
  if (run.streamId) runsByStream.delete(run.streamId)
  run.streamId = null
}

function forgetRun(run: ActiveRun): void {
  forgetStream(run)
  runsByNode.delete(runKey(run.fileUuid, run.nodeId))
  runsBySession.delete(run.sessionId)
  pendingEvents.delete(run.sessionId)
}

/** Keep the placeholder and offer a resume: the private thread stays resumable. */
function settleStopped(run: ActiveRun, error?: string): void {
  if (error) reportRendererError(`宫殿生成失败：${error}`)
  const editor = editorOf(run)
  editor?.clearNodeFlag(run.nodeId, 'runStage')
  editor?.setNodeFlag(run.nodeId, 'runStopped', true)
  run.handlers.settle()
}

/**
 * Deterministic landing: the payload's artwork becomes an embedded asset and the
 * placeholder node turns into the palace node. No model round is involved — the
 * picture never travels back through a prompt.
 */
async function landPalace(run: ActiveRun, payload: PalaceRunPayload & { ok: true }): Promise<void> {
  try {
    const instance = mindmapRegistry.getByFileUuid(run.fileUuid)
    const editor = instance?.editor
    if (!instance || !editor) {
      settleStopped(run, '目标文件未打开，宫殿未落图')
      return
    }

    // Absent artwork is not a failed palace (CONTEXT.md 「宫殿图」): any hiccup on
    // the picture lands an image-less palace instead of losing the landing.
    let assetId: string | undefined
    if (payload.imageUrl) {
      try {
        const dataUrl = parseDataUrl(payload.imageUrl)
          ? payload.imageUrl
          : // The subgraph normalizes remote URLs to data URLs inside the graph; a
            // URL that survived that step is the degraded case, retried here.
            await window.mindlane?.ai
              .urlToDataUrl({ url: payload.imageUrl })
              .then((result) => (result.ok ? result.data.dataUrl : null))
        const asset = dataUrl ? await assetFromDataUrl(dataUrl) : null
        if (asset) assetId = instance.store.getState().addAsset(asset)
        else reportRendererError('宫殿画面无法内嵌，本次落图不带画面')
      } catch (error) {
        reportRendererError(
          `宫殿画面内嵌失败：${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }

    editor.batch([
      {
        type: 'updateNode',
        nodeId: run.nodeId,
        patch: (node: Node) => ({
          ...node,
          data: {
            label: payload.label,
            ...(assetId ? { assetId } : {}),
            imageUrl: '',
            stations: payload.stations,
            sourceNodeIds: payload.sourceNodeIds,
            expanded: true,
            generating: undefined,
          },
        }),
      },
      ...payload.sourceNodeIds.map((nodeId) => ({
        type: 'updateNode' as const,
        nodeId,
        patch: (node: Node) => ({
          ...node,
          data: { ...node.data, processing: undefined },
        }),
      })),
    ])
    forgetRun(run)
  } catch (error) {
    reportRendererError(`宫殿落图失败：${error instanceof Error ? error.message : String(error)}`)
    settleStopped(run)
    return
  }
  run.handlers.settle()
}
