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
import type { ChatStreamEvent, StreamResponse } from '../ipc.js'
import { isStreamStep, serializeTurnState, splitCurrentTurn } from '../ipc.js'

type ChatStreamEventPayload<T extends ChatStreamEvent['type']> = Extract<
  ChatStreamEvent,
  { type: T }
>['payload']

const runnerLog = logger.withContext('runner')

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

/** Tool result status: write tools return an `{ok}` envelope; ok=false is an error, everything else succeeded. */
function deriveToolStatus(output: string): 'success' | 'error' {
  try {
    const parsed = JSON.parse(output) as { ok?: unknown }
    if (parsed.ok === false) return 'error'
  } catch {
    /* non-JSON output — completed normally */
  }
  return 'success'
}

export interface StreamRequest {
  sessionId: string
  message: string
  workspaceUuid: string
  context: ChatContext
  documentRef?: DocumentRef
}

/**
 * 运行时所需的 graph 最小面。stream 的元组对齐 LangGraph 实际输出
 * （只读元组 [mode, payload]）；编译期无法与 LangGraph 泛型 stream 完全
 * 结构匹配，由 orchestrator 装配时做一次局部强转并注释原因。
 */
export interface StreamGraph {
  stream: (
    input: Partial<MainGraphStateType>,
    config: Record<string, unknown>,
  ) => Promise<AsyncIterable<readonly [string, unknown]>>
  getState: (config: Record<string, unknown>) => Promise<{ values: MainGraphStateType }>
}

export interface StreamRuntime {
  graph: StreamGraph
  toolRegistry: ToolRegistry
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

  async run(): Promise<void> {
    const { sessionManager } = this.options
    const execute = () => runWithStreamId(this.options.streamId, () => this.execute())
    // 契约：SessionManager 在应用启动时装配完成，无需 isReady 守卫。
    return sessionManager.runInWorkspace(this.options.request.workspaceUuid, execute)
  }

  private async execute(): Promise<void> {
    const { request, runtime } = this.options
    let fullContent = ''
    let currentSegmentContent = ''
    let currentMessageId: string | null = null

    try {
      const history = await this.prepareHistory()
      const initialState: Partial<MainGraphStateType> = {
        messages: history,
        context: request.context,
        documentRef: request.documentRef ?? null,
      }
      const config = {
        signal: this.abortController.signal,
        recursionLimit: AGENT_LIMITS.recursionLimit,
        streamMode: ['messages', 'tools', 'custom'],
        configurable: {
          thread_id: request.sessionId,
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
          // 子图 ToolMessage 到达（subgraphResult 节点产物，langgraph_node 非
          // supervisor）：虚拟子图调用不走 ToolNode，tools 模式无事件，这里补发 tool-end。
          if (message.type === 'tool' && isSubgraphCall(message.name ?? '')) {
            const output =
              typeof message.content === 'string'
                ? message.content
                : JSON.stringify(message.content ?? '')
            this.emit('tool-end', {
              id: message.tool_call_id ?? '',
              name: message.name ?? 'unknown',
              status: deriveToolStatus(output),
              output,
            })
            continue
          }
          if (metadata?.langgraph_node && metadata.langgraph_node !== 'supervisor') continue
          // 子图虚拟调用补发 tool-start：supervisor 的 AI 消息 chunk 携带子图工具调用。
          for (const toolCall of message.tool_calls ?? []) {
            if (isSubgraphCall(toolCall.name ?? '')) {
              this.emit('tool-start', {
                id: toolCall.id ?? '',
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
              id: event.toolCallId ?? '',
              name: event.name ?? 'unknown',
              input: (event.input ?? {}) as Record<string, unknown>,
            })
          } else if (event.event === 'on_tool_end') {
            const output =
              typeof event.output === 'string' ? event.output : JSON.stringify(event.output ?? '')
            runnerLog.info('tool 结果： %s, %s', event.name, summarizeToolResult(output))
            this.emit('tool-end', {
              id: event.toolCallId ?? '',
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
              id: event.toolCallId ?? '',
              name: event.name ?? 'unknown',
              status: 'error',
              output,
            })
          }
        } else if (mode === 'custom') {
          const event = payload as {
            type?: string
            step?: string
            completed?: number
            total?: number
          }
          if (event.type === 'mindmap-progress' && isStreamStep(event.step)) {
            // 契约：step payload 为 { step, completed?, total? }，计数必须透传（卡片渲染 n/m）。
            this.emit('step', {
              step: event.step,
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

  private async prepareHistory(): Promise<BaseMessage[]> {
    const { request, sessionManager } = this.options
    // 轮次状态：主进程在持久化时把编辑器状态序列化为 `<EDITOR_STATE>` 块，
    // 附加到该轮用户消息末尾（`问题\n<EDITOR_STATE>…</EDITOR_STATE>`）再保存。
    // 模型输入、checkpointer 不过滤；展示 / 滚动摘要 / 记忆提取在各自入口剥离。
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
        configurable: { thread_id: this.options.request.sessionId },
      })
      return snapshot.values
    } catch (error) {
      runnerLog.warn('getState failed, falling back to streaming content:', error)
      return null
    }
  }

  private async persistResult(result: MainGraphStateType): Promise<void> {
    const { sessionManager, request } = this.options
    const { current } = splitCurrentTurn(result.messages)
    if (current.length > 0) {
      await sessionManager.saveMessages(request.sessionId, current, request.context.fileUuid)
    }
  }

  private async persistPartialContent(content: string): Promise<void> {
    if (!content) return
    await this.options.sessionManager.saveMessage(
      this.options.request.sessionId,
      new AIMessage(content),
      this.options.request.context.fileUuid,
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
