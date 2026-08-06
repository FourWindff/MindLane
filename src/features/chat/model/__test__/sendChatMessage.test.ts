import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  connectAiStore,
  createFileChatState,
  useAiStore,
  type ChatStreamEvent,
  type FileChatState,
} from '../aiStore'
import { useSettingsStore } from '@/features/settings/model/settingsStore'

type ChatStreamResult = { ok: true; streamId: string } | { ok: false; error: string }

function installApis(options?: { chatStream?: () => Promise<ChatStreamResult> }) {
  let streamListener: ((event: ChatStreamEvent) => void) | undefined
  const chatStream = vi.fn(
    options?.chatStream ?? (async () => ({ ok: true as const, streamId: 'stream-1' })),
  )
  const stopStream = vi.fn(async () => ({ ok: true as const }))

  Object.defineProperty(globalThis, 'window', { configurable: true, value: globalThis })
  Object.defineProperty(globalThis.window, 'mindlane', {
    configurable: true,
    value: {
      ai: {
        chatStream,
        stopStream,
        onStreamEvent: vi.fn((listener: (event: ChatStreamEvent) => void) => {
          streamListener = listener
          return () => {
            streamListener = undefined
          }
        }),
      },
      chat: {
        listSessions: vi.fn(async () => ({ ok: true, data: { sessions: [] } })),
      },
      workspace: {
        getSession: vi.fn(async () => ({
          workspacePath: '/workspace',
          workspaceUuid: 'workspace-uuid',
          activeSessionIds: {},
          recentWorkspacePaths: ['/workspace'],
          lastOpenedFilePath: '/a.mindlane',
          restoreLastWorkspaceOnLaunch: true,
        })),
        updateState: vi.fn(async () => ({ ok: true })),
      },
    },
  })

  return { chatStream, stopStream, emit: (event: ChatStreamEvent) => streamListener?.(event) }
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

function activateFile(fileUuid: string, overrides?: Partial<FileChatState>) {
  useAiStore.setState({
    currentFileUuid: fileUuid,
    currentFilePath: `/${fileUuid}.mindlane`,
    fileChats: { [fileUuid]: { ...createFileChatState('session-a'), ...overrides } },
    sessionFileUuids: { 'session-a': fileUuid },
    threadId: 'session-a',
    busy: overrides?.busy ?? false,
  })
}

describe('sendChatMessage handshake', () => {
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
      busy: false,
      step: 'idle',
      streamText: '',
      errorMessage: null,
      threadId: '',
      chatMessages: [],
      sessions: [],
      activeTools: [],
      activeStreamId: null,
      showSessionList: false,
      attachedDocument: null,
    })
    useSettingsStore.setState({ loaded: true, apiKey: 'test-key', chatModel: 'test-model' })
  })

  it('rejects the send when busy, not chat-ready, or input is empty', async () => {
    const { chatStream } = installApis()

    activateFile('file-a', { busy: true })
    expect(await useAiStore.getState().sendChatMessage('hello')).toBe(false)

    activateFile('file-a')
    useSettingsStore.setState({ loaded: false, apiKey: '', chatModel: '' })
    expect(await useAiStore.getState().sendChatMessage('hello')).toBe(false)

    useSettingsStore.setState({ loaded: true, apiKey: 'test-key', chatModel: 'test-model' })
    expect(await useAiStore.getState().sendChatMessage('')).toBe(false)

    expect(chatStream).not.toHaveBeenCalled()
    expect(useAiStore.getState().chatMessages).toEqual([])
  })

  it('registers the stream with origin ids only after chatStream resolves', async () => {
    let resolveStream!: (value: ChatStreamResult) => void
    const { chatStream } = installApis({
      chatStream: () =>
        new Promise<ChatStreamResult>((resolve) => {
          resolveStream = resolve
        }),
    })
    activateFile('file-a')

    const sending = useAiStore.getState().sendChatMessage('hello')
    await vi.waitFor(() => expect(chatStream).toHaveBeenCalledTimes(1))
    expect(chatStream).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: 'session-a', message: 'hello' }),
    )
    expect(useAiStore.getState().activeStreamIds['session-a']).toBeUndefined()

    resolveStream({ ok: true, streamId: 'stream-1' })
    expect(await sending).toBe(true)

    expect(useAiStore.getState().activeStreamIds['session-a']).toBe('stream-1')
    expect(useAiStore.getState().sessionFileUuids['session-a']).toBe('file-a')
    expect(useAiStore.getState().activeSessionsBar['file-a']?.status).toBe('generating')
  })

  it('buffers stream events during the handshake and flushes only matching stream ids', async () => {
    let resolveStream!: (value: ChatStreamResult) => void
    const { chatStream, emit } = installApis({
      chatStream: () =>
        new Promise<ChatStreamResult>((resolve) => {
          resolveStream = resolve
        }),
    })
    const harness = createRegistryHarness()
    connectAiStore(harness.registry)
    activateFile('file-a')

    const sending = useAiStore.getState().sendChatMessage('hello')
    await vi.waitFor(() => expect(chatStream).toHaveBeenCalledTimes(1))

    emit({ streamId: 'stream-1', sessionId: 'session-a', type: 'token', payload: 'early' })
    emit({ streamId: 'other-stream', sessionId: 'session-a', type: 'token', payload: 'stray' })
    expect(useAiStore.getState().fileChats['file-a']?.streamText).toBe('')

    resolveStream({ ok: true, streamId: 'stream-1' })
    await sending

    expect(useAiStore.getState().fileChats['file-a']?.streamText).toBe('early')
  })

  it('does not wedge in busy state when the IPC bridge is missing', async () => {
    installApis()
    Object.defineProperty(globalThis.window, 'mindlane', { configurable: true, value: undefined })
    activateFile('file-a')

    const accepted = await useAiStore.getState().sendChatMessage('hello')

    expect(accepted).toBe(true)
    expect(useAiStore.getState().busy).toBe(false)
    expect(useAiStore.getState().step).toBe('idle')
    expect(useAiStore.getState().chatMessages).toEqual([
      expect.objectContaining({ role: 'user', content: 'hello' }),
    ])
  })

  it('surfaces a failed chatStream invoke as a file error on the origin file', async () => {
    installApis({ chatStream: async () => ({ ok: false as const, error: 'boom' }) })
    activateFile('file-a')

    expect(await useAiStore.getState().sendChatMessage('hello')).toBe(true)

    const chat = useAiStore.getState().fileChats['file-a']
    expect(chat?.errorMessage).toBe('boom')
    expect(chat?.busy).toBe(false)
    expect(useAiStore.getState().activeStreamIds['session-a']).toBeUndefined()
  })
})
