import type { ChatContext, ChatStreamEvent } from '../../../../electron/ipc'
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
 * no session record, and emits the same stream events as any other run. The
 * subgraph's close-out lands the palace itself through the `landPalace` write
 * action (deterministic landing, shared with the AI trigger), so this module
 * routes the run's events away from the chat history, shows progress on the
 * placeholder node and keeps the private thread resumable — it never lands.
 *
 * Events can arrive before `chatStream` resolves with the streamId, so they wait
 * in a buffer keyed by the correlation id (same handshake as a chat send).
 */

interface PalaceRunHandlers {
  /** Run settled — landed, stopped or failed: release the chat busy flag. */
  settle: () => void
}

interface StartPalaceRunOptions {
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
      // ok = the subgraph's `landPalace` write request already updated the
      // placeholder through the write responder; nothing to apply here.
      if (payload?.ok) {
        forgetRun(run)
        run.handlers.settle()
      } else {
        settleStopped(run, payload?.error)
      }
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
