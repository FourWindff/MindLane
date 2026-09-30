import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  connectAiStore,
  createFileChatState,
  resetChatRetryStateForTests,
  useAiStore,
  type ChatStreamEvent,
} from '../aiStore'
import { connectAiWritingProjection } from '../aiWritingProjection'
import { useSettingsStore } from '@/features/settings/model/settingsStore'
import { openFileRegistry } from '@/features/mindmap/model/openFileRegistry'
import { resetRegistry } from '@/features/mindmap/model/__test__/registryReset'
import { createEmptyFile } from '@contracts/fileFormat'

type ChatStreamResult = { ok: true; streamId: string } | { ok: false; error: string }

let emitStreamEvent: (event: ChatStreamEvent) => void = () => {}

function installStreamApi() {
  let streamListener: ((event: ChatStreamEvent) => void) | undefined
  const chatStream = vi.fn(async (): Promise<ChatStreamResult> => ({
    ok: true as const,
    streamId: 'stream-1',
  }))
  Object.defineProperty(globalThis, 'window', { configurable: true, value: globalThis })
  Object.defineProperty(globalThis.window, 'mindlane', {
    configurable: true,
    value: {
      ai: {
        chatStream,
        stopStream: vi.fn(async () => ({ ok: true as const })),
        onStreamEvent: vi.fn((listener: (event: ChatStreamEvent) => void) => {
          streamListener = listener
          return () => {
            streamListener = undefined
          }
        }),
      },
      chat: { listSessions: vi.fn(async () => ({ ok: true, data: { sessions: [] } })) },
      shell: { logError: vi.fn() },
      workspace: {
        getSession: vi.fn(async () => ({
          workspacePath: '/workspace',
          workspaceUuid: null,
          activeSessionIds: {},
          fileUuidPaths: {},
          recentWorkspacePaths: ['/workspace'],
          lastOpenedFilePath: null,
          restoreLastWorkspaceOnLaunch: true,
        })),
        updateState: vi.fn(async () => ({ ok: true as const })),
        loadSession: vi.fn(async () => ({
          ok: true as const,
          data: { sessionId: 'session-a', messages: [] },
        })),
      },
    },
  })
  emitStreamEvent = (event) => streamListener?.(event)
  return { chatStream }
}

/** Active file in both places the projection bridges: the registry and the chat store. */
function activateFile(fileUuid: string) {
  const key = `test-${fileUuid}`
  const instance = openFileRegistry.getOrCreate(key)
  const file = createEmptyFile('Test 导图')
  file.metadata.fileUuid = fileUuid
  instance.store.getState().loadFile(`/${fileUuid}.mindlane`, file, '/workspace')
  openFileRegistry.setActive(key)
  useAiStore.setState({
    currentFileUuid: fileUuid,
    currentFilePath: `/${fileUuid}.mindlane`,
    fileChats: { [fileUuid]: createFileChatState('session-a') },
    sessionFileUuids: { 'session-a': fileUuid },
  })
  return instance
}

function openFile(fileUuid: string) {
  return openFileRegistry.get(`test-${fileUuid}`)!
}

describe('AI writing projection', () => {
  let disconnect: () => void
  let disconnectAiStore: () => void

  beforeEach(() => {
    resetChatRetryStateForTests()
    useAiStore.setState({
      currentFileUuid: null,
      currentFilePath: null,
      fileChats: {},
      sessionFileUuids: {},
      activeStreamIds: {},
      workspacePath: '/workspace',
    })
    useSettingsStore.setState({ loaded: true, apiKey: 'test-key', chatModel: 'test-model' })
    // The stream events reach the store through the app's start-up wiring.
    installStreamApi()
    disconnectAiStore = connectAiStore(openFileRegistry)
    disconnect = connectAiWritingProjection()
  })

  afterEach(() => {
    disconnect()
    disconnectAiStore()
    resetRegistry()
  })

  it('marks the file while its stream runs and clears it when the run ends', async () => {
    const instance = activateFile('file-a')

    expect(await useAiStore.getState().sendChatMessage('hello')).toBe(true)
    expect(instance.isAiWriting()).toBe(true)

    emitStreamEvent({
      streamId: 'stream-1',
      sessionId: 'session-a',
      type: 'end',
      payload: { content: '好' },
    })
    expect(instance.isAiWriting()).toBe(false)
  })

  it('clears the mark when the run errors out', async () => {
    const instance = activateFile('file-a')

    expect(await useAiStore.getState().sendChatMessage('hello')).toBe(true)
    emitStreamEvent({
      streamId: 'stream-1',
      sessionId: 'session-a',
      type: 'error',
      payload: 'boom',
    })
    expect(instance.isAiWriting()).toBe(false)
  })

  it('keeps the mark while a stop is requested and drops it once the stream settles', async () => {
    const instance = activateFile('file-a')

    expect(await useAiStore.getState().sendChatMessage('hello')).toBe(true)
    useAiStore.getState().markStreamStopping('session-a')
    expect(instance.isAiWriting()).toBe(true)

    emitStreamEvent({
      streamId: 'stream-1',
      sessionId: 'session-a',
      type: 'end',
      payload: { content: '' },
    })
    expect(instance.isAiWriting()).toBe(false)
  })

  it('never notifies the mindmap store when the mark flips', async () => {
    activateFile('file-a')
    const instance = openFile('file-a')
    const storeListener = vi.fn()
    const fileListener = vi.fn()
    const unsubscribeStore = instance.store.subscribe(storeListener)
    instance.subscribeAiWriting(fileListener)

    useAiStore.setState((state) => ({
      fileChats: { ...state.fileChats, 'file-a': { ...state.fileChats['file-a']!, busy: true } },
    }))

    expect(instance.isAiWriting()).toBe(true)
    expect(fileListener).toHaveBeenCalledTimes(1)
    expect(storeListener).not.toHaveBeenCalled()
    expect(instance.store.getState().dirty).toBe(false)
    unsubscribeStore()
  })
})
