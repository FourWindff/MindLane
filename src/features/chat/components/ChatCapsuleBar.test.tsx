import { beforeEach, describe, expect, it, vi } from 'vitest'
import ReactDOMServer from 'react-dom/server'
import { ChatCapsuleBar, resolveCapsuleOpenPath } from './ChatCapsuleBar'
import { openFileRegistry } from '@/features/mindmap/model/openFileRegistry'
import type { CapsuleFileMeta } from '@contracts/ipc'

interface MockFileChat {
  busy: boolean
  stopRequested: boolean
}

const mockAiState = vi.hoisted(() => ({
  current: {
    currentFileUuid: null as string | null,
    currentFilePath: null as string | null,
    fileChats: {} as Record<string, MockFileChat>,
    filePaths: {} as Record<string, string>,
    capsuleFiles: [] as CapsuleFileMeta[],
    showSessionList: false,
    setShowSessionList: () => {},
  },
}))

// Only the store hook is faked; the projection under test stays the production one.
vi.mock('@/features/chat/model/aiStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/chat/model/aiStore')>()),
  useAiStore: (selector?: (state: typeof mockAiState.current) => unknown) =>
    selector ? selector(mockAiState.current) : mockAiState.current,
}))

vi.mock('@/features/workspace/store', () => ({
  useWorkspaceStore: () => ({ openWorkspaceFile: vi.fn() }),
}))

vi.mock('@/features/mindmap/model/openFileRegistry', () => ({
  openFileRegistry: {
    getByFileUuid: vi.fn(() => undefined),
  },
}))

type CapsuleSpec = {
  fileUuid: string
  fileName: string
  status: 'generating' | 'stopping' | 'idle'
}

function renderCapsuleBar(capsules: CapsuleSpec[], currentFileUuid: string | null) {
  mockAiState.current = {
    ...mockAiState.current,
    currentFileUuid,
    currentFilePath: currentFileUuid ? `/${currentFileUuid}.mindlane` : null,
    fileChats: Object.fromEntries(
      capsules.map((capsule) => [
        capsule.fileUuid,
        {
          busy: capsule.status === 'generating',
          stopRequested: capsule.status === 'stopping',
        },
      ]),
    ),
    filePaths: {},
    capsuleFiles: capsules.map((capsule, index) => ({
      fileUuid: capsule.fileUuid,
      filePath: `/${capsule.fileName}.mindlane`,
      // Query order is the capsule order; the projection must not re-sort.
      lastActivityAt: new Date(2026, 0, 1, 0, capsules.length - index).toISOString(),
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
      capsuleFiles: [],
      showSessionList: false,
      setShowSessionList: () => {},
    }
  })

  it('renders status classes for generating, stopping and idle capsules', () => {
    const html = renderCapsuleBar(
      [
        { fileUuid: 'file-a', fileName: 'A', status: 'generating' },
        { fileUuid: 'file-b', fileName: 'B', status: 'stopping' },
        { fileUuid: 'file-c', fileName: 'C', status: 'idle' },
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
        { fileUuid: 'file-a', fileName: 'Alpha', status: 'idle' },
        { fileUuid: 'file-b', fileName: 'Beta', status: 'idle' },
      ],
      'file-b',
    )

    const currentIndex = html.indexOf('chat-capsule--current')
    const otherIndex = html.indexOf('Alpha')
    expect(currentIndex).toBeGreaterThan(-1)
    expect(otherIndex).toBeGreaterThan(-1)
    expect(currentIndex).toBeLessThan(otherIndex)
  })

  it('keeps the query order for non-current capsules', () => {
    const html = renderCapsuleBar(
      [
        { fileUuid: 'file-b', fileName: 'Beta', status: 'idle' },
        { fileUuid: 'file-c', fileName: 'Gamma', status: 'idle' },
        { fileUuid: 'file-a', fileName: 'Alpha', status: 'idle' },
      ],
      'file-current',
    )

    const betaIndex = html.indexOf('Beta')
    const gammaIndex = html.indexOf('Gamma')
    const alphaIndex = html.indexOf('Alpha')
    expect(betaIndex).toBeLessThan(gammaIndex)
    expect(gammaIndex).toBeLessThan(alphaIndex)
  })

  it('opens the identity path from the query when the file was not opened this launch', () => {
    vi.mocked(openFileRegistry.getByFileUuid).mockReturnValue(undefined)

    expect(
      resolveCapsuleOpenPath({
        fileUuid: 'file-x',
        fileName: 'x.mindlane',
        filePath: '/workspace/x.mindlane',
        status: 'idle',
      }),
    ).toBe('/workspace/x.mindlane')
  })

  it('prefers the loaded instance path over the query path', () => {
    vi.mocked(openFileRegistry.getByFileUuid).mockReturnValue({
      store: { getState: () => ({ filePath: '/workspace/renamed.mindlane' }) },
    } as never)

    expect(
      resolveCapsuleOpenPath({
        fileUuid: 'file-x',
        fileName: 'x.mindlane',
        filePath: '/workspace/x.mindlane',
        status: 'idle',
      }),
    ).toBe('/workspace/renamed.mindlane')
  })
})
