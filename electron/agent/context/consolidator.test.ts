import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { HumanMessage, AIMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages'
import { FakeListChatModel } from '@langchain/core/utils/testing'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { Consolidator } from './consolidator.js'
import { SessionManager } from './sessionManager.js'
import { LLMProvider, ProviderCapability } from '../providers/base.js'
import { MemoryExtractor, createExtractionCallback } from '../memory/memoryExtractor.js'
import { MemoryManager } from '../memory/memoryManager.js'
import { EditLogStore } from '../memory/editLogStore.js'

class FakeProvider extends LLMProvider {
  constructor(model: BaseChatModel) {
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
  const workspaceUuid = 'workspace-uuid-1'

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'consolidator-'))
    manager = new SessionManager()
    await manager.init(tmpDir)

    buildMessages = async (messages, lastSummary) => [
      new SystemMessage(lastSummary ? `Summary: ${lastSummary}` : 'system'),
      ...messages,
    ]
    getToolDefinitions = () => []
  })

  /** Production only enters the workspace context inside a run (Runner.run wraps runInWorkspace); tests enter it the same way. */
  const inWs = <T>(fn: () => T): T => manager.runInWorkspace(workspaceUuid, fn)

  afterEach(() => {
    manager.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('skips archiving while the message count is below the threshold', async () =>
    inWs(async () => {
      const sessionId = 'skip'
      await manager.saveMessages(sessionId, makeMessages(2), fileUuid)

      const provider = new FakeProvider(new FakeListChatModel({ responses: [] }))
      const consolidator = new Consolidator(
        { sessionManager: manager, provider, buildMessages, getToolDefinitions },
        {
          inputBudgetTokens: 100,
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
    }))

  it('triggers at the threshold when it is below capacity (policy decoupled from capacity)', async () =>
    inWs(async () => {
      const sessionId = 'trigger'
      await manager.saveMessages(sessionId, makeMessages(12), fileUuid)

      const provider = new FakeProvider(new FakeListChatModel({ responses: ['summary'] }))
      const consolidator = new Consolidator(
        { sessionManager: manager, provider, buildMessages, getToolDefinitions },
        {
          // Capacity is far larger than the session: only the policy threshold can trigger archiving.
          inputBudgetTokens: 100_000,
          consolidationTriggerTokens: 10,
          consolidationRatio: 0.5,
          maxContextMessages: 120,
          maxMessagesBeforeTokenCheck: 3,
          maxConsolidationRounds: 5,
        },
      )

      const changed = await consolidator.maybe_consolidate_by_tokens(sessionId)

      expect(changed).toBe(true)
      expect(manager.getSessionMeta(sessionId)?.lastConsolidated).toBeGreaterThan(0)
    }))

  it('pickConsolidationBoundary ends at a user message boundary when possible', () =>
    inWs(async () => {
      const provider = new FakeProvider(new FakeListChatModel({ responses: [] }))
      const consolidator = new Consolidator(
        { sessionManager: manager, provider, buildMessages, getToolDefinitions },
        {
          inputBudgetTokens: 1000,
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
    }))

  it('advances lastConsolidated and writes the rolling summary after multiple compaction rounds', async () =>
    inWs(async () => {
      const sessionId = 'archive'
      const messages = makeMessages(20)
      await manager.saveMessages(sessionId, messages, fileUuid)

      const provider = new FakeProvider(
        new FakeListChatModel({ responses: ['summary one', 'summary two'] }),
      )
      const consolidator = new Consolidator(
        { sessionManager: manager, provider, buildMessages, getToolDefinitions },
        {
          inputBudgetTokens: 30,
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
      // Rolling summary: the latest round's summary is written to meta; no history file is written anymore
      expect(meta?._lastSummary).toContain('summary one')
    }))

  it('does not advance the cursor when the LLM fails (next run self-heals)', async () =>
    inWs(async () => {
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
          inputBudgetTokens: 30,
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
    }))

  it('getMessagesForContext limits the message count and the token budget', async () =>
    inWs(async () => {
      const sessionId = 'context'
      const messages = makeMessages(11)
      await manager.saveMessages(sessionId, messages, fileUuid)

      const provider = new FakeProvider(new FakeListChatModel({ responses: [] }))
      const consolidator = new Consolidator(
        { sessionManager: manager, provider, buildMessages, getToolDefinitions },
        {
          inputBudgetTokens: 20,
          consolidationRatio: 0.5,
          maxContextMessages: 4,
          maxMessagesBeforeTokenCheck: 120,
          maxConsolidationRounds: 5,
        },
      )

      const contextMessages = await consolidator.getMessagesForContext(sessionId, {
        maxMessages: 4,
      })

      // Message-count cap of 4 non-system messages + a possibly retained system message
      const nonSystem = contextMessages.filter((m) => m.getType() !== 'system')
      expect(nonSystem.length).toBeLessThanOrEqual(4)

      // The last message is the current user message
      expect(contextMessages[contextMessages.length - 1].getType()).toBe('human')
    }))

  it('getMessagesForContext keeps system messages and the current user message', async () =>
    inWs(async () => {
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
          inputBudgetTokens: 2,
          consolidationRatio: 0.5,
          maxContextMessages: 1,
          maxMessagesBeforeTokenCheck: 120,
          maxConsolidationRounds: 5,
        },
      )

      const contextMessages = await consolidator.getMessagesForContext(sessionId, {
        maxMessages: 1,
      })

      const types = contextMessages.map((m) => m.getType())
      expect(types).toContain('system')
      expect(types[types.length - 1]).toBe('human')
      expect(contextMessages[contextMessages.length - 1].content).toBe('current')
    }))

  it('serializes concurrent calls to the same session', async () =>
    inWs(async () => {
      const sessionId = 'concurrent'
      const messages = makeMessages(30)
      await manager.saveMessages(sessionId, messages, fileUuid)

      const provider = new FakeProvider(new FakeListChatModel({ responses: ['one', 'two'] }))
      const consolidator = new Consolidator(
        { sessionManager: manager, provider, buildMessages, getToolDefinitions },
        {
          inputBudgetTokens: 40,
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
    }))
})

describe('Consolidator turn-state stripping', () => {
  let tmpDir: string
  let manager: SessionManager
  let buildMessages: (messages: BaseMessage[], lastSummary?: string) => Promise<BaseMessage[]>
  const fileUuid = 'file-uuid-1'

  const STRIP_LIMITS = {
    inputBudgetTokens: 30,
    consolidationRatio: 0.5,
    maxContextMessages: 120,
    maxMessagesBeforeTokenCheck: 3,
    maxConsolidationRounds: 5,
  }

  const workspaceUuid = 'workspace-uuid-1'

  /** Production only enters the workspace context inside a run (Runner.run wraps runInWorkspace); tests enter it the same way. */
  const inWs = <T>(fn: () => T): T => manager.runInWorkspace(workspaceUuid, fn)

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'consolidator-strip-'))
    manager = new SessionManager()
    await manager.init(tmpDir)

    buildMessages = async (messages, lastSummary) => [
      new SystemMessage(lastSummary ? `Summary: ${lastSummary}` : 'system'),
      ...messages,
    ]
  })

  afterEach(() => {
    manager.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('strips a trailing EDITOR_STATE block before archived messages feed the rolling summary', async () =>
    inWs(async () => {
      const sessionId = 'strip'
      const turnStateSuffix =
        '\n<EDITOR_STATE file_uuid="file-uuid-1" file_path="/a.mindlane" file_title="t">\n<SELECTED_NODES count="1">\n  <node id="n1" type="text" label="old node"/>\n</SELECTED_NODES>\n</EDITOR_STATE>'
      const messages = [
        new HumanMessage(`first turn question${turnStateSuffix}`),
        new AIMessage('first turn reply'),
        ...makeMessages(18),
      ]
      await manager.saveMessages(sessionId, messages, fileUuid)

      const model = new FakeListChatModel({ responses: ['summary'] })
      const invokeSpy = vi.spyOn(model, 'invoke')
      const provider = new FakeProvider(model)
      const consolidator = new Consolidator(
        { sessionManager: manager, provider, buildMessages, getToolDefinitions: () => [] },
        STRIP_LIMITS,
      )

      const changed = await consolidator.maybe_consolidate_by_tokens(sessionId)
      expect(changed).toBe(true)

      const summaryInputs = invokeSpy.mock.calls[0]![0] as BaseMessage[]
      // The block is stripped: no input contains <EDITOR_STATE and the stripped question text is present.
      expect(summaryInputs.some((m) => String(m.content).includes('<EDITOR_STATE'))).toBe(false)
      expect(summaryInputs.some((m) => m.content === 'first turn question')).toBe(true)
    }))

  it('passes block-free messages into the summary input unchanged (no-op)', async () =>
    inWs(async () => {
      const sessionId = 'noop'
      const messages = [
        new HumanMessage('plain text question'),
        new AIMessage('plain text reply'),
        ...makeMessages(18),
      ]
      await manager.saveMessages(sessionId, messages, fileUuid)

      const model = new FakeListChatModel({ responses: ['summary'] })
      const invokeSpy = vi.spyOn(model, 'invoke')
      const provider = new FakeProvider(model)
      const consolidator = new Consolidator(
        { sessionManager: manager, provider, buildMessages, getToolDefinitions: () => [] },
        STRIP_LIMITS,
      )

      await consolidator.maybe_consolidate_by_tokens(sessionId)

      const summaryInputs = invokeSpy.mock.calls[0]![0] as BaseMessage[]
      expect(summaryInputs.some((m) => m.content === 'plain text question')).toBe(true)
      expect(summaryInputs.some((m) => m.content === 'plain text reply')).toBe(true)
    }))
})

describe('Consolidator extraction callback seam', () => {
  let tmpDir: string
  let manager: SessionManager
  let buildMessages: (messages: BaseMessage[], lastSummary?: string) => Promise<BaseMessage[]>
  const workspaceUuid = 'workspace-uuid-1'
  const fileUuid = 'file-uuid-1'

  const ARCHIVE_LIMITS = {
    inputBudgetTokens: 30,
    consolidationRatio: 0.5,
    maxContextMessages: 120,
    maxMessagesBeforeTokenCheck: 3,
    maxConsolidationRounds: 5,
  }

  const EXTRACTION_JSON = JSON.stringify({
    facts: ['the user prefers modular design', 'the user prefers shipping an MVP first'],
  })

  /** Production only enters the workspace context inside a run (Runner.run wraps runInWorkspace); tests enter it the same way. */
  const inWs = <T>(fn: () => T): T => manager.runInWorkspace(workspaceUuid, fn)

  /** Summary calls carry the rolling-summary prompt; every other call (extraction) returns JSON. */
  function makeExtractionAwareModel(): BaseChatModel {
    const model = new FakeListChatModel({ responses: ['summary'] })
    model.invoke = (async (input: unknown) => {
      const text = JSON.stringify(input)
      return new AIMessage(
        text.includes('Maintain a rolling summary') ? 'summary' : EXTRACTION_JSON,
      )
    }) as unknown as BaseChatModel['invoke']
    return model
  }

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'consolidator-seam-'))
    manager = new SessionManager()
    await manager.init(tmpDir)

    buildMessages = async (messages, lastSummary) => [
      new SystemMessage(lastSummary ? `Summary: ${lastSummary}` : 'system'),
      ...messages,
    ]
  })

  afterEach(() => {
    manager.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('onArchived receives every archived slice after archiving', async () =>
    inWs(async () => {
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
      // The callback slice matches the advanced cursor: the same messages are never extracted twice
      const meta = manager.getSessionMeta(sessionId)
      expect(slice.length).toBe(meta?.lastConsolidated)
    }))

  it('does not fire onArchived when no archiving happened', async () =>
    inWs(async () => {
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
        { ...ARCHIVE_LIMITS, inputBudgetTokens: 100, maxMessagesBeforeTokenCheck: 5 },
      )

      const changed = await consolidator.maybe_consolidate_by_tokens(sessionId)
      expect(changed).toBe(false)
      expect(onArchived).not.toHaveBeenCalled()
    }))

  it('deletes the editlog and writes memory after a successful extraction', async () =>
    inWs(async () => {
      const sessionId = 'extract-success'
      await manager.saveMessages(sessionId, makeMessages(20), fileUuid)

      const editLogStore = new EditLogStore(tmpDir)
      await editLogStore.append(workspaceUuid, fileUuid, {
        ts: 1,
        nodeId: 'n1',
        before: 'written by the AI',
        after: 'edited by the user',
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

      // The extraction callback is fire-and-forget: wait for it to land, then assert on its output
      await vi.waitFor(async () => {
        expect(await editLogStore.read(workspaceUuid, fileUuid)).toEqual([])
      })
      const memoryContent = fs.readFileSync(
        path.join(tmpDir, 'mindlanememory', 'MEMORY.md'),
        'utf-8',
      )
      expect(memoryContent).toContain('the user prefers modular design')
    }))

  it('compression is unaffected and the editlog is kept when the extraction callback throws', async () =>
    inWs(async () => {
      const sessionId = 'extract-failure'
      await manager.saveMessages(sessionId, makeMessages(20), fileUuid)

      const editLogStore = new EditLogStore(tmpDir)
      await editLogStore.append(workspaceUuid, fileUuid, {
        ts: 1,
        nodeId: 'n1',
        before: 'written by the AI',
        after: 'edited by the user',
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

      // Artifacts of the main compression path are intact
      const meta = manager.getSessionMeta(sessionId)
      expect(meta?._lastSummary).toBe('summary')
      // Extraction failed: the editlog evidence is kept
      expect((await editLogStore.read(workspaceUuid, fileUuid)).length).toBe(1)
    }))
})
