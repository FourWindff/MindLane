import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { HumanMessage, AIMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages'
import { FakeListChatModel } from '@langchain/core/utils/testing'
import { Consolidator } from '../consolidator.js'
import { SessionManager } from '../sessionManager.js'
import { LLMProvider, ProviderCapability } from '../../providers/base.js'

class FakeProvider extends LLMProvider {
  constructor(model: import('@langchain/core/language_models/chat_models').BaseChatModel) {
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
    messages.push(
      i % 2 === 0
        ? new HumanMessage(`message ${i} with some content to consume tokens`)
        : new AIMessage(`reply ${i} with enough text to be tokenized`),
    )
  }
  return messages
}

describe('Consolidator integration', () => {
  let tmpDir: string
  let manager: SessionManager

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'consolidator-int-'))
    manager = new SessionManager()
    await manager.init(path.join(tmpDir, 'app.db'), { userDataPath: tmpDir })
    manager.setWorkspace('/workspace/test')
  })

  afterEach(() => {
    manager.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('200 条消息会话归档后进入 LLM 的消息数 ≤ 120 且摘要注入系统提示词', async () => {
    const sessionId = 'long-session'
    await manager.saveMessages(sessionId, makeMessages(200))

    const buildMessages = async (
      messages: BaseMessage[],
      lastSummary?: string,
    ): Promise<BaseMessage[]> => [
      new SystemMessage(lastSummary ? `历史摘要：${lastSummary}` : 'system'),
      ...messages,
    ]
    const getToolDefinitions = () => []

    const provider = new FakeProvider(
      new FakeListChatModel({
        responses: ['用户讨论了 AI 助手项目的技术栈与实现方案'],
      }),
    )

    const consolidator = new Consolidator(
      {
        sessionManager: manager,
        provider,
        buildMessages,
        getToolDefinitions,
      },
      {
        contextWindowTokens: 1_000,
        maxCompletionTokens: 0,
        safetyBuffer: 0,
        consolidationRatio: 0.5,
        maxContextMessages: 120,
        maxMessagesBeforeTokenCheck: 120,
        maxConsolidationRounds: 10,
      },
    )

    const changed = await consolidator.maybe_consolidate_by_tokens(sessionId)
    expect(changed).toBe(true)

    const meta = manager.getSessionMeta(sessionId)
    expect(meta?.lastConsolidated).toBeGreaterThan(0)
    expect(meta?._lastSummary).toContain('AI 助手项目')

    const historyPath = manager.resolveHistoryPath(sessionId)
    expect(fs.existsSync(historyPath)).toBe(true)

    const contextMessages = await consolidator.getMessagesForContext(sessionId, {
      maxMessages: 120,
      budget: 1_000,
    })
    expect(contextMessages.length).toBeLessThanOrEqual(120)

    const systemMessages = contextMessages.filter((m) => m.getType() === 'system')
    expect(systemMessages.length).toBe(0)

    // 验证 buildMessages 回调能把 _lastSummary 注入系统提示词。
    const fullMessages = await buildMessages(contextMessages, meta?._lastSummary)
    const systemPrompt = fullMessages[0].content
    expect(systemPrompt).toContain('历史摘要')
    expect(systemPrompt).toContain('AI 助手项目')
  })
})
