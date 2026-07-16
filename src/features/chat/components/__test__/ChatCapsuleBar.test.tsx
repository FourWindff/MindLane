import { beforeEach, describe, expect, it, vi } from 'vitest'
import ReactDOMServer from 'react-dom/server'
import { ChatCapsuleBar } from '../ChatCapsuleBar'

const mockAiState = vi.hoisted(() => ({
  current: {
    currentFileUuid: null as string | null,
    currentFilePath: null as string | null,
    activeSessionsBar: {} as Record<
      string,
      {
        fileUuid: string
        fileName: string
        status: 'generating' | 'stopping' | 'idle'
        lastInputAt: number
      }
    >,
    showSessionList: false,
    setShowSessionList: () => {},
  },
}))

vi.mock('@/features/chat/model/aiStore', () => ({
  useAiStore: (selector?: (state: typeof mockAiState.current) => unknown) =>
    selector ? selector(mockAiState.current) : mockAiState.current,
  getActiveSessionBarEntries: (
    activeSessionsBar: typeof mockAiState.current.activeSessionsBar,
    currentFileUuid: typeof mockAiState.current.currentFileUuid,
    currentFilePath: typeof mockAiState.current.currentFilePath,
  ) => {
    const entries = Object.values(activeSessionsBar)
    if (currentFileUuid && !activeSessionsBar[currentFileUuid]) {
      entries.push({
        fileUuid: currentFileUuid,
        fileName: currentFilePath?.split(/[\\/]/).pop() ?? currentFileUuid,
        status: 'idle',
        lastInputAt: 0,
      })
    }
    return entries.sort((a, b) => {
      if (a.fileUuid === currentFileUuid) return -1
      if (b.fileUuid === currentFileUuid) return 1
      return b.lastInputAt - a.lastInputAt
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
    lastInputAt: number
  }[],
  currentFileUuid: string | null,
) {
  mockAiState.current = {
    ...mockAiState.current,
    currentFileUuid,
    currentFilePath: currentFileUuid ? `/${currentFileUuid}.mindlane` : null,
    activeSessionsBar: Object.fromEntries(entries.map((e) => [e.fileUuid, e])),
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
      activeSessionsBar: {},
      showSessionList: false,
      setShowSessionList: () => {},
    }
  })

  it('renders status classes for generating, stopping and idle capsules', () => {
    const html = renderCapsuleBar(
      [
        { fileUuid: 'file-a', fileName: 'A', status: 'generating', lastInputAt: 100 },
        { fileUuid: 'file-b', fileName: 'B', status: 'stopping', lastInputAt: 200 },
        { fileUuid: 'file-c', fileName: 'C', status: 'idle', lastInputAt: 300 },
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
        { fileUuid: 'file-a', fileName: 'Alpha', status: 'idle', lastInputAt: 100 },
        { fileUuid: 'file-b', fileName: 'Beta', status: 'idle', lastInputAt: 200 },
      ],
      'file-b',
    )

    const currentIndex = html.indexOf('chat-capsule--current')
    const otherIndex = html.indexOf('Alpha')
    expect(currentIndex).toBeGreaterThan(-1)
    expect(otherIndex).toBeGreaterThan(-1)
    expect(currentIndex).toBeLessThan(otherIndex)
  })

  it('sorts non-current capsules by lastInputAt descending', () => {
    const html = renderCapsuleBar(
      [
        { fileUuid: 'file-a', fileName: 'Alpha', status: 'idle', lastInputAt: 100 },
        { fileUuid: 'file-b', fileName: 'Beta', status: 'idle', lastInputAt: 300 },
        { fileUuid: 'file-c', fileName: 'Gamma', status: 'idle', lastInputAt: 200 },
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
