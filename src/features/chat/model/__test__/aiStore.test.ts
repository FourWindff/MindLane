import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  connectAiStore,
  createFileChatState,
  deriveChatCapsuleEntries,
  reduceStreamEvent,
  resetChatRetryStateForTests,
  selectCurrentChatHasFile,
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

beforeEach(() => {
  resetChatRetryStateForTests()
})

describe('aiStore per-file chat state', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    useAiStore.setState({
      currentFileUuid: null,
      currentFilePath: null,
      fileChats: {},
      filePaths: {},
      fileUuidPaths: {},
      allSessions: [],
      loadedFileChats: {},
      sessionFileUuids: {},
      activeStreamIds: {},
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

  it('retries the file chat load while the AI service is not ready yet', async () => {
    vi.useFakeTimers()
    try {
      const { chat } = installApis({ activeSessionIds: { 'file-a': 'session-restored' } })
      let calls = 0
      vi.mocked(chat.listSessions).mockImplementation(async () => {
        calls += 1
        if (calls < 3) return { ok: false as const, error: 'AI service not initialized' }
        return { ok: true as const, data: { sessions: [sessions[0]!] } }
      })
      useAiStore.setState({ workspacePath: '/workspace' })

      await useAiStore.getState().loadFileChat('file-a')
      expect(useAiStore.getState().loadedFileChats['file-a']).toBeUndefined()

      await vi.advanceTimersByTimeAsync(1000)
      await vi.advanceTimersByTimeAsync(1000)

      expect(useAiStore.getState().loadedFileChats['file-a']).toBe(true)
      expect(useAiStore.getState().fileChats['file-a']?.activeSessionId).toBe('session-restored')
    } finally {
      vi.useRealTimers()
    }
  })

  it('updates active-session navigation metadata after a file move', () => {
    installApis()
    useAiStore.setState({
      currentFileUuid: 'file-b',
      currentFilePath: '/b.mindlane',
      filePaths: { 'file-a': '/a.mindlane' },
    })

    useAiStore.getState().updateFileLocation('file-a', '/folder/renamed.mindlane')

    expect(useAiStore.getState().filePaths['file-a']).toBe('/folder/renamed.mindlane')
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
    useAiStore.getState().registerStream('file-a', 'session-a', 'stream-a')

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
      currentFileUuid: 'file-a',
      currentFilePath: '/file-a.mindlane',
      fileChats: { 'file-a': createFileChatState('session-a') },
      sessionFileUuids: { 'session-a': 'file-a' },
    })

    const derive = () =>
      deriveChatCapsuleEntries(
        useAiStore.getState().fileChats,
        useAiStore.getState().filePaths,
        useAiStore.getState().fileUuidPaths,
        useAiStore.getState().allSessions,
        useAiStore.getState().currentFileUuid,
        useAiStore.getState().currentFilePath,
      )

    useAiStore.getState().registerStream('file-a', 'session-a', 'stream-a')
    expect(derive().find((entry) => entry.fileUuid === 'file-a')?.status).toBe('generating')

    useAiStore.getState().markStreamStopping('session-a')
    expect(derive().find((entry) => entry.fileUuid === 'file-a')?.status).toBe('stopping')

    emit({
      streamId: 'stream-a',
      sessionId: 'session-a',
      type: 'end',
      payload: { content: 'done' },
    })
    expect(derive().find((entry) => entry.fileUuid === 'file-a')?.status).toBe('idle')
  })

  it('re-pulls the full session list when a stream ends so new conversations appear in the capsule bar', async () => {
    const { chat, emit } = installApis()
    vi.mocked(chat.listSessions).mockResolvedValue({
      ok: true as const,
      data: {
        sessions: [
          {
            id: 'session-a',
            fileUuid: 'file-a',
            title: 'A',
            createdAt: '2026-06-18T00:00:00.000Z',
            updatedAt: '2026-06-18T00:05:00.000Z',
            messageCount: 1,
          } satisfies ChatSession,
        ],
      },
    })
    const harness = createRegistryHarness()
    connectAiStore(harness.registry)
    useAiStore.setState({
      currentFileUuid: 'file-a',
      currentFilePath: '/file-a.mindlane',
      fileChats: { 'file-a': createFileChatState('session-a') },
      sessionFileUuids: { 'session-a': 'file-a' },
      allSessions: [],
    })

    useAiStore.getState().registerStream('file-a', 'session-a', 'stream-a')
    emit({
      streamId: 'stream-a',
      sessionId: 'session-a',
      type: 'end',
      payload: { content: 'done' },
    })

    // 主进程在发 end 前已完成会话持久化，重拉后新会话进入胶囊条。
    await vi.waitFor(() => expect(useAiStore.getState().allSessions).toHaveLength(1))
    expect(useAiStore.getState().allSessions[0]?.fileUuid).toBe('file-a')
  })

  it('retries the capsule refresh while the AI service is not ready yet', async () => {
    vi.useFakeTimers()
    try {
      const { chat } = installApis()
      const session: ChatSession = {
        id: 'session-a',
        fileUuid: 'file-a',
        title: 'A',
        createdAt: '2026-06-18T00:00:00.000Z',
        updatedAt: '2026-06-18T00:05:00.000Z',
        messageCount: 1,
      }
      let calls = 0
      vi.mocked(chat.listSessions).mockImplementation(async () => {
        calls += 1
        if (calls < 3) return { ok: false as const, error: 'AI service not initialized' }
        return { ok: true as const, data: { sessions: [session] } }
      })
      useAiStore.setState({ workspacePath: '/workspace', allSessions: [] })

      await useAiStore.getState().refreshCapsuleData()
      expect(useAiStore.getState().allSessions).toEqual([])

      await vi.advanceTimersByTimeAsync(1000)
      await vi.advanceTimersByTimeAsync(1000)

      expect(useAiStore.getState().allSessions).toEqual([session])
    } finally {
      vi.useRealTimers()
    }
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

describe('turn-state display stripping and gating', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    useAiStore.setState({
      currentFileUuid: null,
      currentFilePath: null,
      fileChats: {},
      filePaths: {},
      loadedFileChats: {},
      sessionFileUuids: {},
      activeStreamIds: {},
      workspacePath: '/workspace',
      showSessionList: false,
      attachedDocument: null,
    })
  })

  it('strips the trailing EDITOR_STATE block from user messages when a session is loaded for display', async () => {
    const stateBlock =
      '\n<EDITOR_STATE file_uuid="file-a" file_path="/a.mindlane" file_title="A">\n<SELECTED_NODES count="1">\n  <node id="n1" type="text" label="旧节点"/>\n</SELECTED_NODES>\n</EDITOR_STATE>'
    installApis({
      loadSession: async () => ({
        ok: true as const,
        data: {
          sessionId: 'session-restored',
          messages: [
            { role: 'user', content: `请整理导图${stateBlock}` } satisfies ChatMessage,
            { role: 'assistant', content: '好的' },
          ],
        },
      }),
    })
    useAiStore.setState({
      workspacePath: '/workspace',
      currentFileUuid: 'file-a',
      fileChats: { 'file-a': createFileChatState('session-a') },
    })

    await useAiStore.getState().loadSession('session-restored')

    const messages = useAiStore.getState().fileChats['file-a']?.chatMessages
    expect(messages?.[0]).toEqual({ role: 'user', content: '请整理导图' })
    expect(messages?.[1]).toEqual({ role: 'assistant', content: '好的' })
    expect(JSON.stringify(messages)).not.toContain('<EDITOR_STATE')
  })

  it('leaves old messages without a block unchanged (no-op)', async () => {
    installApis({
      loadSession: async () => ({
        ok: true as const,
        data: {
          sessionId: 'session-restored',
          messages: [{ role: 'user', content: '旧消息' } satisfies ChatMessage],
        },
      }),
    })
    useAiStore.setState({
      workspacePath: '/workspace',
      currentFileUuid: 'file-a',
      fileChats: { 'file-a': createFileChatState('session-a') },
    })

    await useAiStore.getState().loadSession('session-restored')

    expect(useAiStore.getState().fileChats['file-a']?.chatMessages).toEqual([
      { role: 'user', content: '旧消息' },
    ])
  })

  it('strips the block also on the initial file load path (loadFileChat)', async () => {
    const stateBlock =
      '\n<EDITOR_STATE file_uuid="file-a" file_path="/a.mindlane" file_title="A">\n<SELECTED_NODES count="0">\n</SELECTED_NODES>\n</EDITOR_STATE>'
    installApis({
      activeSessionIds: { 'file-a': 'session-restored' },
      loadSession: async () => ({
        ok: true as const,
        data: {
          sessionId: 'session-restored',
          messages: [{ role: 'user', content: `恢复的消息${stateBlock}` } satisfies ChatMessage],
        },
      }),
    })
    const harness = createRegistryHarness()
    connectAiStore(harness.registry)
    harness.activate('file-a', '/a.mindlane', 'A')

    await vi.waitFor(() => expect(useAiStore.getState().loadedFileChats['file-a']).toBe(true))

    expect(useAiStore.getState().fileChats['file-a']?.chatMessages).toEqual([
      { role: 'user', content: '恢复的消息' },
    ])
  })

  it('gates chat availability on an active file (source invariant)', () => {
    useAiStore.setState({ currentFileUuid: null, currentFilePath: null })
    expect(selectCurrentChatHasFile(useAiStore.getState())).toBe(false)

    useAiStore.setState({ currentFileUuid: 'file-a', currentFilePath: '/a.mindlane' })
    expect(selectCurrentChatHasFile(useAiStore.getState())).toBe(true)
  })
})

describe('deriveChatCapsuleEntries projection', () => {
  const sessionFor = (fileUuid: string, updatedAt: string): ChatSession => ({
    id: `session-${fileUuid}`,
    fileUuid,
    title: `Session ${fileUuid}`,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt,
    messageCount: 1,
  })

  const derive = () =>
    deriveChatCapsuleEntries(
      useAiStore.getState().fileChats,
      useAiStore.getState().filePaths,
      useAiStore.getState().fileUuidPaths,
      useAiStore.getState().allSessions,
      useAiStore.getState().currentFileUuid,
      useAiStore.getState().currentFilePath,
    )

  beforeEach(() => {
    vi.restoreAllMocks()
    useAiStore.setState({
      currentFileUuid: null,
      currentFilePath: null,
      fileChats: {},
      filePaths: {},
      fileUuidPaths: {},
      allSessions: [],
      loadedFileChats: {},
      sessionFileUuids: {},
      activeStreamIds: {},
      workspacePath: '/workspace',
      showSessionList: false,
      attachedDocument: null,
    })
  })

  it('includes the current file first even when it has no file chat entry', () => {
    useAiStore.setState({
      currentFileUuid: 'file-current',
      currentFilePath: '/current.mindlane',
      fileChats: {},
      filePaths: {},
    })

    const entries = derive()

    expect(entries[0]?.fileUuid).toBe('file-current')
    expect(entries[0]?.fileName).toBe('current.mindlane')
    expect(entries[0]?.status).toBe('idle')
    expect(entries).toHaveLength(1)
  })

  it('shows a file with saved sessions even when it was never opened this launch, labeled from fileUuidPaths', () => {
    useAiStore.setState({
      fileChats: {},
      filePaths: {},
      fileUuidPaths: { 'file-a': '/folder/a.mindlane' },
      allSessions: [sessionFor('file-a', '2026-06-18T00:01:00.000Z')],
    })

    const entries = derive()

    expect(entries.map((e) => e.fileUuid)).toEqual(['file-a'])
    expect(entries[0]?.fileName).toBe('a.mindlane')
    expect(entries[0]?.status).toBe('idle')
  })

  it('sorts non-current files by the most recent session updatedAt descending, current file pinned first', () => {
    useAiStore.setState({
      currentFileUuid: 'file-current',
      currentFilePath: '/current.mindlane',
      fileChats: {},
      filePaths: {},
      fileUuidPaths: {
        'file-a': '/a.mindlane',
        'file-b': '/b.mindlane',
        'file-c': '/c.mindlane',
      },
      allSessions: [
        sessionFor('file-a', '2026-06-18T00:00:00.000Z'),
        sessionFor('file-a', '2026-06-18T00:02:00.000Z'),
        sessionFor('file-b', '2026-06-18T00:03:00.000Z'),
        sessionFor('file-c', '2026-06-18T00:01:00.000Z'),
      ],
    })

    const entries = derive()
    const nonCurrent = entries.slice(1).map((e) => e.fileUuid)

    // file-a 有两条会话，按最近一条 00:02 排序，仍排在 file-c（00:01）之前
    expect(entries[0]?.fileUuid).toBe('file-current')
    expect(nonCurrent).toEqual(['file-b', 'file-a', 'file-c'])
  })

  it('keeps a busy file with no saved session in the bar as generating', () => {
    useAiStore.setState({
      fileChats: { 'file-a': { ...createFileChatState('session-a'), busy: true } },
      filePaths: { 'file-a': '/a.mindlane' },
      fileUuidPaths: {},
      allSessions: [],
    })

    const entries = derive()

    expect(entries.map((e) => e.fileUuid)).toEqual(['file-a'])
    expect(entries[0]?.status).toBe('generating')
  })

  it('excludes files whose sessions exist but have no path in fileUuidPaths', () => {
    useAiStore.setState({
      fileChats: {},
      filePaths: {},
      fileUuidPaths: { 'file-a': '/a.mindlane' },
      allSessions: [
        sessionFor('file-a', '2026-06-18T00:01:00.000Z'),
        sessionFor('file-orphan', '2026-06-18T00:02:00.000Z'),
      ],
    })

    const entries = derive()

    expect(entries.map((e) => e.fileUuid)).toEqual(['file-a'])
  })

  it('overrides the persisted state with in-memory stream status for the same file', () => {
    useAiStore.setState({
      fileChats: {
        'file-a': {
          ...createFileChatState('session-a'),
          busy: true,
          stopRequested: true,
        },
      },
      filePaths: { 'file-a': '/a.mindlane' },
      fileUuidPaths: { 'file-a': '/a.mindlane' },
      allSessions: [sessionFor('file-a', '2026-06-18T00:01:00.000Z')],
    })

    const entries = derive()

    expect(entries[0]?.status).toBe('stopping')
  })

  it('excludes files opened this launch but never chatted and not current', () => {
    useAiStore.setState({
      fileChats: {
        'file-dormant': { ...createFileChatState('session-dormant'), lastUserMessageAt: 0 },
      },
      filePaths: { 'file-dormant': '/dormant.mindlane' },
      fileUuidPaths: { 'file-dormant': '/dormant.mindlane' },
      allSessions: [],
    })

    expect(derive()).toEqual([])
  })

  it('derives the capsule name from the persistent mapping path basename', () => {
    useAiStore.setState({
      fileChats: {},
      filePaths: {},
      fileUuidPaths: { 'file-a': '/folder/renamed.mindlane' },
      allSessions: [sessionFor('file-a', '2026-06-18T00:01:00.000Z')],
    })

    expect(derive()[0]?.fileName).toBe('renamed.mindlane')
  })

  it('keeps showSessionList as the single mode switch source', () => {
    expect(useAiStore.getState().showSessionList).toBe(false)
    useAiStore.getState().setShowSessionList(true)
    expect(useAiStore.getState().showSessionList).toBe(true)
  })

  it('stores a quick action prompt as the input draft', () => {
    useAiStore.setState({
      currentFileUuid: 'file-a',
      fileChats: { 'file-a': createFileChatState('session-a') },
    })

    useAiStore.getState().setInputDraft('请帮我生成一个思维导图')

    expect(useAiStore.getState().inputDraft).toBe('请帮我生成一个思维导图')
  })
})

describe('reduceStreamEvent', () => {
  const base = createFileChatState('session-a')

  it('appends token payload to streamText', () => {
    const next = reduceStreamEvent(base, {
      streamId: 's',
      sessionId: 'session-a',
      type: 'token',
      payload: 'A',
    })
    const next2 = reduceStreamEvent(next, {
      streamId: 's',
      sessionId: 'session-a',
      type: 'token',
      payload: 'B',
    })
    expect(next2.streamText).toBe('AB')
  })

  it('flushes non-empty streamText into an assistant message on message-start', () => {
    const withText = reduceStreamEvent(base, {
      streamId: 's',
      sessionId: 'session-a',
      type: 'token',
      payload: 'hi',
    })
    const next = reduceStreamEvent(withText, {
      streamId: 's',
      sessionId: 'session-a',
      type: 'message-start',
      payload: null,
    })
    expect(next.chatMessages).toEqual([{ role: 'assistant', content: 'hi' }])
    expect(next.streamText).toBe('')
  })

  it('leaves state unchanged on message-start when streamText is empty', () => {
    const next = reduceStreamEvent(base, {
      streamId: 's',
      sessionId: 'session-a',
      type: 'message-start',
      payload: null,
    })
    expect(next).toBe(base)
  })

  it('tracks tool start and end in activeTools', () => {
    const started = reduceStreamEvent(base, {
      streamId: 's',
      sessionId: 'session-a',
      type: 'tool-start',
      payload: { name: 'search', input: {} },
    })
    expect(started.activeTools).toEqual(['search'])
    const ended = reduceStreamEvent(started, {
      streamId: 's',
      sessionId: 'session-a',
      type: 'tool-end',
      payload: { name: 'search', output: 'ok' },
    })
    expect(ended.activeTools).toEqual([])
  })

  it('ignores tool-start with an empty name', () => {
    const next = reduceStreamEvent(base, {
      streamId: 's',
      sessionId: 'session-a',
      type: 'tool-start',
      payload: { name: '', input: {} },
    })
    expect(next).toBe(base)
  })

  it('sets the pipeline step', () => {
    const next = reduceStreamEvent(base, {
      streamId: 's',
      sessionId: 'session-a',
      type: 'step',
      payload: 'extracting',
    })
    expect(next.step).toBe('extracting')
  })

  it('replaces the current turn with end payload messages', () => {
    const started = reduceStreamEvent(base, {
      streamId: 's',
      sessionId: 'session-a',
      type: 'token',
      payload: 'streamed',
    })
    const ended = reduceStreamEvent(started, {
      streamId: 's',
      sessionId: 'session-a',
      type: 'end',
      payload: {
        content: '',
        messages: [{ role: 'assistant', content: 'final' }],
      },
    })
    expect(ended.chatMessages).toEqual([{ role: 'assistant', content: 'final' }])
    expect(ended.streamText).toBe('')
    expect(ended.busy).toBe(false)
    expect(ended.stopRequested).toBe(false)
    expect(ended.step).toBe('idle')
    expect(ended.activeTools).toEqual([])
  })

  it('falls back to content and then streamText for end messages', () => {
    const fromContent = reduceStreamEvent(base, {
      streamId: 's',
      sessionId: 'session-a',
      type: 'end',
      payload: { content: 'done' },
    })
    expect(fromContent.chatMessages).toEqual([{ role: 'assistant', content: 'done' }])

    const withText = reduceStreamEvent(base, {
      streamId: 's',
      sessionId: 'session-a',
      type: 'token',
      payload: 'streamed',
    })
    const fromStreamText = reduceStreamEvent(withText, {
      streamId: 's',
      sessionId: 'session-a',
      type: 'end',
      payload: { content: '' },
    })
    expect(fromStreamText.chatMessages).toEqual([{ role: 'assistant', content: 'streamed' }])
  })

  it('keeps prior turns intact when ending with an empty payload', () => {
    const ended = reduceStreamEvent(
      { ...base, chatMessages: [{ role: 'user', content: 'q' }] },
      {
        streamId: 's',
        sessionId: 'session-a',
        type: 'end',
        payload: { content: '' },
      },
    )
    expect(ended.chatMessages).toEqual([{ role: 'user', content: 'q' }])
  })

  it('writes an error and resets the chat state', () => {
    const started = reduceStreamEvent(
      { ...base, busy: true, step: 'chatting', activeTools: ['search'], streamText: 'x' },
      {
        streamId: 's',
        sessionId: 'session-a',
        type: 'error',
        payload: 'boom',
      },
    )
    expect(started.errorMessage).toBe('boom')
    expect(started.busy).toBe(false)
    expect(started.stopRequested).toBe(false)
    expect(started.step).toBe('idle')
    expect(started.streamText).toBe('')
    expect(started.activeTools).toEqual([])
  })
})
