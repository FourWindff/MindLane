import { AIMessage, HumanMessage, RemoveMessage, type BaseMessage } from '@langchain/core/messages'
import { REMOVE_ALL_MESSAGES } from '@langchain/langgraph'
import type { AiService } from './service.js'
import type { MainGraphStateType } from './state.js'
import type { ToolRegistry } from './tools/registry.js'
import type { MindmapContextData } from './tools/mindmapContext.js'
import type { DocumentRef } from '../../src/shared/lib/fileFormat.js'
import { AGENT_LIMITS } from './config.js'
import { extractTextContent } from './utils.js'
import { logger } from '../shared/logger.js'
import type { ChatStreamEvent } from '../preload.js'

type ChatStreamEventType = ChatStreamEvent['type']

export interface StreamRequest {
  sessionId: string
  message: string
  workspaceUuid: string
  context: MindmapContextData
  documentRef?: DocumentRef
}

export interface StreamResponse {
  content: string
  messages?: Array<{ role: 'assistant'; content: string; toolCalls?: unknown[] }>
  toolCalls?: unknown[]
  mindmapData?: unknown
  palaceData?: unknown
}

interface StreamGraph {
  stream: (
    input: Partial<MainGraphStateType>,
    config: Record<string, unknown>,
  ) => Promise<AsyncIterable<[string, unknown]>>
  getState: (config: Record<string, unknown>) => Promise<{ values: MainGraphStateType }>
}

export interface StreamRuntime {
  graph: StreamGraph
  toolRegistry: ToolRegistry
  buildResponse: (state: MainGraphStateType, streamingContent?: string) => StreamResponse
  provider?: unknown
}

interface StreamManagerOptions {
  aiService: AiService
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
    this.abortController.abort()
  }

  async run(): Promise<void> {
    const { sessionManager } = this.options.aiService
    if (sessionManager?.isReady()) {
      return sessionManager.runInWorkspace(this.options.request.workspaceUuid, () => this.execute())
    }
    return this.execute()
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
            { id?: string; content?: unknown },
            Record<string, unknown>,
          ]
          if (metadata?.langgraph_node && metadata.langgraph_node !== 'supervisor') continue
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
          }
          if (event.event === 'on_tool_start') {
            if (event.name === 'batchAddMindmapNodes') this.emit('step', 'generating-map')
            this.emit('tool-start', {
              name: event.name ?? 'unknown',
              input: (event.input ?? {}) as Record<string, unknown>,
            })
          } else if (event.event === 'on_tool_end') {
            this.emit('tool-end', {
              name: event.name ?? 'unknown',
              output:
                typeof event.output === 'string'
                  ? event.output
                  : JSON.stringify(event.output ?? ''),
            })
          }
        } else if (mode === 'custom') {
          const event = payload as { type?: string; step?: string }
          if (event.type === 'mindmap-progress' && event.step) this.emit('step', event.step)
        }
      }

      const result = await this.readResult()
      if (this.abortController.signal.aborted) {
        await this.persistAbortedResult(result, fullContent)
        this.emit('end', { content: fullContent || '（已停止生成）' })
        this.extractMemory()
        return
      }
      if (result) {
        await this.persistResult(result)
        this.emit('end', runtime.buildResponse(result, fullContent))
      } else {
        await this.persistPartialContent(fullContent)
        this.emit('end', { content: fullContent || '（已停止生成）' })
      }
      this.extractMemory()
    } catch (error) {
      if (this.abortController.signal.aborted) {
        await this.persistPartialContent(fullContent)
        this.emit('end', { content: fullContent || '（已停止生成）' })
        this.extractMemory()
        return
      }
      this.emit('error', error instanceof Error ? error.message : String(error))
    }
  }

  private async prepareHistory(): Promise<BaseMessage[]> {
    const { request, aiService } = this.options
    const humanMessage = new HumanMessage({
      content: request.message,
      additional_kwargs: request.documentRef
        ? { attachment: { name: request.documentRef.filename, type: request.documentRef.type } }
        : {},
    })
    const sessionManager = aiService.sessionManager
    if (!sessionManager?.isReady()) return [humanMessage]

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
      logger.warn('[Runner] getState failed, falling back to streaming content:', error)
      return null
    }
  }

  private async persistResult(result: MainGraphStateType): Promise<void> {
    const { aiService, request } = this.options
    if (!aiService.sessionManager?.isReady()) return
    const lastHumanIndex = result.messages.findLastIndex((message) => message.type === 'human')
    const messages =
      lastHumanIndex >= 0 ? result.messages.slice(lastHumanIndex + 1) : result.messages
    if (messages.length > 0) {
      await aiService.sessionManager.saveMessages(
        request.sessionId,
        messages,
        request.context.fileUuid,
      )
    }
  }

  private async persistPartialContent(content: string): Promise<void> {
    if (!content || !this.options.aiService.sessionManager?.isReady()) return
    await this.options.aiService.sessionManager.saveMessage(
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
    const lastHumanIndex = result.messages.findLastIndex((message) => message.type === 'human')
    const currentTurn =
      lastHumanIndex >= 0 ? result.messages.slice(lastHumanIndex + 1) : result.messages
    const contentAlreadyPersisted = currentTurn.some(
      (message) => message.type === 'ai' && extractTextContent(message.content) === content,
    )
    if (!contentAlreadyPersisted) await this.persistPartialContent(content)
  }

  private extractMemory(): void {
    const { request, aiService, runtime } = this.options
    if (!aiService.memoryExtractor || !request.context?.filePath || !runtime.provider) return
    void (async () => {
      try {
        const messages = aiService.sessionManager?.isReady()
          ? await aiService.sessionManager.loadSessionMessages(request.sessionId)
          : await aiService.checkpointer.getMessages(request.sessionId)
        await aiService.memoryExtractor?.extractAndPersist({
          provider: runtime.provider as never,
          messages,
          mindmapSummary: request.context?.mindmapSummary || '',
          filePath: request.context!.filePath!,
        })
      } catch (error) {
        logger.warn('[Runner] Memory extraction failed:', error)
      }
    })()
  }

  private emit(type: ChatStreamEventType, payload: unknown): void {
    this.options.eventSink({
      streamId: this.options.streamId,
      sessionId: this.options.request.sessionId,
      type,
      payload,
    })
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
