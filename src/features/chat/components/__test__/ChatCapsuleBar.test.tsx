import { beforeEach, describe, expect, it, vi } from 'vitest'
import ReactDOMServer from 'react-dom/server'
import { ChatCapsuleBar } from '../ChatCapsuleBar'
import { resolveCapsuleOpenPath } from '@/features/chat/lib/capsuleOpenPath'
import { mindmapRegistry } from '@/features/mindmap/model/mindmapRegistry'

interface MockFileChat {
  lastActivityAt: number
  busy: boolean
  stopRequested: boolean
}

const mockAiState = vi.hoisted(() => ({
  current: {
    currentFileUuid: null as string | null,
    currentFilePath: null as string | null,
    fileChats: {} as Record<string, MockFileChat>,
    filePaths: {} as Record<string, string>,
    fileUuidPaths: {} as Record<string, string>,
    allSessions: [] as { fileUuid: string; updatedAt: string }[],
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
    fileUuidPaths: typeof mockAiState.current.fileUuidPaths,
    allSessions: typeof mockAiState.current.allSessions,
    currentFileUuid: typeof mockAiState.current.currentFileUuid,
    currentFilePath: typeof mockAiState.current.currentFilePath,
  ) => {
    const entries: {
      fileUuid: string
      fileName: string
      status: 'generating' | 'stopping' | 'idle'
      lastActivityAt: number
    }[] = []
    const sessionAt = (fileUuid: string): number => {
      const ats = allSessions
        .filter((session) => session.fileUuid === fileUuid)
        .map((session) => Date.parse(session.updatedAt) || 0)
      return ats.length ? Math.max(...ats) : 0
    }
    const keys = new Set([...Object.keys(fileChats), ...allSessions.map((s) => s.fileUuid)])
    if (currentFileUuid) keys.add(currentFileUuid)
    for (const fileUuid of keys) {
      const chat = fileChats[fileUuid]
      const isCurrent = fileUuid === currentFileUuid
      const isStreaming = Boolean(chat?.busy || chat?.stopRequested)
      if (
        !isCurrent &&
        !isStreaming &&
        !(allSessions.some((s) => s.fileUuid === fileUuid) && fileUuidPaths[fileUuid])
      ) {
        continue
      }
      entries.push({
        fileUuid,
        fileName:
          (fileUuidPaths[fileUuid] ?? filePaths[fileUuid] ?? (isCurrent ? currentFilePath : null))
            ?.split(/[\\/]/)
            .pop() ?? fileUuid,
        status: chat?.stopRequested ? 'stopping' : chat?.busy ? 'generating' : 'idle',
        lastActivityAt: sessionAt(fileUuid),
      })
    }
    return entries.sort((a, b) => {
      if (a.fileUuid === currentFileUuid) return -1
      if (b.fileUuid === currentFileUuid) return 1
      return b.lastActivityAt - a.lastActivityAt
    })
  },
}))

vi.mock('@/features/workspace/store', () => ({
  useWorkspaceStore: () => ({ openWorkspaceFile: vi.fn() }),
}))

vi.mock('@/features/mindmap/model/mindmapRegistry', () => ({
  mindmapRegistry: {
    getByFileUuid: vi.fn(() => undefined),
  },
}))

function renderCapsuleBar(
  entries: {
    fileUuid: string
    fileName: string
    status: 'generating' | 'stopping' | 'idle'
    lastActivityAt: number
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
          lastActivityAt: entry.lastActivityAt,
          busy: entry.status === 'generating',
          stopRequested: entry.status === 'stopping',
        },
      ]),
    ),
    filePaths: Object.fromEntries(entries.map((entry) => [entry.fileUuid, entry.fileName])),
    fileUuidPaths: Object.fromEntries(
      entries.map((entry) => [entry.fileUuid, `/${entry.fileName}`]),
    ),
    allSessions: entries.map((entry) => ({
      fileUuid: entry.fileUuid,
      updatedAt: new Date(entry.lastActivityAt).toISOString(),
    })),
  }
  return ReactDOMServer.renderToString(
    <ChatCapsuleBar expanded={false} onToggleExpand={() => {}} />,
  )
}

describe('ChatCapsuleBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAiState.current = {
      currentFileUuid: null,
      currentFilePath: null,
      fileChats: {},
      filePaths: {},
      fileUuidPaths: {},
      allSessions: [],
      showSessionList: false,
      setShowSessionList: () => {},
    }
  })

  it('renders status classes for generating, stopping and idle capsules', () => {
    const html = renderCapsuleBar(
      [
        { fileUuid: 'file-a', fileName: 'A', status: 'generating', lastActivityAt: 100 },
        { fileUuid: 'file-b', fileName: 'B', status: 'stopping', lastActivityAt: 200 },
        { fileUuid: 'file-c', fileName: 'C', status: 'idle', lastActivityAt: 300 },
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
        { fileUuid: 'file-a', fileName: 'Alpha', status: 'idle', lastActivityAt: 100 },
        { fileUuid: 'file-b', fileName: 'Beta', status: 'idle', lastActivityAt: 200 },
      ],
      'file-b',
    )

    const currentIndex = html.indexOf('chat-capsule--current')
    const otherIndex = html.indexOf('Alpha')
    expect(currentIndex).toBeGreaterThan(-1)
    expect(otherIndex).toBeGreaterThan(-1)
    expect(currentIndex).toBeLessThan(otherIndex)
  })

  it('sorts non-current capsules by lastActivityAt descending', () => {
    const html = renderCapsuleBar(
      [
        { fileUuid: 'file-a', fileName: 'Alpha', status: 'idle', lastActivityAt: 100 },
        { fileUuid: 'file-b', fileName: 'Beta', status: 'idle', lastActivityAt: 300 },
        { fileUuid: 'file-c', fileName: 'Gamma', status: 'idle', lastActivityAt: 200 },
      ],
      'file-current',
    )

    const betaIndex = html.indexOf('Beta')
    const gammaIndex = html.indexOf('Gamma')
    const alphaIndex = html.indexOf('Alpha')
    expect(betaIndex).toBeLessThan(gammaIndex)
    expect(gammaIndex).toBeLessThan(alphaIndex)
  })

  it('resolves the open path from the persisted mapping when the file was not opened this launch', () => {
    vi.mocked(mindmapRegistry.getByFileUuid).mockReturnValue(undefined)

    expect(resolveCapsuleOpenPath('file-x', { 'file-x': '/workspace/x.mindlane' })).toBe(
      '/workspace/x.mindlane',
    )
  })

  it('prefers the loaded mindmap instance path over the persisted mapping', () => {
    vi.mocked(mindmapRegistry.getByFileUuid).mockReturnValue({
      store: { getState: () => ({ filePath: '/workspace/renamed.mindlane' }) },
    } as never)

    expect(resolveCapsuleOpenPath('file-x', { 'file-x': '/workspace/x.mindlane' })).toBe(
      '/workspace/renamed.mindlane',
    )
  })

  it('returns null when neither the registry nor the mapping knows the file', () => {
    vi.mocked(mindmapRegistry.getByFileUuid).mockReturnValue(undefined)

    expect(resolveCapsuleOpenPath('file-ghost', {})).toBeNull()
  })
})
