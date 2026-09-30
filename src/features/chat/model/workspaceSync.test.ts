import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deriveChatCapsuleEntries, useAiStore } from './aiStore'
import { connectChatWorkspaceSync } from './workspaceSync'
import { useWorkspaceStore } from '@/features/workspace/store'
import { openFileRegistry } from '@/features/mindmap/model/openFileRegistry'
import { resetRegistry } from '@/features/mindmap/model/registryReset.testutil'
import { createEmptyFile } from '@contracts/fileFormat'

const session = {
  id: 'session-a',
  fileUuid: 'file-a',
  title: 'A',
  createdAt: '2026-06-18T00:00:00.000Z',
  updatedAt: '2026-06-18T00:01:00.000Z',
  messageCount: 1,
}

function capsule() {
  const state = useAiStore.getState()
  return deriveChatCapsuleEntries(
    state.fileChats,
    state.filePaths,
    state.fileUuidPaths,
    state.allSessions,
    state.currentFileUuid,
    state.currentFilePath,
  )
}

function installApis() {
  const api = {
    getSession: vi.fn(async () => ({
      workspacePath: '/ws',
      workspaceUuid: null,
      activeSessionIds: {},
      fileUuidPaths: {},
      recentWorkspacePaths: ['/ws'],
      lastOpenedFilePath: null,
      restoreLastWorkspaceOnLaunch: true,
    })),
    updateFileUuidPath: vi.fn(async () => ({ ok: true as const })),
  }
  vi.stubGlobal('window', {
    mindlane: {
      workspace: api,
      chat: {
        listSessions: vi.fn(async () => ({ ok: true as const, data: { sessions: [session] } })),
      },
    },
  })
  return api
}

function openFile(filePath: string): void {
  const instance = openFileRegistry.getOrCreate(filePath)
  const file = createEmptyFile('A')
  file.metadata.fileUuid = 'file-a'
  instance.load(filePath, file, '/ws')
  openFileRegistry.setActive(filePath)
}

describe('chat workspace sync', () => {
  let disconnect: () => void

  beforeEach(() => {
    resetRegistry()
    useAiStore.setState({
      currentFileUuid: null,
      currentFilePath: null,
      fileChats: {},
      filePaths: {},
      fileUuidPaths: { 'file-a': '/ws/a.mindlane' },
      allSessions: [session],
      sessionFileUuids: {},
      activeStreamIds: {},
      workspacePath: '/ws',
    })
    useWorkspaceStore.setState({ workspacePath: '/ws', tree: [] })
  })

  afterEach(() => {
    disconnect()
    vi.unstubAllGlobals()
    resetRegistry()
  })

  it('projects a rename into the capsule immediately and persists the mapping', () => {
    const api = installApis()
    openFile('/ws/a.mindlane')
    disconnect = connectChatWorkspaceSync()

    const instance = openFileRegistry.get('/ws/a.mindlane')!
    instance.store.getState().setFilePath('/ws/b.mindlane')
    openFileRegistry.renameKey('/ws/a.mindlane', '/ws/b.mindlane')

    expect(useAiStore.getState().fileUuidPaths['file-a']).toBe('/ws/b.mindlane')
    expect(api.updateFileUuidPath).toHaveBeenCalledWith({
      workspacePath: '/ws',
      fileUuid: 'file-a',
      filePath: '/ws/b.mindlane',
    })
    expect(capsule().find((entry) => entry.fileUuid === 'file-a')?.fileName).toBe('b.mindlane')
  })

  it('re-pulls the capsule inputs on a workspace tree change, hiding a pruned mapping', async () => {
    installApis()
    disconnect = connectChatWorkspaceSync()
    expect(capsule().find((entry) => entry.fileUuid === 'file-a')).toBeDefined()

    // The main process pruned the mapping after the delete; the tree change is
    // what tells chat to re-pull (the workspace store no longer pokes chat).
    useWorkspaceStore.setState({ tree: [] })

    await vi.waitFor(() => expect(useAiStore.getState().fileUuidPaths).toEqual({}))
    expect(capsule().find((entry) => entry.fileUuid === 'file-a')).toBeUndefined()
  })

  it('does not re-pull on unrelated workspace store updates', () => {
    const api = installApis()
    disconnect = connectChatWorkspaceSync()
    api.getSession.mockClear()

    useWorkspaceStore.setState({ busy: true })

    expect(api.getSession).not.toHaveBeenCalled()
  })
})
