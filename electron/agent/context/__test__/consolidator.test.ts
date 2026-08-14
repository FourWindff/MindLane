import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { HumanMessage, AIMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages'
import { FakeListChatModel } from '@langchain/core/utils/testing'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { Consolidator } from '../consolidator.js'
import { SessionManager } from '../sessionManager.js'
import { LLMProvider, ProviderCapability } from '../../providers/base.js'
import { MemoryExtractor, createExtractionCallback } from '../../memory/memoryExtractor.js'
import { MemoryManager } from '../../memory/memoryManager.js'
import { EditLogStore } from '../../memory/editLogStore.js'

class FakeProvider extends LLMProvider {
  constructor(model: BaseChatModel) {
    super(model)
  }

  get capabilities(): Set<ProviderCapability> {
    return new Set([ProviderCapability.Chat])
  }

  get chatModels() {
    return []
  }
}

function makeMessages(count: number): BaseMessage[] {
  const messages: BaseMessage[] = []
  for (let i = 0; i < count; i++) {
    messages.push(i % 2 === 0 ? new HumanMessage(`message ${i}`) : new AIMessage(`reply ${i}`))
  }
  return messages
}

describe('Consolidator', () => {
  let tmpDir: string
  let manager: SessionManager
  let buildMessages: (messages: BaseMessage[], lastSummary?: string) => Promise<BaseMessage[]>
  let getToolDefinitions: () => []
  const fileUuid = 'file-uuid-1'

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'consolidator-'))
    manager = new SessionManager()
    await manager.init(tmpDir)
    manager.setWorkspace('/workspace/test', 'workspace-uuid-1')

    buildMessages = async (messages, lastSummary) => [
      new SystemMessage(lastSummary ? `Summary: ${lastSummary}` : 'system'),
      ...messages,
    ]
    getToolDefinitions = () => []
  })

  afterEach(() => {
    manager.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('消息数量未超阈值时跳过归档', async () => {
    const sessionId = 'skip'
    await manager.saveMessages(sessionId, makeMessages(2), fileUuid)

    const provider = new FakeProvider(new FakeListChatModel({ responses: [] }))
    const consolidator = new Consolidator(
      { sessionManager: manager, provider, buildMessages, getToolDefinitions },
      {
        contextWindowTokens: 100,
        maxCompletionTokens: 0,
        safetyBuffer: 0,
        consolidationRatio: 0.5,
        maxContextMessages: 120,
        maxMessagesBeforeTokenCheck: 5,
        maxConsolidationRounds: 5,
      },
    )

    const changed = await consolidator.maybe_consolidate_by_tokens(sessionId)
    expect(changed).toBe(false)

    const meta = manager.getSessionMeta(sessionId)
    expect(meta?.lastConsolidated).toBeUndefined()
  })

  it('pickConsolidationBoundary 优先在 user 消息边界处结束', () => {
    const provider = new FakeProvider(new FakeListChatModel({ responses: [] }))
    const consolidator = new Consolidator(
      { sessionManager: manager, provider, buildMessages, getToolDefinitions },
      {
        contextWindowTokens: 1000,
        maxCompletionTokens: 0,
        safetyBuffer: 0,
        consolidationRatio: 0.5,
        maxContextMessages: 120,
        maxMessagesBeforeTokenCheck: 120,
        maxConsolidationRounds: 5,
      },
    )

    const messages = [
      new HumanMessage('a'),
      new AIMessage('b'),
      new HumanMessage('c'),
      new AIMessage('d'),
    ]

    const boundary = consolidator.pickConsolidationBoundary(messages, 3)
    expect(boundary).toBe(2)
  })

  it('多轮压缩后推进 lastConsolidated 并写入滚动摘要', async () => {
    const sessionId = 'archive'
    const messages = makeMessages(20)
    await manager.saveMessages(sessionId, messages, fileUuid)

    const provider = new FakeProvider(
      new FakeListChatModel({ responses: ['summary one', 'summary two'] }),
    )
    const consolidator = new Consolidator(
      { sessionManager: manager, provider, buildMessages, getToolDefinitions },
      {
        contextWindowTokens: 30,
        maxCompletionTokens: 0,
        safetyBuffer: 0,
        consolidationRatio: 0.5,
        maxContextMessages: 120,
        maxMessagesBeforeTokenCheck: 3,
        maxConsolidationRounds: 5,
      },
    )

    const changed = await consolidator.maybe_consolidate_by_tokens(sessionId)
    expect(changed).toBe(true)

    const meta = manager.getSessionMeta(sessionId)
    expect(meta?.lastConsolidated ?? 0).toBeGreaterThan(0)
    // 滚动摘要：最新一轮摘要写入 meta，不再写 history 文件
    expect(meta?._lastSummary).toContain('summary one')
  })

  it('LLM 失败时不推进游标（下轮 run 自愈）', async () => {
    const sessionId = 'raw'
    const messages = makeMessages(20)
    await manager.saveMessages(sessionId, messages, fileUuid)

    const throwingModel = new FakeListChatModel({ responses: [] })
    throwingModel.invoke = async () => {
      throw new Error('model error')
    }
    const provider = new FakeProvider(throwingModel)
    const consolidator = new Consolidator(
      { sessionManager: manager, provider, buildMessages, getToolDefinitions },
      {
        contextWindowTokens: 30,
        maxCompletionTokens: 0,
        safetyBuffer: 0,
        consolidationRatio: 0.5,
        maxContextMessages: 120,
        maxMessagesBeforeTokenCheck: 3,
        maxConsolidationRounds: 5,
      },
    )

    const changed = await consolidator.maybe_consolidate_by_tokens(sessionId)
    expect(changed).toBe(false)

    const meta = manager.getSessionMeta(sessionId)
    expect(meta?.lastConsolidated).toBeUndefined()
    expect(meta?._lastSummary).toBeUndefined()
  })

  it('getMessagesForContext 限制条数与 token 预算', async () => {
    const sessionId = 'context'
    const messages = makeMessages(11)
    await manager.saveMessages(sessionId, messages, fileUuid)

    const provider = new FakeProvider(new FakeListChatModel({ responses: [] }))
    const consolidator = new Consolidator(
      { sessionManager: manager, provider, buildMessages, getToolDefinitions },
      {
        contextWindowTokens: 1000,
        maxCompletionTokens: 0,
        safetyBuffer: 0,
        consolidationRatio: 0.5,
        maxContextMessages: 4,
        maxMessagesBeforeTokenCheck: 120,
        maxConsolidationRounds: 5,
      },
    )

    const contextMessages = await consolidator.getMessagesForContext(sessionId, {
      maxMessages: 4,
      budget: 20,
    })

    // 条数上限 4 条非系统消息 + 可能保留的系统消息
    const nonSystem = contextMessages.filter((m) => m.getType() !== 'system')
    expect(nonSystem.length).toBeLessThanOrEqual(4)

    // 最后一条是当前用户消息
    expect(contextMessages[contextMessages.length - 1].getType()).toBe('human')
  })

  it('getMessagesForContext 保留系统消息与当前用户消息', async () => {
    const sessionId = 'retain'
    const messages: BaseMessage[] = [
      new SystemMessage('environment'),
      new HumanMessage('old'),
      new AIMessage('old reply'),
      new HumanMessage('current'),
    ]
    await manager.saveMessages(sessionId, messages, fileUuid)

    const provider = new FakeProvider(new FakeListChatModel({ responses: [] }))
    const consolidator = new Consolidator(
      { sessionManager: manager, provider, buildMessages, getToolDefinitions },
      {
        contextWindowTokens: 1000,
        maxCompletionTokens: 0,
        safetyBuffer: 0,
        consolidationRatio: 0.5,
        maxContextMessages: 1,
        maxMessagesBeforeTokenCheck: 120,
        maxConsolidationRounds: 5,
      },
    )

    const contextMessages = await consolidator.getMessagesForContext(sessionId, {
      maxMessages: 1,
      budget: 2,
    })

    const types = contextMessages.map((m) => m.getType())
    expect(types).toContain('system')
    expect(types[types.length - 1]).toBe('human')
    expect(contextMessages[contextMessages.length - 1].content).toBe('current')
  })

  it('并发调用同一会话串行执行', async () => {
    const sessionId = 'concurrent'
    const messages = makeMessages(30)
    await manager.saveMessages(sessionId, messages, fileUuid)

    const provider = new FakeProvider(new FakeListChatModel({ responses: ['one', 'two'] }))
    const consolidator = new Consolidator(
      { sessionManager: manager, provider, buildMessages, getToolDefinitions },
      {
        contextWindowTokens: 40,
        maxCompletionTokens: 0,
        safetyBuffer: 0,
        consolidationRatio: 0.5,
        maxContextMessages: 120,
        maxMessagesBeforeTokenCheck: 3,
        maxConsolidationRounds: 5,
      },
    )

    await Promise.all([
      consolidator.maybe_consolidate_by_tokens(sessionId),
      consolidator.maybe_consolidate_by_tokens(sessionId),
    ])

    const meta = manager.getSessionMeta(sessionId)
    expect(meta?.lastConsolidated ?? 0).toBeGreaterThan(0)
    expect(meta?._lastSummary).toBeDefined()
  })
})

describe('Consolidator 提取回调接缝', () => {
  let tmpDir: string
  let manager: SessionManager
  let buildMessages: (messages: BaseMessage[], lastSummary?: string) => Promise<BaseMessage[]>
  const workspaceUuid = 'workspace-uuid-1'
  const fileUuid = 'file-uuid-1'

  const ARCHIVE_LIMITS = {
    contextWindowTokens: 30,
    maxCompletionTokens: 0,
    safetyBuffer: 0,
    consolidationRatio: 0.5,
    maxContextMessages: 120,
    maxMessagesBeforeTokenCheck: 3,
    maxConsolidationRounds: 5,
  }

  const EXTRACTION_JSON = JSON.stringify({
    disciplines: [
      {
        name: 'engineering',
        patterns: [
          { subTag: 'modular', description: '用户偏好模块化', observation: '倾向组件化设计' },
        ],
      },
    ],
  })

  /** Summary calls return text; extraction calls (prompt contains the analyst marker) return JSON. */
  function makeExtractionAwareModel(): BaseChatModel {
    const model = new FakeListChatModel({ responses: ['summary'] })
    model.invoke = (async (input: unknown) => {
      const text = JSON.stringify(input)
      return new AIMessage(text.includes('认知模式分析师') ? EXTRACTION_JSON : 'summary')
    }) as unknown as BaseChatModel['invoke']
    return model
  }

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'consolidator-seam-'))
    manager = new SessionManager()
    await manager.init(tmpDir)
    manager.setWorkspace('/workspace/test', workspaceUuid)

    buildMessages = async (messages, lastSummary) => [
      new SystemMessage(lastSummary ? `Summary: ${lastSummary}` : 'system'),
      ...messages,
    ]
  })

  afterEach(() => {
    manager.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('归档后 onArchived 收到全部归档切片', async () => {
    const sessionId = 'callback-slice'
    await manager.saveMessages(sessionId, makeMessages(20), fileUuid)

    const onArchived = vi.fn()
    const provider = new FakeProvider(new FakeListChatModel({ responses: ['summary'] }))
    const consolidator = new Consolidator(
      {
        sessionManager: manager,
        provider,
        buildMessages,
        getToolDefinitions: () => [],
        onArchived,
      },
      ARCHIVE_LIMITS,
    )

    const changed = await consolidator.maybe_consolidate_by_tokens(sessionId)
    expect(changed).toBe(true)

    await vi.waitFor(() => expect(onArchived).toHaveBeenCalledTimes(1))
    const slice = onArchived.mock.calls[0]![0] as BaseMessage[]
    expect(slice.length).toBeGreaterThan(0)
    expect(slice.every((m) => typeof m.getType === 'function')).toBe(true)
    // 回调切片与推进后的游标一致：同一批消息不会被重复提取
    const meta = manager.getSessionMeta(sessionId)
    expect(slice.length).toBe(meta?.lastConsolidated)
  })

  it('未发生归档时不触发 onArchived', async () => {
    const sessionId = 'no-archive'
    await manager.saveMessages(sessionId, makeMessages(2), fileUuid)

    const onArchived = vi.fn()
    const provider = new FakeProvider(new FakeListChatModel({ responses: [] }))
    const consolidator = new Consolidator(
      {
        sessionManager: manager,
        provider,
        buildMessages,
        getToolDefinitions: () => [],
        onArchived,
      },
      { ...ARCHIVE_LIMITS, contextWindowTokens: 100, maxMessagesBeforeTokenCheck: 5 },
    )

    const changed = await consolidator.maybe_consolidate_by_tokens(sessionId)
    expect(changed).toBe(false)
    expect(onArchived).not.toHaveBeenCalled()
  })

  it('提取成功后 editlog 被删除且记忆已写入', async () => {
    const sessionId = 'extract-success'
    await manager.saveMessages(sessionId, makeMessages(20), fileUuid)

    const editLogStore = new EditLogStore(tmpDir)
    await editLogStore.append(workspaceUuid, fileUuid, {
      ts: 1,
      nodeId: 'n1',
      before: 'AI 写的',
      after: '用户改的',
    })

    const extractor = new MemoryExtractor(new MemoryManager(tmpDir))
    const provider = new FakeProvider(makeExtractionAwareModel())
    const consolidator = new Consolidator(
      {
        sessionManager: manager,
        provider,
        buildMessages,
        getToolDefinitions: () => [],
        onArchived: createExtractionCallback({
          extractor,
          editLogStore,
          provider,
          workspaceUuid,
          fileUuid,
        }),
      },
      ARCHIVE_LIMITS,
    )

    const changed = await consolidator.maybe_consolidate_by_tokens(sessionId)
    expect(changed).toBe(true)

    // 提取回调是 fire-and-forget：等它落地后断言产物
    await vi.waitFor(async () => {
      expect(await editLogStore.read(workspaceUuid, fileUuid)).toEqual([])
    })
    const memoryDir = path.join(tmpDir, 'mindlanememory')
    const memoryContent = fs.readFileSync(path.join(memoryDir, 'engineering-modular.md'), 'utf-8')
    expect(memoryContent).toContain('倾向组件化设计')
  })

  it('提取回调抛错时压缩不受影响且 editlog 保留', async () => {
    const sessionId = 'extract-failure'
    await manager.saveMessages(sessionId, makeMessages(20), fileUuid)

    const editLogStore = new EditLogStore(tmpDir)
    await editLogStore.append(workspaceUuid, fileUuid, {
      ts: 1,
      nodeId: 'n1',
      before: 'AI 写的',
      after: '用户改的',
    })

    const failingExtractor = {
      extractAndPersist: vi.fn(async () => {
        throw new Error('extraction boom')
      }),
    }
    const provider = new FakeProvider(new FakeListChatModel({ responses: ['summary'] }))
    const consolidator = new Consolidator(
      {
        sessionManager: manager,
        provider,
        buildMessages,
        getToolDefinitions: () => [],
        onArchived: createExtractionCallback({
          extractor: failingExtractor as never,
          editLogStore,
          provider,
          workspaceUuid,
          fileUuid,
        }),
      },
      ARCHIVE_LIMITS,
    )

    const changed = await consolidator.maybe_consolidate_by_tokens(sessionId)
    expect(changed).toBe(true)

    await vi.waitFor(() => expect(failingExtractor.extractAndPersist).toHaveBeenCalled())

    // 压缩主流程产物完好
    const meta = manager.getSessionMeta(sessionId)
    expect(meta?._lastSummary).toBe('summary')
    // 提取失败：editlog 证据保留
    expect((await editLogStore.read(workspaceUuid, fileUuid)).length).toBe(1)
  })
})
