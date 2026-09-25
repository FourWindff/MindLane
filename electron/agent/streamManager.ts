import { AIMessage, HumanMessage, RemoveMessage, type BaseMessage } from '@langchain/core/messages'
import { REMOVE_ALL_MESSAGES } from '@langchain/langgraph'
import type { SessionManager } from './context/sessionManager.js'
import type { MainGraphStateType } from './state.js'
import type { ToolRegistry } from './tools/registry.js'
import type { ChatContext } from '../ipc.js'
import type { DocumentRef } from '../../src/shared/lib/fileFormat.js'
import { AGENT_LIMITS } from './config.js'
import { extractTextContent } from './utils.js'
import { logger } from '../shared/logger.js'
import { runWithStreamId, shortStreamId } from '../shared/runContext.js'
import { isSubgraphCall } from './subgraphRouter.js'
import { deriveToolStatus } from './toolStatus.js'
import type {
  ChatStreamEvent,
  EphemeralRunRequest,
  PalaceArtworkStyle,
  StreamResponse,
} from '../ipc.js'
import {
  isStreamStep,
  serializeTurnState,
  splitCurrentTurn,
  SUBGRAPH_PROGRESS_EVENT,
} from '../ipc.js'

type ChatStreamEventPayload<T extends ChatStreamEvent['type']> = Extract<
  ChatStreamEvent,
  { type: T }
>['payload']

const runnerLog = logger.withContext('runner')

/**
 * Resolve the tool-event id. LangGraph reliable supplies toolCallId; when it is
 * missing this is a contract violation, so it is logged loudly instead of
 * silently degrading every card to the shared `''` id (which would collide if a
 * renderer ever keys on id). The `''` sentinel is kept so the event still flows
 * and name-based matching still works — a skipped start/end would leave a card
 * stuck running forever.
 */
function toolEventId(id: string | undefined, name: string | undefined, phase: string): string {
  if (!id) {
    runnerLog.error(
      '%s 缺少 toolCallId（langgraph 契约违例）：%s，卡片将退化为按 name 匹配',
      phase,
      name ?? 'unknown',
    )
  }
  return id ?? ''
}

/** One-line preview of tool args for info logs; full payload goes to debug. */
function summarizeToolPayload(payload: unknown): string {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload ?? {})
  return text.length > 200 ? `${text.slice(0, 200)}…` : text
}

/** Result summary must expose scale (chars / node count) so "succeeded but empty" is visible. */
function summarizeToolResult(output: string): string {
  let size = `${output.length} 字符`
  try {
    const parsed = JSON.parse(output) as { nodes?: unknown[] }
    if (Array.isArray(parsed?.nodes)) size = `${parsed.nodes.length} 节点, ${size}`
  } catch {
    /* not JSON — chars only */
  }
  const preview = output.length > 120 ? `${output.slice(0, 120)}…` : output
  return `${size}, ${preview}`
}

export interface StreamRequest {
  sessionId: string
  message: string
  /** Workspace of the run's session store; unused by ephemeral runs. */
  workspaceUuid: string
  context: ChatContext
  documentRef?: DocumentRef
  /**
   * Ephemeral mode (manual palace): no session read or write, private thread.
   * Omitted means normal session mode (default): persist, build history, and
   * use sessionId as the checkpoint thread.
   */
  ephemeral?: EphemeralRunRequest
}

/**
 * The minimal graph surface the runtime needs. The stream tuples align with
 * LangGraph's actual output (read-only tuples [mode, payload]); the compiler
 * cannot fully match LangGraph's generic stream signatures, so the orchestrator
 * does one local cast at assembly time and documents why.
 */
export interface StreamGraph {
  stream: (
    input: Partial<MainGraphStateType> | null,
    config: Record<string, unknown>,
  ) => Promise<AsyncIterable<readonly [string, unknown]>>
  getState: (config: Record<string, unknown>) => Promise<{
    values: MainGraphStateType
    /** Pending super-step targets; empty once the thread reached the end. */
    next?: string[]
  }>
}

export interface StreamRuntime {
  graph: StreamGraph
  toolRegistry: ToolRegistry
  artworkStyle: PalaceArtworkStyle
  buildResponse: (state: MainGraphStateType, streamingContent?: string) => StreamResponse
}

interface StreamManagerOptions {
  sessionManager: SessionManager
  eventSink: (event: ChatStreamEvent) => void
  createRuntime: (request: StreamRequest) => StreamRuntime | Promise<StreamRuntime>
}

interface RunnerOptions extends StreamManagerOptions {
  streamId: string
  request: StreamRequest
  runtime: StreamRuntime
}

export class Runner {
  private readonly abortController = new AbortController()
  private readonly toolSnapshot: readonly unknown[]

  constructor(private readonly options: RunnerOptions) {
    this.toolSnapshot = Object.freeze([...options.runtime.toolRegistry.allTools])
  }

  abort(): void {
    // Called from the IPC context (outside AsyncLocalStorage), so the streamId
    // is attached explicitly rather than auto-derived from the run context.
    logger.withContext(`runner:${shortStreamId(this.options.streamId)}`).info('用户主动停止生成')
    this.abortController.abort()
  }

  /** Ephemeral runs use the private thread; session runs use sessionId. */
  private get checkpointThreadId(): string {
    return this.options.request.ephemeral?.privateThreadId ?? this.options.request.sessionId
  }

  async run(): Promise<void> {
    const { sessionManager, request } = this.options
    const execute = () =>
      runWithStreamId(this.options.streamId, request.sessionId, () => this.execute())
    // Contract: SessionManager is assembled at app startup; no isReady guard needed.
    // Ephemeral runs write no session record, so they skip the workspace switch —
    // a standalone file outside any workspace has no workspace to run in.
    if (request.ephemeral) return execute()
    return sessionManager.runInWorkspace(request.workspaceUuid, execute)
  }

  private async execute(): Promise<void> {
    const { runtime } = this.options
    let fullContent = ''
    let currentSegmentContent = ''
    let currentMessageId: string | null = null
    // Subgraph calls declared by the supervisor but not yet executed. The card
    // is created when the subgraph actually starts running (first progress step
    // or its ToolMessage), so streaming order matches the final history order.
    const pendingSubgraphStarts = new Map<
      string,
      { name: string; input: Record<string, unknown> }
    >()

    try {
      const history = await this.prepareHistory()
      const initialState: Partial<MainGraphStateType> | null = await this.buildGraphInput(history)
      const config = {
        signal: this.abortController.signal,
        recursionLimit: AGENT_LIMITS.recursionLimit,
        streamMode: ['messages', 'tools', 'custom'],
        configurable: {
          thread_id: this.checkpointThreadId,
          tool_names: this.toolSnapshot.map(
            (tool) => (tool as { name?: string }).name ?? 'unknown',
          ),
          tool_snapshot: this.toolSnapshot,
        },
      }

      const stream = await runtime.graph.stream(initialState, config)
      for await (const [mode, payload] of stream) {
        if (this.abortController.signal.aborted) break

        if (mode === 'messages') {
          const [message, metadata] = payload as [
            {
              id?: string
              content?: unknown
              type?: string
              name?: string
              tool_call_id?: string
              tool_calls?: Array<{
                id?: string
                name?: string
                args?: Record<string, unknown>
              }>
            },
            Record<string, unknown>,
          ]
          // A subgraph ToolMessage arrived (written by the subgraph's own
          // close-out node; langgraph_node != supervisor): virtual subgraph calls
          // do not go through ToolNode, so tools mode emits nothing; re-emit
          // tool-end here.
          // Progress-less runs also get their tool-start anchored here (before
          // the end), so the card is never declared at supervisor-chunk time.
          if (message.type === 'tool' && isSubgraphCall(message.name ?? '')) {
            // An ephemeral run (manual palace) declares no virtual call and drives
            // no tool cards: its close-out ToolMessage is internal state, and the
            // run's own end event carries the landing payload.
            if (this.options.request.ephemeral) continue
            const subgraphId = message.tool_call_id ?? ''
            const pending = subgraphId ? pendingSubgraphStarts.get(subgraphId) : undefined
            if (pending) {
              pendingSubgraphStarts.delete(subgraphId)
              this.emit('tool-start', {
                id: toolEventId(subgraphId, pending.name, 'subgraph tool-start'),
                name: pending.name,
                input: pending.input,
              })
            }
            const output =
              typeof message.content === 'string'
                ? message.content
                : JSON.stringify(message.content ?? '')
            this.emit('tool-end', {
              id: toolEventId(message.tool_call_id, message.name, 'subgraph tool-end'),
              name: message.name ?? 'unknown',
              status: deriveToolStatus(output),
              output,
            })
            continue
          }
          if (metadata?.langgraph_node && metadata.langgraph_node !== 'supervisor') continue
          // Virtual subgraph calls are not executed through ToolNode, so tools
          // mode emits no event for them. Their card is created when the
          // subgraph actually starts executing — first progress step, or its
          // ToolMessage — NOT when the supervisor declares the call. A single AI
          // message can declare [readMindmap, generateMindmapFragment]; creating
          // the card at declaration time would place it above readMindmap even
          // though read runs first in the final history. Stash the declaration
          // here and let the progress/ToolMessage handlers anchor it.
          for (const toolCall of message.tool_calls ?? []) {
            if (isSubgraphCall(toolCall.name ?? '')) {
              pendingSubgraphStarts.set(toolCall.id ?? '', {
                name: toolCall.name ?? 'unknown',
                input: (toolCall.args ?? {}) as Record<string, unknown>,
              })
            }
          }
          const messageId = message.id ?? null
          if (
            messageId &&
            currentMessageId &&
            messageId !== currentMessageId &&
            currentSegmentContent.trim()
          ) {
            this.emit('message-start', null)
            currentSegmentContent = ''
          }
          if (messageId) currentMessageId = messageId
          const token = extractTextContent(message.content)
          if (token) {
            fullContent += token
            currentSegmentContent += token
            this.emit('token', token)
          }
        } else if (mode === 'tools') {
          const event = payload as {
            event?: string
            name?: string
            input?: unknown
            output?: unknown
            error?: unknown
            toolCallId?: string
          }
          if (event.event === 'on_tool_start') {
            if (event.name === 'insertXmlFragment' || event.name === 'generateMindmapFragment')
              this.emit('step', { step: 'generating-map' })
            runnerLog.info('tool 调用： %s, 参数 %s', event.name, summarizeToolPayload(event.input))
            runnerLog.debug('tool 参数全量： %s, %o', event.name, event.input)
            this.emit('tool-start', {
              id: toolEventId(event.toolCallId, event.name, 'tool-start'),
              name: event.name ?? 'unknown',
              input: (event.input ?? {}) as Record<string, unknown>,
            })
          } else if (event.event === 'on_tool_end') {
            const output =
              typeof event.output === 'string' ? event.output : JSON.stringify(event.output ?? '')
            runnerLog.info('tool 结果： %s, %s', event.name, summarizeToolResult(output))
            this.emit('tool-end', {
              id: toolEventId(event.toolCallId, event.name, 'tool-end'),
              name: event.name ?? 'unknown',
              status: deriveToolStatus(output),
              output,
            })
          } else if (event.event === 'on_tool_error') {
            // LangGraph tools-mode also reports thrown tool errors; without this the
            // card would never get a terminal status (no on_tool_end is emitted).
            const err = event.error as unknown
            const output =
              typeof err === 'string' ? err : err instanceof Error ? err.message : String(err ?? '')
            runnerLog.error('tool 错误： %s, %s', event.name, output)
            this.emit('tool-end', {
              id: toolEventId(event.toolCallId, event.name, 'tool-error'),
              name: event.name ?? 'unknown',
              status: 'error',
              output,
            })
          }
        } else if (mode === 'custom') {
          const event = payload as {
            type?: string
            step?: string
            callId?: string
            completed?: number
            total?: number
          }
          if (event.type === SUBGRAPH_PROGRESS_EVENT && isStreamStep(event.step)) {
            // First subgraph activity: create the pending subgraph card here, so
            // it is ordered by execution time (after any earlier tool) and stays
            // ahead of later tools in the stream. Attribution is by call id —
            // with two subgraphs in one super-step the declaration order says
            // nothing about which one progresses first.
            const callId = event.callId ?? ''
            const pending = callId ? pendingSubgraphStarts.get(callId) : undefined
            if (pending) {
              pendingSubgraphStarts.delete(callId)
              this.emit('tool-start', {
                id: toolEventId(callId, pending.name, 'subgraph tool-start'),
                name: pending.name,
                input: pending.input,
              })
            }
            // Contract: the step payload is { step, callId?, completed?, total? };
            // counts must pass through (cards render n/m).
            this.emit('step', {
              step: event.step,
              ...(callId ? { callId } : {}),
              ...(typeof event.completed === 'number' ? { completed: event.completed } : {}),
              ...(typeof event.total === 'number' ? { total: event.total } : {}),
            })
          }
        }
      }

      const result = await this.readResult()
      if (this.abortController.signal.aborted) {
        await this.persistAbortedResult(result, fullContent)
        this.emit('end', { content: fullContent || '（已停止生成）' })
        return
      }
      if (result) {
        await this.persistResult(result)
        this.emit('end', runtime.buildResponse(result, fullContent))
      } else {
        await this.persistPartialContent(fullContent)
        this.emit('end', { content: fullContent || '（已停止生成）' })
      }
    } catch (error) {
      if (this.abortController.signal.aborted) {
        await this.persistPartialContent(fullContent)
        this.emit('end', { content: fullContent || '（已停止生成）' })
        return
      }
      this.emit('error', error instanceof Error ? error.message : String(error))
    }
  }

  /**
   * Graph input for this run. A resume with a pending super-step continues the
   * private thread with no new input (LangGraph then re-dispatches the pending
   * task, and the mounted subgraph continues from its own checkpointed
   * super-step); every other run builds the normal input.
   */
  private async buildGraphInput(
    history: BaseMessage[],
  ): Promise<Partial<MainGraphStateType> | null> {
    const { request, runtime } = this.options
    if (request.ephemeral?.resume && (await this.hasPendingSuperStep())) return null
    return {
      messages: history,
      context: request.context,
      documentRef: request.documentRef ?? null,
      artworkStyle: runtime.artworkStyle,
      runEntry: request.ephemeral?.runEntry ?? 'chat',
    }
  }

  private async hasPendingSuperStep(): Promise<boolean> {
    try {
      const snapshot = await this.options.runtime.graph.getState({
        configurable: { thread_id: this.checkpointThreadId },
      })
      return (snapshot.next?.length ?? 0) > 0
    } catch (error) {
      runnerLog.warn('resume probe failed, starting a fresh run instead:', error)
      return false
    }
  }

  private async prepareHistory(): Promise<BaseMessage[]> {
    const { request, sessionManager } = this.options
    // Ephemeral runs build no history: the private thread's state comes from its
    // checkpoint alone — no session read, no session write.
    if (request.ephemeral) return []
    // Turn state: on persist, the main process serializes the editor state into
    // an `<EDITOR_STATE>` block appended to the end of that turn's user message
    // (`question\n<EDITOR_STATE>…</EDITOR_STATE>`) before saving. Model input and
    // the checkpointer do not filter it; display / scroll summary / memory
    // extraction strip it at their own entry points.
    const turnState = serializeTurnState(request.context)
    const persistedContent = request.message ? `${request.message}\n${turnState}` : turnState
    const humanMessage = new HumanMessage({
      content: persistedContent,
      additional_kwargs: request.documentRef
        ? { attachment: { name: request.documentRef.filename, type: request.documentRef.type } }
        : {},
    })
    await sessionManager.saveMessage(request.sessionId, humanMessage, request.context.fileUuid)
    const existingMessages = await sessionManager.loadSessionBaseMessages(request.sessionId, {
      includeSystem: false,
    })
    return [new RemoveMessage({ id: REMOVE_ALL_MESSAGES }), ...existingMessages]
  }

  private async readResult(): Promise<MainGraphStateType | null> {
    try {
      const snapshot = await this.options.runtime.graph.getState({
        configurable: { thread_id: this.checkpointThreadId },
      })
      return snapshot.values
    } catch (error) {
      runnerLog.warn('getState failed, falling back to streaming content:', error)
      return null
    }
  }

  private async persistResult(result: MainGraphStateType): Promise<void> {
    const { sessionManager, request } = this.options
    // Ephemeral runs keep their result in the private thread's checkpoint only.
    if (request.ephemeral) return
    const { current } = splitCurrentTurn(result.messages)
    if (current.length > 0) {
      await sessionManager.saveMessages(request.sessionId, current, request.context.fileUuid)
    }
  }

  private async persistPartialContent(content: string): Promise<void> {
    const { sessionManager, request } = this.options
    if (!content || request.ephemeral) return
    await sessionManager.saveMessage(
      request.sessionId,
      new AIMessage(content),
      request.context.fileUuid,
    )
  }

  private async persistAbortedResult(
    result: MainGraphStateType | null,
    content: string,
  ): Promise<void> {
    if (!result) {
      await this.persistPartialContent(content)
      return
    }
    await this.persistResult(result)
    const { current } = splitCurrentTurn(result.messages)
    const contentAlreadyPersisted = current.some(
      (message) => message.type === 'ai' && extractTextContent(message.content) === content,
    )
    if (!contentAlreadyPersisted) await this.persistPartialContent(content)
  }

  private emit<T extends ChatStreamEvent['type']>(
    type: T,
    payload: ChatStreamEventPayload<T>,
  ): void {
    this.options.eventSink({
      streamId: this.options.streamId,
      sessionId: this.options.request.sessionId,
      type,
      payload,
    } as ChatStreamEvent)
  }
}

export class StreamManager {
  private readonly runners = new Map<
    string,
    { abort: () => void; runner: Runner | null; aborted: boolean }
  >()
  private runtime: StreamRuntime | null = null
  private runtimePromise: Promise<StreamRuntime> | null = null

  constructor(private readonly options: StreamManagerOptions) {}

  invalidateRuntime(): void {
    this.runtime = null
    this.runtimePromise = null
  }

  private getRuntime(request: StreamRequest): StreamRuntime | Promise<StreamRuntime> {
    if (this.runtime) return this.runtime
    if (this.runtimePromise) return this.runtimePromise
    const created = this.options.createRuntime(request)
    if (created instanceof Promise) {
      const pending = created.then(
        (runtime) => {
          if (this.runtimePromise === pending) {
            this.runtime = runtime
            this.runtimePromise = null
          }
          return runtime
        },
        (error) => {
          if (this.runtimePromise === pending) this.runtimePromise = null
          throw error
        },
      )
      this.runtimePromise = pending
      return pending
    }
    this.runtime = created
    return created
  }

  startStream(request: StreamRequest): string {
    const streamId = `stream_${crypto.randomUUID()}`
    const entry = {
      aborted: false,
      runner: null as Runner | null,
      abort: () => {
        entry.aborted = true
        entry.runner?.abort()
      },
    }
    this.runners.set(streamId, entry)
    const runWithRuntime = async (runtime: StreamRuntime) => {
      const runner = new Runner({ ...this.options, streamId, request, runtime })
      entry.runner = runner
      if (entry.aborted) runner.abort()
      await runner.run()
    }
    let runtimeOrPromise: StreamRuntime | Promise<StreamRuntime>
    try {
      runtimeOrPromise = this.getRuntime(request)
    } catch (error) {
      this.options.eventSink({
        streamId,
        sessionId: request.sessionId,
        type: 'error',
        payload: error instanceof Error ? error.message : String(error),
      })
      this.runners.delete(streamId)
      return streamId
    }
    const completion =
      runtimeOrPromise instanceof Promise
        ? runtimeOrPromise.then(runWithRuntime)
        : runWithRuntime(runtimeOrPromise)
    void completion
      .catch((error) => {
        this.options.eventSink({
          streamId,
          sessionId: request.sessionId,
          type: 'error',
          payload: error instanceof Error ? error.message : String(error),
        })
      })
      .finally(() => {
        if (this.runners.get(streamId) === entry) this.runners.delete(streamId)
      })
    return streamId
  }

  stopStream(streamId: string): boolean {
    const runner = this.runners.get(streamId)
    if (!runner) return false
    runner.abort()
    return true
  }

  getActiveStreamCount(): number {
    return this.runners.size
  }
}
