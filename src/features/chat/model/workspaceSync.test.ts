import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deriveChatCapsuleEntries, useAiStore } from './aiStore'
import { connectChatWorkspaceSync } from './workspaceSync'
import { useWorkspaceStore } from '@/features/workspace/store'
import type { CapsuleFileMeta } from '@contracts/ipc'

function capsuleProjection() {
  const state = useAiStore.getState()
  return deriveChatCapsuleEntries(state.capsuleFiles, {
    fileChats: state.fileChats,
    filePaths: state.filePaths,
    currentFileUuid: state.currentFileUuid,
    currentFilePath: state.currentFilePath,
  })
}

function installApis(files: CapsuleFileMeta[] = []) {
  const api = {
    getSession: vi.fn(async () => ({
      workspacePath: '/ws',
      activeSessionIds: {},
      recentWorkspacePaths: ['/ws'],
      lastOpenedFilePath: null,
      restoreLastWorkspaceOnLaunch: true,
    })),
  }
  const chat = {
    listCapsuleFiles: vi.fn(async () => ({ ok: true as const, data: { files } })),
  }
  vi.stubGlobal('window', { mindlane: { workspace: api, chat } })
  return { api, chat }
}

describe('chat workspace sync', () => {
  let disconnect: () => void

  beforeEach(() => {
    useAiStore.setState({
      currentFileUuid: null,
      currentFilePath: null,
      fileChats: {},
      filePaths: {},
      capsuleFiles: [],
      sessionFileUuids: {},
      activeStreamIds: {},
      workspacePath: '/ws',
    })
    useWorkspaceStore.setState({ workspacePath: '/ws', tree: [] })
  })

  afterEach(() => {
    disconnect()
    vi.unstubAllGlobals()
  })

  it('re-pulls the capsule query when the workspace tree changes', async () => {
    const { chat } = installApis([
      { fileUuid: 'file-a', filePath: '/ws/a.mindlane', lastActivityAt: '2026-06-18T00:01:00Z' },
    ])
    disconnect = connectChatWorkspaceSync()

    useWorkspaceStore.setState({
      tree: [
        {
          name: 'a.mindlane',
          path: '/ws/a.mindlane',
          type: 'file',
          lastModifiedAt: '2026-06-18T00:00:00Z',
        },
      ],
    })

    await vi.waitFor(() =>
      expect(chat.listCapsuleFiles).toHaveBeenCalledWith({ workspacePath: '/ws' }),
    )
    expect(capsuleProjection().map((entry) => entry.fileName)).toEqual(['a.mindlane'])
  })

  it('shows the renamed file immediately: the rename is one query away, with no write-back', async () => {
    const { chat } = installApis([
      { fileUuid: 'file-a', filePath: '/ws/old.mindlane', lastActivityAt: '2026-06-18T00:01:00Z' },
    ])
    disconnect = connectChatWorkspaceSync()
    useWorkspaceStore.setState({ tree: [] })
    await vi.waitFor(() =>
      expect(capsuleProjection().map((entry) => entry.fileName)).toEqual(['old.mindlane']),
    )

    // The main process renamed the file and re-pointed its identity row; the
    // workspace tree change is what tells chat to re-pull.
    vi.mocked(chat.listCapsuleFiles).mockResolvedValue({
      ok: true as const,
      data: {
        files: [
          {
            fileUuid: 'file-a',
            filePath: '/ws/new.mindlane',
            lastActivityAt: '2026-06-18T00:01:00Z',
          },
        ],
      },
    })
    useWorkspaceStore.setState({
      tree: [
        {
          name: 'new.mindlane',
          path: '/ws/new.mindlane',
          type: 'file',
          lastModifiedAt: '2026-06-18T00:00:00Z',
        },
      ],
    })

    await vi.waitFor(() =>
      expect(capsuleProjection().map((entry) => entry.fileName)).toEqual(['new.mindlane']),
    )
  })

  it('drops a deleted file from the capsule once the query no longer returns it', async () => {
    const { chat } = installApis([
      { fileUuid: 'file-a', filePath: '/ws/a.mindlane', lastActivityAt: '2026-06-18T00:01:00Z' },
    ])
    disconnect = connectChatWorkspaceSync()
    useWorkspaceStore.setState({ tree: [] })
    await vi.waitFor(() => expect(capsuleProjection()).toHaveLength(1))

    // Delete cleared the identity row in the main process; the tree change is
    // the only renderer-side signal.
    vi.mocked(chat.listCapsuleFiles).mockResolvedValue({ ok: true as const, data: { files: [] } })
    useWorkspaceStore.setState({ tree: [] })

    await vi.waitFor(() => expect(capsuleProjection()).toEqual([]))
  })

  it('does not re-pull on unrelated workspace store updates', () => {
    const { api } = installApis()
    disconnect = connectChatWorkspaceSync()
    api.getSession.mockClear()

    useWorkspaceStore.setState({ busy: true })

    expect(api.getSession).not.toHaveBeenCalled()
  })
})
