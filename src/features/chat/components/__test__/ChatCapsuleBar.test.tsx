import { beforeEach, describe, expect, it, vi } from 'vitest'
import ReactDOMServer from 'react-dom/server'
import { ChatCapsuleBar } from '../ChatCapsuleBar'

interface MockFileChat {
  lastUserMessageAt: number
  busy: boolean
  stopRequested: boolean
}

const mockAiState = vi.hoisted(() => ({
  current: {
    currentFileUuid: null as string | null,
    currentFilePath: null as string | null,
    fileChats: {} as Record<string, MockFileChat>,
    filePaths: {} as Record<string, string>,
    showSessionList: false,
    setShowSessionList: () => {},
  },
}))

vi.mock('@/features/chat/model/aiStore', () => ({
  useAiStore: (selector?: (state: typeof mockAiState.current) => unknown) =>
    selector ? selector(mockAiState.current) : mockAiState.current,
  deriveChatCapsuleEntries: (
    fileChats: typeof mockAiState.current.fileChats,
    filePaths: typeof mockAiState.current.filePaths,
    currentFileUuid: typeof mockAiState.current.currentFileUuid,
    currentFilePath: typeof mockAiState.current.currentFilePath,
  ) => {
    const entries: {
      fileUuid: string
      fileName: string
      status: 'generating' | 'stopping' | 'idle'
      lastUserMessageAt: number
    }[] = []
    const keys = new Set([...Object.keys(fileChats)])
    if (currentFileUuid) keys.add(currentFileUuid)
    for (const fileUuid of keys) {
      const chat = fileChats[fileUuid]
      const isCurrent = fileUuid === currentFileUuid
      if (!chat) {
        if (!isCurrent) continue
        entries.push({
          fileUuid,
          fileName: currentFilePath?.split(/[\\/]/).pop() ?? fileUuid,
          status: 'idle',
          lastUserMessageAt: 0,
        })
        continue
      }
      if (!(chat.lastUserMessageAt > 0 || chat.busy || isCurrent)) continue
      entries.push({
        fileUuid,
        fileName:
          (filePaths[fileUuid] ?? (isCurrent ? currentFilePath : null))?.split(/[\\/]/).pop() ??
          fileUuid,
        status: chat.stopRequested ? 'stopping' : chat.busy ? 'generating' : 'idle',
        lastUserMessageAt: chat.lastUserMessageAt,
      })
    }
    return entries.sort((a, b) => {
      if (a.fileUuid === currentFileUuid) return -1
      if (b.fileUuid === currentFileUuid) return 1
      return b.lastUserMessageAt - a.lastUserMessageAt
    })
  },
}))

vi.mock('@/features/workspace/store', () => ({
  useWorkspaceStore: () => ({ openWorkspaceFile: vi.fn() }),
}))

function renderCapsuleBar(
  entries: {
    fileUuid: string
    fileName: string
    status: 'generating' | 'stopping' | 'idle'
    lastUserMessageAt: number
  }[],
  currentFileUuid: string | null,
) {
  mockAiState.current = {
    ...mockAiState.current,
    currentFileUuid,
    currentFilePath: currentFileUuid ? `/${currentFileUuid}.mindlane` : null,
    fileChats: Object.fromEntries(
      entries.map((entry) => [
        entry.fileUuid,
        {
          lastUserMessageAt: entry.lastUserMessageAt,
          busy: entry.status === 'generating',
          stopRequested: entry.status === 'stopping',
        },
      ]),
    ),
    filePaths: Object.fromEntries(entries.map((entry) => [entry.fileUuid, entry.fileName])),
  }
  return ReactDOMServer.renderToString(
    <ChatCapsuleBar expanded={false} onToggleExpand={() => {}} />,
  )
}

describe('ChatCapsuleBar', () => {
  beforeEach(() => {
    mockAiState.current = {
      currentFileUuid: null,
      currentFilePath: null,
      fileChats: {},
      filePaths: {},
      showSessionList: false,
      setShowSessionList: () => {},
    }
  })

  it('renders status classes for generating, stopping and idle capsules', () => {
    const html = renderCapsuleBar(
      [
        { fileUuid: 'file-a', fileName: 'A', status: 'generating', lastUserMessageAt: 100 },
        { fileUuid: 'file-b', fileName: 'B', status: 'stopping', lastUserMessageAt: 200 },
        { fileUuid: 'file-c', fileName: 'C', status: 'idle', lastUserMessageAt: 300 },
      ],
      null,
    )

    expect(html).toContain('chat-capsule--generating')
    expect(html).toContain('chat-capsule--stopping')
    expect(html).toContain('chat-capsule--idle')
  })

  it('places the current file first and marks it larger', () => {
    const html = renderCapsuleBar(
      [
        { fileUuid: 'file-a', fileName: 'Alpha', status: 'idle', lastUserMessageAt: 100 },
        { fileUuid: 'file-b', fileName: 'Beta', status: 'idle', lastUserMessageAt: 200 },
      ],
      'file-b',
    )

    const currentIndex = html.indexOf('chat-capsule--current')
    const otherIndex = html.indexOf('Alpha')
    expect(currentIndex).toBeGreaterThan(-1)
    expect(otherIndex).toBeGreaterThan(-1)
    expect(currentIndex).toBeLessThan(otherIndex)
  })

  it('sorts non-current capsules by lastUserMessageAt descending', () => {
    const html = renderCapsuleBar(
      [
        { fileUuid: 'file-a', fileName: 'Alpha', status: 'idle', lastUserMessageAt: 100 },
        { fileUuid: 'file-b', fileName: 'Beta', status: 'idle', lastUserMessageAt: 300 },
        { fileUuid: 'file-c', fileName: 'Gamma', status: 'idle', lastUserMessageAt: 200 },
      ],
      'file-current',
    )

    const betaIndex = html.indexOf('Beta')
    const gammaIndex = html.indexOf('Gamma')
    const alphaIndex = html.indexOf('Alpha')
    expect(betaIndex).toBeLessThan(gammaIndex)
    expect(gammaIndex).toBeLessThan(alphaIndex)
  })
})
