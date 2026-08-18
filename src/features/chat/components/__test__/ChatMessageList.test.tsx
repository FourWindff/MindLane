import { beforeEach, describe, expect, it, vi } from 'vitest'
import ReactDOMServer from 'react-dom/server'
import { ChatMessageList } from '../ChatMessageList'

type MockChatMessage = {
  role: 'user' | 'assistant'
  content: string
  attachment?: { name: string; type: string }
  toolCalls?: { name: string; status?: string; steps?: unknown }[]
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

type MockToolCard = { id: string; name: string; status: string }

type MockFileChat = {
  activeSessionId: string
  chatMessages: MockChatMessage[]
  sessions: MockChatSession[]
  busy: boolean
  streamText: string
  toolCards: MockToolCard[]
}

type MockState = {
  currentFileUuid: string | null
  fileChats: Record<string, MockFileChat>
  showSessionList: boolean
  loadSession: ReturnType<typeof vi.fn>
  deleteSession: ReturnType<typeof vi.fn>
  setShowSessionList: ReturnType<typeof vi.fn>
  setInputDraft: ReturnType<typeof vi.fn>
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
        toolCards: [],
      },
    },
    showSessionList: false,
    loadSession: vi.fn(),
    deleteSession: vi.fn(),
    setShowSessionList: vi.fn(),
    setInputDraft: vi.fn(),
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
    toolCards: [],
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
      setInputDraft: vi.fn(),
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

  it('renders the empty-state quick actions with their prompts', () => {
    const html = renderMessageList({})

    expect(html).toContain('生成思维导图')
    expect(html).toContain('总结内容')
    expect(html).toContain('头脑风暴')
    expect(html).toContain('优化结构')
  })

  it('renders history tool cards above the AI bubble, one card per tool call', () => {
    const html = renderMessageList({
      fileChats: {
        'file-a': fileChat({
          chatMessages: [
            {
              role: 'assistant',
              content: '已插入',
              toolCalls: [
                { name: 'insertXmlFragment', status: 'success' },
                { name: 'readMindmap', status: 'error' },
              ],
            },
          ],
        }),
      },
    })

    const cards = html.match(/chat-message-list__tool-card__name/g)
    expect(cards).toHaveLength(2)
    // 卡片区在气泡（正文）之前渲染，且每个卡片单独成行（tool-cards 为纵向布局）
    expect(html.indexOf('chat-message-list__tool-cards')).toBeLessThan(html.indexOf('已插入'))
    expect(html).toContain('chat-message-list__tool-card--success')
    expect(html).toContain('chat-message-list__tool-card--error')
    expect(html).toContain('Insert XML Fragment')
    expect(html).toContain('Read Mindmap')
  })

  it('shows a spinner for running cards and a cancel mark for canceled cards', () => {
    const html = renderMessageList({
      fileChats: {
        'file-a': fileChat({
          chatMessages: [
            {
              role: 'assistant',
              content: '生成中',
              toolCalls: [
                { name: 'generateMindmapFragment', status: 'running' },
                { name: 'generatePalace', status: 'canceled' },
              ],
            },
          ],
        }),
      },
    })

    expect(html).toContain('chat-message-list__tool-card--running')
    expect(html).toContain('chat-message-list__spinner')
    expect(html).toContain('chat-message-list__tool-card--canceled')
    expect(html).toContain('Canceled')
    expect(html).toContain('Generate Mindmap Fragment')
    expect(html).toContain('Generate Memory Palace')
  })

  it('renders old-session toolCalls without status as finished success cards (no spinner)', () => {
    const html = renderMessageList({
      fileChats: {
        'file-a': fileChat({
          chatMessages: [
            {
              role: 'assistant',
              content: '旧会话',
              toolCalls: [{ name: 'updateMindmapNode' }],
            },
          ],
        }),
      },
    })

    expect(html).toContain('chat-message-list__tool-card--success')
    expect(html).not.toContain('chat-message-list__spinner')
    expect(html).toContain('Update Node')
  })

  it('renders streaming tool cards with the same card component and rules', () => {
    const html = renderMessageList({
      fileChats: {
        'file-a': fileChat({
          busy: true,
          streamText: '正在生成',
          toolCards: [
            { id: 'call-1', name: 'moveMindmapNode', status: 'running' },
            { id: 'call-2', name: 'deleteMindmapNode', status: 'success' },
          ],
        }),
      },
    })

    expect(html).toContain('chat-message-list__tool-card--running')
    expect(html).toContain('chat-message-list__tool-card--success')
    expect(html).toContain('chat-message-list__spinner')
    expect(html).toContain('Move Node')
    expect(html).toContain('Delete Node')
    // 流式卡片同样在正文之前
    expect(html.indexOf('chat-message-list__tool-cards')).toBeLessThan(html.indexOf('正在生成'))
  })

  it('renders canceled cards for a stopped stream without spinners', () => {
    const html = renderMessageList({
      fileChats: {
        'file-a': fileChat({
          busy: true,
          streamText: '',
          toolCards: [{ id: 'call-1', name: 'generateMindmapFragment', status: 'canceled' }],
        }),
      },
    })

    expect(html).toContain('chat-message-list__tool-card--canceled')
    expect(html).toContain('Canceled')
    expect(html).not.toContain('chat-message-list__spinner')
  })

  it('keeps each round tool cards attached to their own AI message across tool loops', () => {
    const html = renderMessageList({
      fileChats: {
        'file-a': fileChat({
          chatMessages: [
            {
              role: 'assistant',
              content: '第一轮',
              toolCalls: [{ name: 'readMindmap', status: 'success' }],
            },
            {
              role: 'assistant',
              content: '第二轮',
              toolCalls: [{ name: 'insertXmlFragment', status: 'error' }],
            },
          ],
        }),
      },
    })

    // 消息倒序渲染：第二轮在前。各轮卡片紧跟各自的正文气泡（卡片先于正文）
    const firstCards = html.match(/Read Mindmap/g)
    const secondCards = html.match(/Insert XML Fragment/g)
    expect(firstCards).toHaveLength(1)
    expect(secondCards).toHaveLength(1)
    expect(html.indexOf('Insert XML Fragment')).toBeLessThan(html.indexOf('第二轮'))
    expect(html.indexOf('Read Mindmap')).toBeGreaterThan(html.indexOf('第二轮'))
    expect(html.indexOf('Read Mindmap')).toBeLessThan(html.indexOf('第一轮'))
  })
})
