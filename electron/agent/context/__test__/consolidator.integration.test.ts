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

  get models() {
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
  const fileUuid = 'file-uuid-1'
  const workspaceUuid = 'workspace-uuid-1'

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'consolidator-int-'))
    manager = new SessionManager()
    await manager.init(tmpDir)
  })

  /** Production only enters the workspace context inside a run (Runner.run wraps runInWorkspace); tests enter it the same way. */
  const inWs = <T>(fn: () => T): T => manager.runInWorkspace(workspaceUuid, fn)

  afterEach(() => {
    manager.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('archives a 200-message session so at most 120 messages reach the LLM and the summary is injected into the system prompt', async () =>
    inWs(async () => {
      const sessionId = 'long-session'
      await manager.saveMessages(sessionId, makeMessages(200), fileUuid)

      const buildMessages = async (
        messages: BaseMessage[],
        lastSummary?: string,
      ): Promise<BaseMessage[]> => [
        new SystemMessage(lastSummary ? `Summary: ${lastSummary}` : 'system'),
        ...messages,
      ]
      const getToolDefinitions = () => []

      const provider = new FakeProvider(
        new FakeListChatModel({
          responses: [
            'the user discussed the tech stack and implementation plan of the AI assistant project',
          ],
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
          inputBudgetTokens: 1_000,
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
      expect(meta?._lastSummary).toContain('AI assistant project')

      // No {sessionId}.history.jsonl is written anymore: the summary lives only in the session meta
      const sessionsDir = path.join(tmpDir, 'memory', 'sessions', 'workspace-uuid-1')
      expect(fs.readdirSync(sessionsDir).some((f) => f.endsWith('.history.jsonl'))).toBe(false)

      const contextMessages = await consolidator.getMessagesForContext(sessionId, {
        maxMessages: 120,
      })
      expect(contextMessages.length).toBeLessThanOrEqual(120)

      const systemMessages = contextMessages.filter((m) => m.getType() === 'system')
      expect(systemMessages.length).toBe(0)

      // Verify the buildMessages callback can inject _lastSummary into the system prompt.
      const fullMessages = await buildMessages(contextMessages, meta?._lastSummary)
      const systemPrompt = fullMessages[0].content
      expect(systemPrompt).toContain('Summary:')
      expect(systemPrompt).toContain('AI assistant project')
    }))
})
