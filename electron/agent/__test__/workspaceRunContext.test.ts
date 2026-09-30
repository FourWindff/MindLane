/**
 * Wiring tests for the run-level workspace identity.
 *
 * `Runner.run()` is the only place the workspace (path + uuid) enters the run
 * context, and both consumers read it from there: the readFile tool (path) and
 * memory extraction (uuid). These tests pin those two seams directly — the
 * harness plays the Runner's part by calling `runWithRunContext` itself.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { HumanMessage } from '@langchain/core/messages'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { FakeListChatModel } from '@langchain/core/utils/testing'
import { AgentOrchestrator } from '../orchestrator.js'
import { runContextCompact } from '../context/runContextCompact.js'
import { SessionManager } from '../context/sessionManager.js'
import { createExtractionCallback } from '../memory/memoryExtractor.js'
import {
  requireWorkspaceUuid,
  runWithRunContext,
  type RunWorkspace,
} from '../../shared/runContext.js'
import { LLMProvider, ProviderCapability } from '../providers/base.js'
import type { AgentServices } from '../service.js'
import type { MainGraphStateType } from '../state.js'
import type { ToolRegistry } from '../tools/registry.js'

// Keep the real module, mock only the factory so the test can read its args.
vi.mock('../memory/memoryExtractor.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../memory/memoryExtractor.js')>()
  return { ...actual, createExtractionCallback: vi.fn(actual.createExtractionCallback) }
})

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

const workspaceUuid = 'ws-uuid'
const fileUuid = 'file-uuid-1'

describe('workspace identity in the run context', () => {
  let tmpDir: string
  let workspace: RunWorkspace

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-run-context-'))
    workspace = { path: tmpDir, uuid: workspaceUuid }
    vi.clearAllMocks()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('readFile reads through the workspace path of the run context', async () => {
    fs.writeFileSync(path.join(tmpDir, 'doc.md'), 'hello from the workspace')

    const orchestrator = new AgentOrchestrator(
      new FakeProvider(new FakeListChatModel({ responses: [] })),
      { checkpointer: { getAdapter: () => undefined } } as unknown as AgentServices,
    )
    const readFile = orchestrator
      .getStreamRuntime()
      .toolRegistry.allTools.find((entry) => entry.name === 'readFile')
    expect(readFile).toBeDefined()

    // The harness plays the Runner's part here: outside this context the getter
    // sees no workspace and the tool refuses, so the read below is the proof.
    const result = await runWithRunContext({ streamId: 'stream-wiring', workspace }, () =>
      readFile!.invoke({ path: 'doc.md' }),
    )
    expect(result).toMatchObject({ ok: true, content: '1→hello from the workspace' })
  })

  it('runContextCompact passes the run workspace uuid to memory extraction', async () => {
    const sessionManager = new SessionManager()
    await sessionManager.init(tmpDir)
    const services = {
      sessionManager,
      memoryManager: undefined,
      memoryExtractor: {},
      editLogStore: {},
    } as unknown as AgentServices
    const state = {
      messages: [new HumanMessage('hi')],
      context: { fileUuid, workspacePath: tmpDir },
    } as unknown as MainGraphStateType

    await sessionManager.runInWorkspace(workspaceUuid, () =>
      runWithRunContext({ streamId: 'stream-wiring', workspace }, () =>
        runContextCompact(
          {
            provider: new FakeProvider(new FakeListChatModel({ responses: [] })),
            services,
            toolRegistry: { allTools: [] } as unknown as ToolRegistry,
          },
          state,
          { configurable: { thread_id: 'session-wiring' } },
        ),
      ),
    )

    expect(createExtractionCallback).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceUuid, fileUuid }),
    )
  })

  it('requireWorkspaceUuid fails loudly without a workspace in the run context', () => {
    expect(() => requireWorkspaceUuid('记忆提取')).toThrow(/记忆提取缺少工作区上下文/)
    expect(() =>
      runWithRunContext({ streamId: 'stream-wiring' }, () => requireWorkspaceUuid('记忆提取')),
    ).toThrow(/缺少工作区上下文/)
  })
})
