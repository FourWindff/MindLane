import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { HumanMessage, AIMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages'
import { FakeListChatModel } from '@langchain/core/utils/testing'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { Consolidator } from '../consolidator.js'
import { SessionManager } from '../sessionManager.js'
import { LLMProvider, ProviderCapability } from '../../providers/base.js'

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

  it('多轮归档后推进 lastConsolidated 并写入 history.jsonl', async () => {
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

    const historyPath = manager.resolveHistoryPath(sessionId)
    expect(fs.existsSync(historyPath)).toBe(true)

    const historyContent = fs.readFileSync(historyPath, 'utf-8')
    expect(historyContent).toContain('summary one')
    expect(meta?._lastSummary).toContain('summary')
  })

  it('LLM 失败时降级为 rawArchive 并仍推进游标', async () => {
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
    expect(changed).toBe(true)

    const historyPath = manager.resolveHistoryPath(sessionId)
    const historyContent = fs.readFileSync(historyPath, 'utf-8')
    expect(historyContent).toContain('[RAW]')

    const meta = manager.getSessionMeta(sessionId)
    expect(meta?.lastConsolidated ?? 0).toBeGreaterThan(0)
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

    const historyPath = manager.resolveHistoryPath(sessionId)
    const historyContent = fs.readFileSync(historyPath, 'utf-8')
    const lines = historyContent.split(/\r?\n/).filter(Boolean)
    expect(lines.length).toBeGreaterThanOrEqual(2)

    const meta = manager.getSessionMeta(sessionId)
    expect(meta?.lastConsolidated ?? 0).toBeGreaterThan(0)
  })
})
