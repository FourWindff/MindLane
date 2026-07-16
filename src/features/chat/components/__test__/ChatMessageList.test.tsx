import { beforeEach, describe, expect, it, vi } from 'vitest'
import ReactDOMServer from 'react-dom/server'
import { ChatMessageList } from '../ChatMessageList'

const mockAiState = vi.hoisted(() => ({
  current: {
    threadId: '',
    chatMessages: [] as Array<{
      role: 'user' | 'assistant'
      content: string
      attachment?: { name: string; type: string }
      toolCalls?: { name: string }[]
      timestamp?: number
    }>,
    sessions: [] as Array<{
      id: string
      fileUuid: string
      title: string
      createdAt: string
      updatedAt: string
      messageCount: number
    }>,
    busy: false,
    showSessionList: false,
    streamText: '',
    activeTools: [] as string[],
    loadSession: vi.fn(),
    deleteSession: vi.fn(),
    setShowSessionList: vi.fn(),
  },
}))

vi.mock('@/features/chat/model/aiStore', () => ({
  useAiStore: (selector?: (state: typeof mockAiState.current) => unknown) =>
    selector ? selector(mockAiState.current) : mockAiState.current,
  createFileChatState: () => ({
    activeSessionId: '',
    chatMessages: [],
    sessions: [],
    busy: false,
    step: 'idle',
    streamText: '',
    errorMessage: null,
    activeTools: [],
  }),
}))

vi.mock('@/features/chat/hooks/useChatContext', () => ({
  useChatContext: () => ({
    emptyHint: 'AI 助手可以生成思维导图',
    quickActions: [
      { label: '生成思维导图', prompt: '请帮我生成一个思维导图' },
      { label: '总结内容', prompt: '请总结当前思维导图的内容' },
      { label: '头脑风暴', prompt: '请帮我进行头脑风暴，生成一些创意想法' },
      { label: '优化结构', prompt: '请帮我优化当前思维导图的结构' },
    ],
  }),
}))

vi.mock('@/features/chat/hooks/useChatStream', () => ({
  useChatStream: () => ({ streamingText: '', activeTools: [] }),
}))

function renderMessageList(patch: Partial<typeof mockAiState.current>) {
  mockAiState.current = { ...mockAiState.current, ...patch }
  return ReactDOMServer.renderToString(<ChatMessageList />)
}

describe('ChatMessageList', () => {
  beforeEach(() => {
    mockAiState.current = {
      threadId: '',
      chatMessages: [],
      sessions: [],
      busy: false,
      showSessionList: false,
      streamText: '',
      activeTools: [],
      loadSession: vi.fn(),
      deleteSession: vi.fn(),
      setShowSessionList: vi.fn(),
    }
  })

  it('renders messages in message mode', () => {
    const html = renderMessageList({
      threadId: 'session-a',
      chatMessages: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'world' },
      ],
    })

    expect(html).toContain('hello')
    expect(html).toContain('world')
    expect(html).toContain('chat-message-list__bubble--user')
    expect(html).toContain('chat-message-list__bubble--ai')
  })

  it('renders the session list when showSessionList is true', () => {
    const html = renderMessageList({
      showSessionList: true,
      sessions: [
        {
          id: 'session-a',
          fileUuid: 'file-a',
          title: 'Earlier chat',
          createdAt: '2026-07-15T00:00:00.000Z',
          updatedAt: '2026-07-15T12:00:00.000Z',
          messageCount: 3,
        },
      ],
    })

    expect(html).toContain('Earlier chat')
    expect(html).toContain('chat-message-list--session-mode')
  })
})
