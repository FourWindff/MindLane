import { create } from 'zustand'
import type { ChatMessage, DocumentRef } from '@/shared/lib/fileFormat'
import type { ChatStreamEvent } from '../../../../electron/preload'

function generateSessionId(): string {
  return crypto.randomUUID()
}

export type AiPipelineStep =
  | 'idle'
  | 'preparing'
  | 'analyzing'
  | 'planning'
  | 'generating-image'
  | 'building'
  | 'reading-doc'
  | 'extracting'
  | 'merging'
  | 'finalizing'
  | 'generating-map'
  | 'chatting'

export type { ChatMessage }

export interface ChatSession {
  id: string
  fileUuid: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
}

export interface FileChatState {
  activeSessionId: string
  chatMessages: ChatMessage[]
  sessions: ChatSession[]
  busy: boolean
  step: AiPipelineStep
  streamText: string
  errorMessage: string | null
  activeTools: string[]
}

export type { ChatStreamEvent }

export interface ActiveSessionBarEntry {
  fileUuid: string
  fileName: string
  status: 'generating' | 'stopping' | 'idle'
}

interface ActiveFileInfo {
  fileUuid: string
  filePath: string
  fileTitle: string
}

interface AiStoreRegistry {
  getActiveFile: () => ActiveFileInfo | null
  subscribe: (listener: () => void) => () => void
}

interface AiState {
  currentFileUuid: string | null
  currentFilePath: string | null
  fileChats: Record<string, FileChatState>
  loadedFileChats: Record<string, boolean>
  sessionFileUuids: Record<string, string>
  activeStreamIds: Record<string, string>
  activeSessionsBar: Record<string, ActiveSessionBarEntry>
  workspacePath: string | null

  busy: boolean
  step: AiPipelineStep
  streamText: string
  errorMessage: string | null
  threadId: string
  chatMessages: ChatMessage[]
  sessions: ChatSession[]
  activeTools: string[]
  activeStreamId: string | null

  showSessionList: boolean
  isMinimized: boolean
  attachedDocument: DocumentRef | null

  setBusy: (busy: boolean) => void
  setStep: (step: AiPipelineStep) => void
  appendStreamText: (text: string) => void
  resetStream: () => void
  setError: (message: string) => void
  setFileError: (fileUuid: string, message: string) => void
  clearError: () => void
  reset: () => void
  setThreadId: (sessionId: string) => void
  addChatMessage: (message: ChatMessage) => void
  setChatMessages: (messages: ChatMessage[]) => void
  startNewChat: () => void
  setSessions: (sessions: ChatSession[]) => void
  setShowSessionList: (show: boolean) => void
  loadSession: (sessionId: string) => Promise<void>
  deleteSession: (sessionId: string) => Promise<void>
  setIsMinimized: (value: boolean) => void
  setAttachedDocument: (document: DocumentRef | null) => void
  loadFileChat: (fileUuid: string) => Promise<void>
  updateFileLocation: (fileUuid: string, filePath: string) => void
  registerStream: (fileUuid: string, sessionId: string, streamId: string, fileName?: string) => void
  markStreamStopping: (sessionId: string) => void
}

export function createFileChatState(activeSessionId = generateSessionId()): FileChatState {
  return {
    activeSessionId,
    chatMessages: [],
    sessions: [],
    busy: false,
    step: 'idle',
    streamText: '',
    errorMessage: null,
    activeTools: [],
  }
}

const EMPTY_CHAT = createFileChatState('')
const fileChatLoads = new Map<string, Promise<void>>()

function currentProjection(state: AiState, fileChats = state.fileChats) {
  const chat = state.currentFileUuid ? fileChats[state.currentFileUuid] : undefined
  return {
    busy: chat?.busy ?? false,
    step: chat?.step ?? ('idle' as AiPipelineStep),
    streamText: chat?.streamText ?? '',
    errorMessage: chat?.errorMessage ?? null,
    threadId: chat?.activeSessionId ?? '',
    chatMessages: chat?.chatMessages ?? [],
    sessions: chat?.sessions ?? [],
    activeTools: chat?.activeTools ?? [],
    activeStreamId: chat ? (state.activeStreamIds[chat.activeSessionId] ?? null) : null,
  }
}

function patchCurrentChat(state: AiState, patch: Partial<FileChatState>): Partial<AiState> | null {
  if (!state.currentFileUuid) return patch
  const current = state.fileChats[state.currentFileUuid] ?? createFileChatState()
  const fileChats = {
    ...state.fileChats,
    [state.currentFileUuid]: { ...current, ...patch },
  }
  return { fileChats, ...currentProjection(state, fileChats) }
}

function patchFileChat(
  state: AiState,
  fileUuid: string,
  patch: Partial<FileChatState>,
): Partial<AiState> {
  const current = state.fileChats[fileUuid] ?? createFileChatState()
  const fileChats = { ...state.fileChats, [fileUuid]: { ...current, ...patch } }
  const next = { fileChats }
  return state.currentFileUuid === fileUuid
    ? { ...next, ...currentProjection({ ...state, ...next } as AiState, fileChats) }
    : next
}

export const useAiStore = create<AiState>((set, get) => ({
  currentFileUuid: null,
  currentFilePath: null,
  fileChats: {},
  loadedFileChats: {},
  sessionFileUuids: {},
  activeStreamIds: {},
  activeSessionsBar: {},
  workspacePath: null,
  ...EMPTY_CHAT,
  threadId: '',
  activeStreamId: null,
  showSessionList: false,
  isMinimized: false,
  attachedDocument: null,

  setBusy: (busy) => set((state) => patchCurrentChat(state, { busy }) ?? { busy }),
  setStep: (step) => set((state) => patchCurrentChat(state, { step }) ?? { step }),
  appendStreamText: (text) =>
    set(
      (state) =>
        patchCurrentChat(state, { streamText: state.streamText + text }) ?? {
          streamText: state.streamText + text,
        },
    ),
  resetStream: () => set((state) => patchCurrentChat(state, { streamText: '' }) ?? {}),
  setError: (errorMessage) =>
    set(
      (state) =>
        patchCurrentChat(state, { errorMessage, busy: false, step: 'idle' }) ?? {
          errorMessage,
          busy: false,
          step: 'idle',
        },
    ),
  setFileError: (fileUuid, errorMessage) =>
    set((state) => {
      const current = state.fileChats[fileUuid] ?? createFileChatState()
      const fileChats = {
        ...state.fileChats,
        [fileUuid]: { ...current, errorMessage, busy: false, step: 'idle' as const },
      }
      const next = { fileChats }
      return state.currentFileUuid === fileUuid
        ? { ...next, ...currentProjection({ ...state, ...next } as AiState, fileChats) }
        : next
    }),
  clearError: () => set((state) => patchCurrentChat(state, { errorMessage: null }) ?? {}),
  reset: () =>
    set(
      (state) =>
        patchCurrentChat(state, {
          busy: false,
          step: 'idle',
          streamText: '',
          errorMessage: null,
          activeTools: [],
        }) ?? {},
    ),
  setThreadId: (activeSessionId) =>
    set((state) => patchCurrentChat(state, { activeSessionId }) ?? { threadId: activeSessionId }),
  addChatMessage: (message) =>
    set(
      (state) =>
        patchCurrentChat(state, { chatMessages: [...state.chatMessages, message] }) ?? {
          chatMessages: [...state.chatMessages, message],
        },
    ),
  setChatMessages: (chatMessages) =>
    set((state) => patchCurrentChat(state, { chatMessages }) ?? { chatMessages }),
  startNewChat: () => {
    const sessionId = generateSessionId()
    const fileUuid = get().currentFileUuid
    const workspacePath = get().workspacePath
    set((state) => ({
      ...(patchCurrentChat(state, createFileChatState(sessionId)) ?? {
        ...createFileChatState(sessionId),
        threadId: sessionId,
      }),
      showSessionList: false,
      attachedDocument: null,
      sessionFileUuids: state.currentFileUuid
        ? { ...state.sessionFileUuids, [sessionId]: state.currentFileUuid }
        : state.sessionFileUuids,
    }))
    void persistActiveSession(workspacePath, fileUuid, sessionId)
  },
  setSessions: (sessions) => set((state) => patchCurrentChat(state, { sessions }) ?? { sessions }),
  setShowSessionList: (showSessionList) => set({ showSessionList }),
  setIsMinimized: (isMinimized) => set({ isMinimized }),
  setAttachedDocument: (attachedDocument) => set({ attachedDocument }),

  loadSession: async (sessionId) => {
    const state = get()
    if (!state.workspacePath || !state.currentFileUuid) return
    const fileUuid = state.currentFileUuid
    const expectedActiveSessionId = state.fileChats[fileUuid]?.activeSessionId
    const result = await window.mindlane?.chat?.loadSession({
      workspacePath: state.workspacePath,
      sessionId,
    })
    if (!result?.ok) return
    let applied = false
    set((current) => {
      const currentFileChat = current.fileChats[fileUuid]
      if (currentFileChat && currentFileChat.activeSessionId !== expectedActiveSessionId) {
        return current
      }
      applied = true
      return {
        ...patchFileChat(current, fileUuid, {
          activeSessionId: result.data.sessionId,
          chatMessages: result.data.messages,
          busy: false,
          step: 'idle',
          streamText: '',
          errorMessage: null,
          activeTools: [],
        }),
        ...(current.currentFileUuid === fileUuid
          ? { showSessionList: false, attachedDocument: null }
          : {}),
        sessionFileUuids: {
          ...current.sessionFileUuids,
          [result.data.sessionId]: fileUuid,
        },
      }
    })
    if (!applied) return
    await persistActiveSession(state.workspacePath, fileUuid, result.data.sessionId)
  },

  deleteSession: async (sessionId) => {
    const state = get()
    if (!state.workspacePath || !state.currentFileUuid) return
    const fileUuid = state.currentFileUuid
    const result = await window.mindlane?.chat?.deleteSession({
      workspacePath: state.workspacePath,
      sessionId,
    })
    if (!result?.ok) return
    const sessionsResult = await window.mindlane?.chat?.listSessions({
      workspacePath: state.workspacePath,
      fileUuid,
      limit: 20,
      offset: 0,
    })
    const sessions = sessionsResult?.ok ? sessionsResult.data.sessions : []
    let replacementSessionId: string | null = null
    set((current) => {
      const deletedActiveSession = current.fileChats[fileUuid]?.activeSessionId === sessionId
      replacementSessionId = deletedActiveSession ? generateSessionId() : null
      const patch = replacementSessionId
        ? { ...createFileChatState(replacementSessionId), sessions }
        : { sessions }
      return {
        ...patchFileChat(current, fileUuid, patch),
        ...(current.currentFileUuid === fileUuid && replacementSessionId
          ? { showSessionList: false, attachedDocument: null }
          : {}),
        ...(replacementSessionId
          ? {
              sessionFileUuids: {
                ...current.sessionFileUuids,
                [replacementSessionId]: fileUuid,
              },
            }
          : {}),
      }
    })
    if (replacementSessionId)
      await persistActiveSession(state.workspacePath, fileUuid, replacementSessionId)
  },

  loadFileChat: (fileUuid) => {
    const workspacePath = get().workspacePath ?? ''
    const loadKey = `${workspacePath}\0${fileUuid}`
    const existingLoad = fileChatLoads.get(loadKey)
    if (existingLoad) return existingLoad
    const load = loadFileChat(fileUuid)
    fileChatLoads.set(loadKey, load)
    void load.finally(() => {
      if (fileChatLoads.get(loadKey) === load) fileChatLoads.delete(loadKey)
    })
    return load
  },
  updateFileLocation: (fileUuid, filePath) =>
    set((state) => {
      const entry = state.activeSessionsBar[fileUuid]
      return {
        ...(state.currentFileUuid === fileUuid ? { currentFilePath: filePath } : {}),
        ...(entry
          ? {
              activeSessionsBar: {
                ...state.activeSessionsBar,
                [fileUuid]: {
                  ...entry,
                  fileName: filePath.split(/[\\/]/).pop() ?? entry.fileName,
                },
              },
            }
          : {}),
      }
    }),

  registerStream: (fileUuid, sessionId, streamId, fileName) => {
    set((state) => {
      const current = state.fileChats[fileUuid] ?? createFileChatState(sessionId)
      const fileChats = {
        ...state.fileChats,
        [fileUuid]: {
          ...current,
          activeSessionId: sessionId,
          busy: true,
          step: 'chatting' as const,
        },
      }
      const next = {
        fileChats,
        sessionFileUuids: { ...state.sessionFileUuids, [sessionId]: fileUuid },
        activeStreamIds: { ...state.activeStreamIds, [sessionId]: streamId },
        activeSessionsBar: {
          ...state.activeSessionsBar,
          [fileUuid]: {
            fileUuid,
            fileName: fileName ?? state.currentFilePath?.split(/[\\/]/).pop() ?? fileUuid,
            status: 'generating' as const,
          },
        },
      }
      return state.currentFileUuid === fileUuid
        ? { ...next, ...currentProjection({ ...state, ...next } as AiState, fileChats) }
        : next
    })
    const pending = pendingStreamEvents.get(sessionId) ?? []
    pendingStreamEvents.delete(sessionId)
    for (const event of pending) {
      if (event.streamId === streamId) dispatchStreamEvent(event)
    }
  },
  markStreamStopping: (sessionId) => {
    set((state) => {
      const fileUuid = state.sessionFileUuids[sessionId]
      const entry = fileUuid ? state.activeSessionsBar[fileUuid] : undefined
      if (!fileUuid || !entry) return state
      return {
        activeSessionsBar: {
          ...state.activeSessionsBar,
          [fileUuid]: { ...entry, status: 'stopping' },
        },
      }
    })
  },
}))

async function loadFileChat(fileUuid: string): Promise<void> {
  const workspacePath = useAiStore.getState().workspacePath
  if (!workspacePath) return
  const [workspaceSession, sessionsResult] = await Promise.all([
    window.mindlane?.workspace.getSession(),
    window.mindlane?.chat?.listSessions({ workspacePath, fileUuid, limit: 20, offset: 0 }),
  ])
  const sessions = sessionsResult?.ok ? sessionsResult.data.sessions : []
  const restoredSessionId = workspaceSession?.activeSessionIds?.[fileUuid]
  const activeSessionId =
    restoredSessionId && sessions.some((session) => session.id === restoredSessionId)
      ? restoredSessionId
      : generateSessionId()
  let chatMessages: ChatMessage[] = []
  if (restoredSessionId === activeSessionId) {
    const loaded = await window.mindlane?.chat?.loadSession({
      workspacePath,
      sessionId: activeSessionId,
    })
    if (loaded?.ok) chatMessages = loaded.data.messages
  }
  useAiStore.setState((state) => {
    const fileChats = {
      ...state.fileChats,
      [fileUuid]: {
        ...createFileChatState(activeSessionId),
        chatMessages,
        sessions,
      },
    }
    const next = {
      fileChats,
      loadedFileChats: { ...state.loadedFileChats, [fileUuid]: true },
      sessionFileUuids: { ...state.sessionFileUuids, [activeSessionId]: fileUuid },
    }
    return state.currentFileUuid === fileUuid
      ? { ...next, ...currentProjection({ ...state, ...next } as AiState, fileChats) }
      : next
  })
  if (restoredSessionId !== activeSessionId) {
    await persistActiveSession(workspacePath, fileUuid, activeSessionId)
  }
}

async function persistActiveSession(
  workspacePath: string | null,
  fileUuid: string | null,
  sessionId: string,
): Promise<void> {
  if (!workspacePath || !fileUuid) return
  await window.mindlane?.workspace.updateState({
    workspacePath,
    activeSession: { fileUuid, sessionId },
  })
}

function routeStreamEvent(event: ChatStreamEvent): boolean {
  const currentState = useAiStore.getState()
  const pendingFileUuid = currentState.sessionFileUuids[event.sessionId]
  if (
    pendingFileUuid &&
    !currentState.activeStreamIds[event.sessionId] &&
    currentState.fileChats[pendingFileUuid]?.busy
  ) {
    pendingStreamEvents.set(event.sessionId, [
      ...(pendingStreamEvents.get(event.sessionId) ?? []),
      event,
    ])
    return false
  }
  let accepted = false
  useAiStore.setState((state) => {
    const fileUuid = state.sessionFileUuids[event.sessionId]
    if (!fileUuid || state.activeStreamIds[event.sessionId] !== event.streamId) return state
    const current = state.fileChats[fileUuid]
    if (!current) return state
    accepted = true
    let chat = current
    let activeStreamIds = state.activeStreamIds
    let activeSessionsBar = state.activeSessionsBar

    switch (event.type) {
      case 'token':
        chat = { ...chat, streamText: chat.streamText + String(event.payload) }
        break
      case 'message-start':
        if (chat.streamText.trim()) {
          chat = {
            ...chat,
            chatMessages: [...chat.chatMessages, { role: 'assistant', content: chat.streamText }],
            streamText: '',
          }
        }
        break
      case 'tool-start': {
        const name = (event.payload as { name?: string })?.name
        chat = { ...chat, activeTools: name ? [...chat.activeTools, name] : chat.activeTools }
        break
      }
      case 'tool-end': {
        const name = (event.payload as { name?: string })?.name
        chat = { ...chat, activeTools: chat.activeTools.filter((tool) => tool !== name) }
        break
      }
      case 'step':
        chat = { ...chat, step: event.payload as AiPipelineStep }
        break
      case 'end': {
        const response = event.payload as {
          content?: string
          messages?: Array<{ role: 'assistant'; content: string; toolCalls?: never[] }>
          toolCalls?: never[]
        }
        const messages = response.messages?.length
          ? response.messages
          : response.content || chat.streamText
            ? [
                {
                  role: 'assistant' as const,
                  content: response.content || chat.streamText,
                  toolCalls: response.toolCalls,
                },
              ]
            : []
        const lastUserIndex = chat.chatMessages.findLastIndex((message) => message.role === 'user')
        const messagesBeforeCurrentResponse =
          lastUserIndex >= 0 ? chat.chatMessages.slice(0, lastUserIndex + 1) : chat.chatMessages
        chat = {
          ...chat,
          chatMessages: [...messagesBeforeCurrentResponse, ...messages],
          busy: false,
          step: 'idle',
          streamText: '',
          activeTools: [],
        }
        activeStreamIds = { ...activeStreamIds }
        delete activeStreamIds[event.sessionId]
        activeSessionsBar = {
          ...activeSessionsBar,
          [fileUuid]: { ...activeSessionsBar[fileUuid]!, status: 'idle' },
        }
        break
      }
      case 'error':
        chat = {
          ...chat,
          busy: false,
          step: 'idle',
          streamText: '',
          activeTools: [],
          errorMessage: String(event.payload),
        }
        activeStreamIds = { ...activeStreamIds }
        delete activeStreamIds[event.sessionId]
        activeSessionsBar = {
          ...activeSessionsBar,
          [fileUuid]: { ...activeSessionsBar[fileUuid]!, status: 'idle' },
        }
        break
    }

    const fileChats = { ...state.fileChats, [fileUuid]: chat }
    const next = { ...state, fileChats, activeStreamIds, activeSessionsBar }
    return state.currentFileUuid === fileUuid
      ? { ...next, ...currentProjection(next, fileChats) }
      : next
  })
  return accepted
}

let disconnectStore: (() => void) | null = null
const streamEventListeners = new Set<(event: ChatStreamEvent) => void>()
const pendingStreamEvents = new Map<string, ChatStreamEvent[]>()

export function subscribeToChatStreamEvents(
  listener: (event: ChatStreamEvent) => void,
): () => void {
  streamEventListeners.add(listener)
  return () => streamEventListeners.delete(listener)
}

function dispatchStreamEvent(event: ChatStreamEvent): void {
  if (!routeStreamEvent(event)) return
  for (const listener of streamEventListeners) listener(event)
}

export function connectAiStore(registry: AiStoreRegistry): () => void {
  disconnectStore?.()
  const syncActiveFile = () => {
    const active = registry.getActiveFile()
    if (!active) {
      useAiStore.setState({
        currentFileUuid: null,
        currentFilePath: null,
        ...currentProjection({ ...useAiStore.getState(), currentFileUuid: null } as AiState),
      })
      return
    }
    const state = useAiStore.getState()
    const fileChats = state.fileChats[active.fileUuid]
      ? state.fileChats
      : { ...state.fileChats, [active.fileUuid]: createFileChatState() }
    const activeSessionId = fileChats[active.fileUuid]!.activeSessionId
    useAiStore.setState({
      currentFileUuid: active.fileUuid,
      currentFilePath: active.filePath,
      fileChats,
      sessionFileUuids: {
        ...state.sessionFileUuids,
        [activeSessionId]: active.fileUuid,
      },
      ...currentProjection({ ...state, currentFileUuid: active.fileUuid, fileChats } as AiState),
    })
    const shouldLoadFileChat = !state.loadedFileChats[active.fileUuid]
    void (async () => {
      const workspaceSession = await window.mindlane?.workspace.getSession()
      const latestActive = registry.getActiveFile()
      if (latestActive?.fileUuid !== active.fileUuid || latestActive.filePath !== active.filePath) {
        return
      }
      const workspacePath = workspaceSession?.workspacePath ?? null
      useAiStore.setState({ workspacePath })
      if (workspacePath && shouldLoadFileChat) {
        await useAiStore.getState().loadFileChat(active.fileUuid)
      }
    })()
  }
  const unsubscribeRegistry = registry.subscribe(syncActiveFile)
  const unsubscribeStream = window.mindlane?.ai.onStreamEvent(dispatchStreamEvent) ?? (() => {})
  syncActiveFile()
  disconnectStore = () => {
    unsubscribeRegistry()
    unsubscribeStream()
    disconnectStore = null
  }
  return disconnectStore
}
