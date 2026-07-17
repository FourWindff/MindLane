import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  connectAiStore,
  createFileChatState,
  getActiveSessionBarEntries,
  useAiStore,
  type ChatSession,
  type ChatStreamEvent,
} from '../aiStore'
import type { ChatMessage } from '@/shared/lib/fileFormat'

type ChatApiMock = {
  listSessions: ReturnType<typeof vi.fn>
  loadSession: ReturnType<typeof vi.fn>
  deleteSession: ReturnType<typeof vi.fn>
}

const sessions: ChatSession[] = [
  {
    id: 'session-restored',
    fileUuid: 'file-a',
    title: 'Restored',
    createdAt: '2026-06-18T00:00:00.000Z',
    updatedAt: '2026-06-18T00:01:00.000Z',
    messageCount: 1,
  },
]

function installApis(options?: {
  activeSessionIds?: Record<string, string>
  loadSession?: () => Promise<{
    ok: true
    data: { sessionId: string; messages: ChatMessage[] }
  }>
  deleteSession?: () => Promise<{ ok: true }>
}) {
  let streamListener: ((event: ChatStreamEvent) => void) | undefined
  const chat: ChatApiMock = {
    listSessions: vi.fn(async () => ({ ok: true, data: { sessions } })),
    loadSession: vi.fn(
      options?.loadSession ??
        (async () => ({
          ok: true as const,
          data: {
            sessionId: 'session-restored',
            messages: [{ role: 'user', content: 'restored' } satisfies ChatMessage],
          },
        })),
    ),
    deleteSession: vi.fn(options?.deleteSession ?? (async () => ({ ok: true as const }))),
  }

  Object.defineProperty(globalThis, 'window', { configurable: true, value: globalThis })
  Object.defineProperty(globalThis.window, 'mindlane', {
    configurable: true,
    value: {
      ai: {
        onStreamEvent: vi.fn((listener: (event: ChatStreamEvent) => void) => {
          streamListener = listener
          return () => {
            streamListener = undefined
          }
        }),
      },
      chat,
      workspace: {
        getSession: vi.fn(async () => ({
          workspacePath: '/workspace',
          workspaceUuid: 'workspace-uuid',
          activeSessionIds: options?.activeSessionIds ?? {},
          recentWorkspacePaths: ['/workspace'],
          lastOpenedFilePath: '/a.mindlane',
          expandedFolderPaths: [],
          restoreLastWorkspaceOnLaunch: true,
        })),
        updateState: vi.fn(async () => ({ ok: true })),
      },
    },
  })

  return { chat, emit: (event: ChatStreamEvent) => streamListener?.(event) }
}

function createRegistryHarness() {
  let listener: (() => void) | undefined
  let active: { fileUuid: string; filePath: string; fileTitle: string } | null = null
  return {
    registry: {
      getActiveFile: () => active,
      subscribe: (next: () => void) => {
        listener = next
        return () => {
          listener = undefined
        }
      },
    },
    activate(fileUuid: string, filePath: string, fileTitle: string) {
      active = { fileUuid, filePath, fileTitle }
      listener?.()
    },
  }
}

describe('aiStore per-file chat state', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    useAiStore.setState({
      currentFileUuid: null,
      currentFilePath: null,
      fileChats: {},
      loadedFileChats: {},
      sessionFileUuids: {},
      activeStreamIds: {},
      activeSessionsBar: {},
      workspacePath: '/workspace',
      showSessionList: false,
      attachedDocument: null,
    })
  })

  it('loads the newly active file after a registry switch', async () => {
    installApis({ activeSessionIds: { 'file-a': 'session-restored' } })
    const harness = createRegistryHarness()
    connectAiStore(harness.registry)

    harness.activate('file-a', '/a.mindlane', 'A')
    await vi.waitFor(() => expect(useAiStore.getState().currentFileUuid).toBe('file-a'))

    expect(useAiStore.getState().currentFilePath).toBe('/a.mindlane')
    expect(useAiStore.getState().fileChats['file-a']).toBeDefined()
  })

  it('retries a file load after an earlier activation became stale', async () => {
    installApis({ activeSessionIds: { 'file-a': 'session-restored' } })
    const harness = createRegistryHarness()
    connectAiStore(harness.registry)

    harness.activate('file-a', '/a.mindlane', 'A')
    harness.activate('file-b', '/b.mindlane', 'B')
    harness.activate('file-a', '/a.mindlane', 'A')

    await vi.waitFor(() => expect(useAiStore.getState().loadedFileChats['file-a']).toBe(true))
    expect(useAiStore.getState().fileChats['file-a']?.activeSessionId).toBe('session-restored')
  })

  it('coalesces concurrent loads for the same file', async () => {
    const { chat } = installApis({ activeSessionIds: { 'file-a': 'session-restored' } })
    useAiStore.setState({ workspacePath: '/workspace' })

    await Promise.all([
      useAiStore.getState().loadFileChat('file-a'),
      useAiStore.getState().loadFileChat('file-a'),
    ])

    expect(chat.listSessions).toHaveBeenCalledTimes(1)
    expect(useAiStore.getState().loadedFileChats['file-a']).toBe(true)
  })

  it('updates active-session navigation metadata after a file move', () => {
    installApis()
    useAiStore.setState({
      currentFileUuid: 'file-b',
      currentFilePath: '/b.mindlane',
      activeSessionsBar: {
        'file-a': { fileUuid: 'file-a', fileName: 'a.mindlane', status: 'idle', lastInputAt: 0 },
      },
    })

    useAiStore.getState().updateFileLocation('file-a', '/folder/renamed.mindlane')

    expect(useAiStore.getState().activeSessionsBar['file-a']?.fileName).toBe('renamed.mindlane')
    expect(useAiStore.getState().currentFilePath).toBe('/b.mindlane')
  })

  it('routes stream events to the file bound to the session', () => {
    const { emit } = installApis()
    const harness = createRegistryHarness()
    connectAiStore(harness.registry)
    useAiStore.setState({
      fileChats: {
        'file-a': createFileChatState('session-a'),
        'file-b': createFileChatState('session-b'),
      },
      sessionFileUuids: { 'session-a': 'file-a', 'session-b': 'file-b' },
      activeStreamIds: { 'session-a': 'stream-a', 'session-b': 'stream-b' },
    })

    emit({ streamId: 'stream-a', sessionId: 'session-a', type: 'token', payload: 'A' })
    emit({ streamId: 'stream-b', sessionId: 'session-b', type: 'token', payload: 'B' })

    expect(useAiStore.getState().fileChats['file-a']?.streamText).toBe('A')
    expect(useAiStore.getState().fileChats['file-b']?.streamText).toBe('B')
  })

  it('routes pipeline progress to the file bound to the session', () => {
    const { emit } = installApis()
    const harness = createRegistryHarness()
    connectAiStore(harness.registry)
    useAiStore.setState({
      fileChats: { 'file-a': createFileChatState('session-a') },
      sessionFileUuids: { 'session-a': 'file-a' },
      activeStreamIds: { 'session-a': 'stream-a' },
    })

    emit({ streamId: 'stream-a', sessionId: 'session-a', type: 'step', payload: 'extracting' })

    expect(useAiStore.getState().fileChats['file-a']?.step).toBe('extracting')
  })

  it('drops events whose stream ID is stale or unknown', () => {
    const { emit } = installApis()
    const harness = createRegistryHarness()
    connectAiStore(harness.registry)
    useAiStore.setState({
      fileChats: { 'file-a': createFileChatState('session-a') },
      sessionFileUuids: { 'session-a': 'file-a' },
      activeStreamIds: { 'session-a': 'current-stream' },
    })

    emit({ streamId: 'stale-stream', sessionId: 'session-a', type: 'token', payload: 'stale' })
    emit({ streamId: 'unknown-stream', sessionId: 'unknown', type: 'token', payload: 'unknown' })

    expect(useAiStore.getState().fileChats['file-a']?.streamText).toBe('')
  })

  it('replays events that arrive while a known session is awaiting its stream ID', () => {
    const { emit } = installApis()
    const harness = createRegistryHarness()
    connectAiStore(harness.registry)
    useAiStore.setState({
      currentFileUuid: 'file-a',
      fileChats: {
        'file-a': { ...createFileChatState('session-a'), busy: true },
      },
      sessionFileUuids: { 'session-a': 'file-a' },
    })

    emit({ streamId: 'stream-a', sessionId: 'session-a', type: 'token', payload: 'early' })
    useAiStore.getState().registerStream('file-a', 'session-a', 'stream-a', 'A')

    expect(useAiStore.getState().fileChats['file-a']?.streamText).toBe('early')
  })

  it('restores the workspace active session for the file', async () => {
    const { chat } = installApis({ activeSessionIds: { 'file-a': 'session-restored' } })
    const harness = createRegistryHarness()
    connectAiStore(harness.registry)

    harness.activate('file-a', '/a.mindlane', 'A')
    await vi.waitFor(() =>
      expect(useAiStore.getState().fileChats['file-a']?.activeSessionId).toBe('session-restored'),
    )

    expect(chat.listSessions).toHaveBeenCalledWith({
      workspacePath: '/workspace',
      fileUuid: 'file-a',
      limit: 20,
      offset: 0,
    })
    expect(chat.loadSession).toHaveBeenCalledWith({
      workspacePath: '/workspace',
      sessionId: 'session-restored',
    })
    expect(useAiStore.getState().fileChats['file-a']?.chatMessages).toEqual([
      { role: 'user', content: 'restored' },
    ])
  })

  it('falls back to the most recent session when the persisted id is a phantom', async () => {
    const { chat } = installApis({ activeSessionIds: { 'file-a': 'phantom-session' } })
    useAiStore.setState({ workspacePath: '/workspace' })

    await useAiStore.getState().loadFileChat('file-a')

    expect(useAiStore.getState().fileChats['file-a']?.activeSessionId).toBe('session-restored')
    expect(chat.loadSession).toHaveBeenCalledWith({
      workspacePath: '/workspace',
      sessionId: 'session-restored',
    })
    expect(useAiStore.getState().fileChats['file-a']?.chatMessages).toEqual([
      { role: 'user', content: 'restored' },
    ])
    expect(window.mindlane!.workspace.updateState).toHaveBeenCalledWith({
      workspacePath: '/workspace',
      activeSession: { fileUuid: 'file-a', sessionId: 'session-restored' },
    })
  })

  it('does not clobber the persisted session mapping when listing fails', async () => {
    const { chat } = installApis({ activeSessionIds: { 'file-a': 'session-restored' } })
    chat.listSessions.mockResolvedValueOnce({ ok: false, error: 'boom' })
    useAiStore.setState({ workspacePath: '/workspace' })

    await useAiStore.getState().loadFileChat('file-a')

    expect(window.mindlane!.workspace.updateState).not.toHaveBeenCalled()
    expect(useAiStore.getState().loadedFileChats['file-a']).toBeUndefined()
  })

  it('keeps a pending loadSession result bound to its originating file', async () => {
    let resolveLoad!: (value: {
      ok: true
      data: { sessionId: string; messages: ChatMessage[] }
    }) => void
    const loadSession = () =>
      new Promise<{
        ok: true
        data: { sessionId: string; messages: ChatMessage[] }
      }>((resolve) => {
        resolveLoad = resolve
      })
    const { chat } = installApis({ loadSession })
    const harness = createRegistryHarness()
    connectAiStore(harness.registry)
    useAiStore.setState({
      workspacePath: '/workspace',
      currentFileUuid: 'file-a',
      fileChats: {
        'file-a': createFileChatState('session-a'),
        'file-b': createFileChatState('session-b'),
      },
    })

    const loading = useAiStore.getState().loadSession('session-a')
    useAiStore.setState({ currentFileUuid: 'file-b', workspacePath: '/workspace-b' })
    resolveLoad({
      ok: true,
      data: { sessionId: 'session-a', messages: [{ role: 'user', content: 'from A' }] },
    })
    await loading

    expect(useAiStore.getState().fileChats['file-a']?.chatMessages).toEqual([
      { role: 'user', content: 'from A' },
    ])
    expect(useAiStore.getState().fileChats['file-b']?.chatMessages).toEqual([])
    expect(chat.loadSession).toHaveBeenCalledWith({
      workspacePath: '/workspace',
      sessionId: 'session-a',
    })
    expect(window.mindlane!.workspace.updateState).toHaveBeenCalledWith({
      workspacePath: '/workspace',
      activeSession: { fileUuid: 'file-a', sessionId: 'session-a' },
    })
  })

  it('keeps a pending deleteSession replacement bound to its originating file', async () => {
    let resolveDelete!: (value: { ok: true }) => void
    const deleteSession = () =>
      new Promise<{ ok: true }>((resolve) => {
        resolveDelete = resolve
      })
    installApis({ deleteSession })
    useAiStore.setState({
      workspacePath: '/workspace',
      currentFileUuid: 'file-a',
      fileChats: {
        'file-a': createFileChatState('session-a'),
        'file-b': createFileChatState('session-b'),
      },
    })

    const deleting = useAiStore.getState().deleteSession('session-a')
    useAiStore.setState({ currentFileUuid: 'file-b' })
    resolveDelete({ ok: true })
    await deleting

    expect(useAiStore.getState().fileChats['file-a']?.activeSessionId).not.toBe('session-a')
    expect(useAiStore.getState().fileChats['file-b']?.activeSessionId).toBe('session-b')
  })

  it('does not let a stale delete replace a newer session on the same file', async () => {
    let resolveDelete!: (value: { ok: true }) => void
    const deleteSession = () =>
      new Promise<{ ok: true }>((resolve) => {
        resolveDelete = resolve
      })
    installApis({ deleteSession })
    useAiStore.setState({
      workspacePath: '/workspace',
      currentFileUuid: 'file-a',
      fileChats: { 'file-a': createFileChatState('session-a') },
    })

    const deleting = useAiStore.getState().deleteSession('session-a')
    useAiStore.setState({ fileChats: { 'file-a': createFileChatState('session-new') } })
    resolveDelete({ ok: true })
    await deleting

    expect(useAiStore.getState().fileChats['file-a']?.activeSessionId).toBe('session-new')
  })

  it('tracks active session status from generating through stopping to idle', () => {
    const { emit } = installApis()
    const harness = createRegistryHarness()
    connectAiStore(harness.registry)
    useAiStore.setState({
      fileChats: { 'file-a': createFileChatState('session-a') },
      sessionFileUuids: { 'session-a': 'file-a' },
    })

    useAiStore.getState().registerStream('file-a', 'session-a', 'stream-a', 'File A')
    expect(useAiStore.getState().activeSessionsBar['file-a']?.status).toBe('generating')

    useAiStore.getState().markStreamStopping('session-a')
    expect(useAiStore.getState().activeSessionsBar['file-a']?.status).toBe('stopping')

    emit({
      streamId: 'stream-a',
      sessionId: 'session-a',
      type: 'end',
      payload: { content: 'done' },
    })
    expect(useAiStore.getState().activeSessionsBar['file-a']?.status).toBe('idle')
  })

  it('writes a stream startup error to its originating background file', () => {
    installApis()
    useAiStore.setState({
      currentFileUuid: 'file-b',
      fileChats: {
        'file-a': { ...createFileChatState('session-a'), busy: true },
        'file-b': createFileChatState('session-b'),
      },
    })

    useAiStore.getState().setFileError('file-a', 'startup failed')

    expect(useAiStore.getState().fileChats['file-a']?.errorMessage).toBe('startup failed')
    expect(useAiStore.getState().fileChats['file-a']?.busy).toBe(false)
    expect(useAiStore.getState().fileChats['file-b']?.errorMessage).toBeNull()
  })
})

describe('activeSessionsBar projection', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    useAiStore.setState({
      currentFileUuid: null,
      currentFilePath: null,
      fileChats: {},
      loadedFileChats: {},
      sessionFileUuids: {},
      activeStreamIds: {},
      activeSessionsBar: {},
      workspacePath: '/workspace',
      showSessionList: false,
      attachedDocument: null,
    })
  })

  it('includes the current file first even when it has no active session entry', () => {
    useAiStore.setState({
      currentFileUuid: 'file-current',
      currentFilePath: '/current.mindlane',
      activeSessionsBar: {
        'file-a': { fileUuid: 'file-a', fileName: 'a.mindlane', status: 'idle', lastInputAt: 100 },
      },
    })

    const entries = getActiveSessionBarEntries(
      useAiStore.getState().activeSessionsBar,
      useAiStore.getState().currentFileUuid,
      useAiStore.getState().currentFilePath,
    )

    expect(entries[0]?.fileUuid).toBe('file-current')
    expect(entries).toHaveLength(2)
  })

  it('sorts non-current files by lastInputAt descending', () => {
    useAiStore.setState({
      currentFileUuid: 'file-current',
      currentFilePath: '/current.mindlane',
      activeSessionsBar: {
        'file-a': { fileUuid: 'file-a', fileName: 'a.mindlane', status: 'idle', lastInputAt: 100 },
        'file-b': { fileUuid: 'file-b', fileName: 'b.mindlane', status: 'idle', lastInputAt: 300 },
        'file-c': { fileUuid: 'file-c', fileName: 'c.mindlane', status: 'idle', lastInputAt: 200 },
      },
    })

    const entries = getActiveSessionBarEntries(
      useAiStore.getState().activeSessionsBar,
      useAiStore.getState().currentFileUuid,
      useAiStore.getState().currentFilePath,
    )
    const nonCurrent = entries.slice(1).map((e) => e.fileUuid)

    expect(nonCurrent).toEqual(['file-b', 'file-c', 'file-a'])
  })

  it('updates lastInputAt when a message is added for the current file', () => {
    const before = Date.now()
    useAiStore.setState({
      currentFileUuid: 'file-a',
      currentFilePath: '/a.mindlane',
      fileChats: { 'file-a': createFileChatState('session-a') },
    })

    useAiStore.getState().addChatMessage({ role: 'user', content: 'hello' })

    const entry = useAiStore.getState().activeSessionsBar['file-a']
    expect(entry).toBeDefined()
    expect(entry!.lastInputAt).toBeGreaterThanOrEqual(before)
    expect(entry!.fileName).toBe('a.mindlane')
  })

  it('keeps showSessionList as the single mode switch source', () => {
    expect(useAiStore.getState().showSessionList).toBe(false)
    useAiStore.getState().setShowSessionList(true)
    expect(useAiStore.getState().showSessionList).toBe(true)
  })
})
