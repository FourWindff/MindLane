import { beforeEach, describe, expect, it, vi } from 'vitest'
import ReactDOMServer from 'react-dom/server'
import { ChatMessageList } from '../ChatMessageList'
import { sendQuickActionPrompt } from '@/features/chat/lib/chatUtils'

type MockChatMessage = {
  role: 'user' | 'assistant'
  content: string
  attachment?: { name: string; type: string }
  toolCalls?: { name: string }[]
  timestamp?: number
}

type MockChatSession = {
  id: string
  fileUuid: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
}

type MockFileChat = {
  activeSessionId: string
  chatMessages: MockChatMessage[]
  sessions: MockChatSession[]
  busy: boolean
  streamText: string
  activeTools: string[]
}

type MockState = {
  currentFileUuid: string | null
  fileChats: Record<string, MockFileChat>
  showSessionList: boolean
  loadSession: ReturnType<typeof vi.fn>
  deleteSession: ReturnType<typeof vi.fn>
  setShowSessionList: ReturnType<typeof vi.fn>
}

const mockAiState = vi.hoisted(() => ({
  current: {
    currentFileUuid: 'file-a',
    fileChats: {
      'file-a': {
        activeSessionId: '',
        chatMessages: [],
        sessions: [],
        busy: false,
        streamText: '',
        activeTools: [],
      },
    },
    showSessionList: false,
    loadSession: vi.fn(),
    deleteSession: vi.fn(),
    setShowSessionList: vi.fn(),
  } as MockState,
}))

vi.mock('@/features/chat/model/aiStore', async () => {
  const actual = await vi.importActual<typeof import('@/features/chat/model/aiStore')>(
    '@/features/chat/model/aiStore',
  )
  return {
    ...actual,
    useAiStore: (selector?: (state: unknown) => unknown) =>
      selector ? selector(mockAiState.current) : mockAiState.current,
  }
})

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

function fileChat(patch: Partial<MockFileChat>): MockFileChat {
  return {
    activeSessionId: '',
    chatMessages: [],
    sessions: [],
    busy: false,
    streamText: '',
    activeTools: [],
    ...patch,
  }
}

function renderMessageList(patch: Partial<MockState>) {
  mockAiState.current = { ...mockAiState.current, ...patch }
  return ReactDOMServer.renderToString(<ChatMessageList />)
}

describe('ChatMessageList', () => {
  beforeEach(() => {
    mockAiState.current = {
      currentFileUuid: 'file-a',
      fileChats: { 'file-a': fileChat({}) },
      showSessionList: false,
      loadSession: vi.fn(),
      deleteSession: vi.fn(),
      setShowSessionList: vi.fn(),
    }
  })

  it('renders messages in message mode', () => {
    const html = renderMessageList({
      fileChats: {
        'file-a': fileChat({
          activeSessionId: 'session-a',
          chatMessages: [
            { role: 'user', content: 'hello' },
            { role: 'assistant', content: 'world' },
          ],
        }),
      },
    })

    expect(html).toContain('hello')
    expect(html).toContain('world')
    expect(html).toContain('chat-message-list__bubble--user')
    expect(html).toContain('chat-message-list__bubble--ai')
  })

  it('renders the session list when showSessionList is true', () => {
    const html = renderMessageList({
      showSessionList: true,
      fileChats: {
        'file-a': fileChat({
          activeSessionId: 'session-a',
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
        }),
      },
    })

    expect(html).toContain('Earlier chat')
    expect(html).toContain('chat-message-list--session-mode')
  })

  it('dispatches a quick action prompt to sendChatMessage', () => {
    const sendChatMessage = vi.fn().mockResolvedValue(true)
    const prompt = '请帮我进行头脑风暴，生成一些创意想法'

    sendQuickActionPrompt(sendChatMessage, prompt)

    expect(sendChatMessage).toHaveBeenCalledOnce()
    expect(sendChatMessage).toHaveBeenCalledWith(prompt)
  })
})
