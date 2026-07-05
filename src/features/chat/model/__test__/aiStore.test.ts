import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadWorkspaceChat, saveChatHistory, useAiStore, type ChatSession } from '../aiStore'
import type { ChatMessage } from '@/shared/lib/fileFormat'

type ChatApiMock = {
  listSessions: ReturnType<typeof vi.fn>
  loadSession: ReturnType<typeof vi.fn>
  saveSession: ReturnType<typeof vi.fn>
  deleteSession: ReturnType<typeof vi.fn>
}

const sessions: ChatSession[] = [
  {
    id: 'session-latest',
    title: 'Latest',
    createdAt: '2026-06-18T00:00:00.000Z',
    updatedAt: '2026-06-18T00:01:00.000Z',
    messageCount: 1,
  },
]

function installChatApi(overrides: Partial<ChatApiMock> = {}): ChatApiMock {
  const api: ChatApiMock = {
    listSessions: vi.fn(async () => ({ ok: true, data: { sessions } })),
    loadSession: vi.fn(async () => ({
      ok: true,
      data: {
        sessionId: 'session-latest',
        messages: [{ role: 'user', content: 'hello' } satisfies ChatMessage],
      },
    })),
    saveSession: vi.fn(async () => ({ ok: true })),
    deleteSession: vi.fn(async () => ({ ok: true })),
    ...overrides,
  }

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: globalThis,
  })
  Object.defineProperty(globalThis.window, 'mindlane', {
    configurable: true,
    value: { chat: api },
  })

  return api
}

describe('aiStore session chat API', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    useAiStore.setState({
      busy: false,
      step: 'idle',
      streamText: '',
      errorMessage: null,
      threadId: '',
      chatMessages: [],
      workspacePath: null,
      sessions: [],
      showSessionList: false,
      isMinimized: false,
      attachedDocument: null,
    })
  })

  it('saves chat history through the session API', async () => {
    const api = installChatApi()
    useAiStore.setState({
      workspacePath: '/workspace',
      threadId: 'thread-1',
      chatMessages: [{ role: 'user', content: 'hello' }],
    })

    await saveChatHistory()

    expect(api.saveSession).toHaveBeenCalledWith({
      workspacePath: '/workspace',
      sessionId: 'thread-1',
      messages: [{ role: 'user', content: 'hello' }],
    })
    expect(api.listSessions).toHaveBeenCalledWith({
      workspacePath: '/workspace',
      limit: 20,
      offset: 0,
    })
    expect(useAiStore.getState().sessions).toEqual(sessions)
  })

  it('loads the latest workspace chat through listSessions and loadSession', async () => {
    const api = installChatApi()

    await loadWorkspaceChat('/workspace')

    expect(api.listSessions).toHaveBeenCalledWith({
      workspacePath: '/workspace',
      limit: 20,
      offset: 0,
    })
    expect(api.loadSession).toHaveBeenCalledWith({
      workspacePath: '/workspace',
      sessionId: 'session-latest',
    })
    expect(useAiStore.getState()).toMatchObject({
      workspacePath: '/workspace',
      threadId: 'session-latest',
      chatMessages: [{ role: 'user', content: 'hello' }],
      sessions,
    })
  })
})
