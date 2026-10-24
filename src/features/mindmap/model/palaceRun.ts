import type { ChatContext, ChatStreamEvent } from '@contracts/ipc'
import { stageDisplayName } from '@/shared/lib/stageLabels'
import { reportRendererError } from '@/shared/lib/reportRendererError'
import { openFileRegistry } from './openFileRegistry'
import type { MindmapEditor } from './editor'

/**
 * Manual palace generation (CONTEXT.md "Trigger Surface" / "Ephemeral Run"): a plain ephemeral
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
 * The run chooses its streamId (one per start attempt) and registers it before
 * the request leaves, so its events are routed by id from the first one on — no
 * buffering, no pairing, no replay once the invoke resolves.
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
  /** Id of the current start attempt; fresh per attempt so a resume never reuses a stream. */
  streamId: string | null
  /** True from the start request until the run's terminal event. */
  running: boolean
  /** True while the start invoke is in flight (a second click must not re-send). */
  starting: boolean
}

const runsByNode = new Map<string, ActiveRun>()
const runsByStream = new Map<string, ActiveRun>()

function runKey(fileUuid: string, nodeId: string): string {
  return `${fileUuid}\0${nodeId}`
}

function editorOf(run: ActiveRun): MindmapEditor | undefined {
  return openFileRegistry.getByFileUuid(run.fileUuid)?.editor
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
    return { ok: false, error: 'IPC channel unavailable; make sure you are running in Electron' }
  }

  // The stream id is chosen here and the dispatch entry is in place before the
  // request is sent, so the first event already knows its run.
  const streamId = crypto.randomUUID()
  run.streamId = streamId
  run.running = true
  runsByStream.set(streamId, run)

  const result = await api.chatStream({
    streamId,
    threadId: run.sessionId,
    message: '',
    context: run.context,
    ephemeral: {
      privateThreadId: run.threadId,
      ...(options.resume ? { resume: true } : {}),
    },
  })
  if (!result.ok) {
    forgetRun(run)
    return { ok: false, error: result.error }
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
    running: false,
    starting: false,
  }
  runsByNode.set(runKey(run.fileUuid, run.nodeId), run)
  return startRun(run)
}

/**
 * Resume a stopped/failed run on its own private thread with empty input: the
 * completed super-steps are checkpointed, so only the interrupted one re-runs.
 */
export async function resumePalaceRun(fileUuid: string, nodeId: string): Promise<void> {
  const run = runsByNode.get(runKey(fileUuid, nodeId))
  if (!run || run.running || run.starting) return
  const editor = editorOf(run)
  editor?.clearNodeFlag(nodeId, 'runStage')
  editor?.clearNodeFlag(nodeId, 'runStopped')
  const result = await startRun(run, { resume: true })
  if (!result.ok) {
    reportRendererError(`Failed to resume palace generation: ${result.error}`)
    editor?.setNodeFlag(nodeId, 'runStopped', true)
  }
}

/** Stop the run's stream; the node keeps its placeholder for a later resume. */
export function stopPalaceRun(fileUuid: string, nodeId: string): void {
  const run = runsByNode.get(runKey(fileUuid, nodeId))
  if (run?.running && run.streamId) void window.mindlane?.ai.stopStream(run.streamId)
}

/**
 * Route one stream event to its palace run. Returns false when no palace run
 * owns the stream (the chat session route handles it then).
 */
export function handlePalaceRunEvent(event: ChatStreamEvent): boolean {
  const run = runsByStream.get(event.streamId)
  if (!run) return false
  handleRunEvent(run, event)
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
  run.running = false
}

function forgetRun(run: ActiveRun): void {
  forgetStream(run)
  runsByNode.delete(runKey(run.fileUuid, run.nodeId))
}

/** Keep the placeholder and offer a resume: the private thread stays resumable. */
function settleStopped(run: ActiveRun, error?: string): void {
  if (error) reportRendererError(`Palace generation failed: ${error}`)
  const editor = editorOf(run)
  editor?.clearNodeFlag(run.nodeId, 'runStage')
  editor?.setNodeFlag(run.nodeId, 'runStopped', true)
  run.handlers.settle()
}
