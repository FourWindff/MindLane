import { create } from 'zustand'
import type { ChatMessage, DocumentRef } from '@/shared/lib/fileFormat'
import { buildChatContext } from '@/features/chat/lib/buildChatContext'
import { selectChatReady, useSettingsStore } from '@/features/settings/model/settingsStore'
import { splitCurrentTurn, stripTurnState } from '../../../../electron/ipc'
import type { ChatStreamEvent, StreamStep } from '../../../../electron/ipc'

function generateSessionId(): string {
  return crypto.randomUUID()
}

export type AiPipelineStep =
  | StreamStep
  | 'idle'
  | 'preparing'
  | 'analyzing'
  | 'planning'
  | 'generating-image'
  | 'building'
  | 'chatting'

export type { ChatMessage }

/**
 * Live tool card state for the streaming phase (id/name/status/step).
 * History cards are rebuilt from `ChatToolCall` (name + optional status/steps)
 * and rendered by the same component. Old sessions lack status/steps and render
 * as finished (success).
 */
export interface ToolCard {
  id: string
  name: string
  status: 'running' | 'success' | 'error' | 'canceled'
  /** Current subgraph stage (subgraph virtual tools only, consumed by slice 05). */
  step?: StreamStep
  completed?: number
  total?: number
}

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
  toolCards: ToolCard[]
  stopRequested: boolean
  lastUserMessageAt: number
}

export type { ChatStreamEvent }

export interface ChatCapsuleEntry {
  fileUuid: string
  fileName: string
  status: 'generating' | 'stopping' | 'idle'
  /** updatedAt (ms) of the file's most recent session; capsule sort key; 0 when none. */
  lastActivityAt: number
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
  filePaths: Record<string, string>
  /** Session-file index (persisted mapping): fileUuid -> filePath, used across restarts to render the capsule bar. */
  fileUuidPaths: Record<string, string>
  /** Full session list of the current workspace (pull without fileUuid); capsule bar membership and sort key. */
  allSessions: ChatSession[]
  loadedFileChats: Record<string, boolean>
  sessionFileUuids: Record<string, string>
  activeStreamIds: Record<string, string>
  workspacePath: string | null

  showSessionList: boolean
  attachedDocument: DocumentRef | null
  inputDraft: string

  setBusy: (busy: boolean) => void
  setStep: (step: AiPipelineStep) => void
  setError: (message: string) => void
  setFileError: (fileUuid: string, message: string) => void
  clearError: () => void
  reset: () => void
  addChatMessage: (message: ChatMessage) => void
  setShowSessionList: (show: boolean) => void
  loadSession: (sessionId: string) => Promise<void>
  deleteSession: (sessionId: string) => Promise<void>
  setAttachedDocument: (document: DocumentRef | null) => void
  setInputDraft: (text: string) => void
  loadFileChat: (fileUuid: string) => Promise<void>
  updateFileLocation: (fileUuid: string, filePath: string) => void
  /** Sync the in-memory and persisted mapping after rename/move (caller persists via the bridge). */
  updateFileUuidPath: (fileUuid: string, filePath: string) => void
  registerStream: (fileUuid: string, sessionId: string, streamId: string) => void
  markStreamStopping: (sessionId: string) => void
  sendChatMessage: (text: string) => Promise<boolean>
  stopChatStream: () => void
  /** Re-pull the capsule bar's persisted inputs (full session list + mapping) after workspace restore/switch or deleteSession. */
  refreshCapsuleData: () => Promise<void>
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
    toolCards: [],
    stopRequested: false,
    lastUserMessageAt: 0,
  }
}

const fileChatLoads = new Map<string, Promise<void>>()

// Bounded backoff retry for the read-side IPC: listSessions/loadSession return
// not-ready while the AI service is still starting; retry with a delay avoids a
// permanently blank list when the app boots. Counted per key, reset on success.
const RETRY_MAX = 5
const RETRY_DELAY_MS = 1000
const retryCounts = new Map<string, number>()
const pendingRetries = new Map<string, () => void>()
let retryTimer: ReturnType<typeof setTimeout> | null = null

function scheduleRetry(key: string, run: () => void): void {
  const count = retryCounts.get(key) ?? 0
  if (count >= RETRY_MAX) return
  retryCounts.set(key, count + 1)
  pendingRetries.set(key, run)
  if (retryTimer) return
  retryTimer = setTimeout(() => {
    retryTimer = null
    const entries = [...pendingRetries.entries()]
    pendingRetries.clear()
    for (const [, run] of entries) run()
  }, RETRY_DELAY_MS)
}

/** Test-only: clear the module-level backoff state so real timers do not leak across tests. */
export function resetChatRetryStateForTests(): void {
  if (retryTimer) {
    clearTimeout(retryTimer)
    retryTimer = null
  }
  pendingRetries.clear()
  retryCounts.clear()
}

const EMPTY_CHAT_MESSAGES: ChatMessage[] = []
const EMPTY_CHAT_SESSIONS: ChatSession[] = []
const EMPTY_TOOL_CARDS: ToolCard[] = []

function currentChat(state: AiState): FileChatState | undefined {
  return state.currentFileUuid ? state.fileChats[state.currentFileUuid] : undefined
}

export function selectCurrentChatActiveSessionId(state: AiState): string {
  return currentChat(state)?.activeSessionId ?? ''
}
export function selectCurrentChatHasFile(state: AiState): boolean {
  return state.currentFileUuid !== null
}
export function selectCurrentChatBusy(state: AiState): boolean {
  return currentChat(state)?.busy ?? false
}
export function selectCurrentChatStep(state: AiState): AiPipelineStep {
  return currentChat(state)?.step ?? 'idle'
}
export function selectCurrentChatStreamText(state: AiState): string {
  return currentChat(state)?.streamText ?? ''
}
export function selectCurrentChatErrorMessage(state: AiState): string | null {
  return currentChat(state)?.errorMessage ?? null
}
export function selectCurrentChatChatMessages(state: AiState): ChatMessage[] {
  return currentChat(state)?.chatMessages ?? EMPTY_CHAT_MESSAGES
}
export function selectCurrentChatSessions(state: AiState): ChatSession[] {
  return currentChat(state)?.sessions ?? EMPTY_CHAT_SESSIONS
}
export function selectCurrentChatToolCards(state: AiState): ToolCard[] {
  return currentChat(state)?.toolCards ?? EMPTY_TOOL_CARDS
}

function pathBasename(filePath: string | null | undefined): string | null {
  const name = filePath?.split(/[\\/]/).pop()
  return name ? name : null
}

/**
 * Display stripping: strip the trailing `<EDITOR_STATE>` block from user
 * messages when a session loads into the UI, so the reloaded history reads
 * clean. Messages without the block pass through unchanged (no-op).
 */
function stripTurnStateFromMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) => {
    if (message.role !== 'user') return message
    const content = stripTurnState(message.content)
    return content === message.content ? message : { ...message, content }
  })
}

/**
 * Capsule-bar read projection: members = files with session records (whose
 * mapping has a path) ∪ streaming in-progress ∪ current file;
 * sort = current file first, then by that file's most recent session updatedAt
 * descending. The in-memory `fileChats` holds only projected state
 * (busy/stopping/generating); it no longer decides membership on its own.
 */
export function deriveChatCapsuleEntries(
  fileChats: Record<string, FileChatState>,
  filePaths: Record<string, string>,
  fileUuidPaths: Record<string, string>,
  allSessions: ChatSession[],
  currentFileUuid: string | null,
  currentFilePath: string | null,
): ChatCapsuleEntry[] {
  const sessionsByFile = new Map<string, ChatSession[]>()
  for (const session of allSessions) {
    const list = sessionsByFile.get(session.fileUuid) ?? []
    list.push(session)
    sessionsByFile.set(session.fileUuid, list)
  }
  const mostRecentSessionAt = (fileUuid: string): number => {
    const list = sessionsByFile.get(fileUuid) ?? []
    return list.reduce((max, session) => {
      const at = Date.parse(session.updatedAt) || 0
      return at > max ? at : max
    }, 0)
  }

  const candidateKeys = new Set([...Object.keys(fileChats), ...sessionsByFile.keys()])
  if (currentFileUuid) candidateKeys.add(currentFileUuid)

  const entries: ChatCapsuleEntry[] = []
  for (const fileUuid of candidateKeys) {
    const chat = fileChats[fileUuid]
    const isCurrent = fileUuid === currentFileUuid
    const isStreaming = Boolean(chat?.busy || chat?.stopRequested)
    // Files with sessions but no mapped path (deleted / never opened before the upgrade) stay hidden.
    const hasSessionWithPath = Boolean(sessionsByFile.has(fileUuid) && fileUuidPaths[fileUuid])
    if (!(isCurrent || isStreaming || hasSessionWithPath)) continue
    const filePath =
      fileUuidPaths[fileUuid] ?? filePaths[fileUuid] ?? (isCurrent ? currentFilePath : null)
    entries.push({
      fileUuid,
      fileName: pathBasename(filePath) ?? fileUuid,
      status: chat?.stopRequested ? 'stopping' : chat?.busy ? 'generating' : 'idle',
      lastActivityAt: mostRecentSessionAt(fileUuid),
    })
  }
  return entries.sort((a, b) => {
    if (a.fileUuid === currentFileUuid) return -1
    if (b.fileUuid === currentFileUuid) return 1
    return b.lastActivityAt - a.lastActivityAt
  })
}

function patchFileChat(
  state: AiState,
  fileUuid: string,
  patch: Partial<FileChatState>,
): Partial<AiState> {
  const current = state.fileChats[fileUuid] ?? createFileChatState()
  return {
    fileChats: { ...state.fileChats, [fileUuid]: { ...current, ...patch } },
  }
}

export const useAiStore = create<AiState>((set, get) => ({
  currentFileUuid: null,
  currentFilePath: null,
  fileChats: {},
  filePaths: {},
  fileUuidPaths: {},
  allSessions: [],
  loadedFileChats: {},
  sessionFileUuids: {},
  activeStreamIds: {},
  workspacePath: null,
  showSessionList: false,
  attachedDocument: null,
  inputDraft: '',

  setBusy: (busy) =>
    set((state) => {
      const fileUuid = state.currentFileUuid
      if (!fileUuid) return {}
      return patchFileChat(state, fileUuid, { busy })
    }),
  setStep: (step) =>
    set((state) => {
      const fileUuid = state.currentFileUuid
      if (!fileUuid) return {}
      return patchFileChat(state, fileUuid, { step })
    }),
  setError: (errorMessage) =>
    set((state) => {
      const fileUuid = state.currentFileUuid
      if (!fileUuid) return {}
      return patchFileChat(state, fileUuid, { errorMessage, busy: false, step: 'idle' })
    }),
  setFileError: (fileUuid, errorMessage) =>
    set((state) => patchFileChat(state, fileUuid, { errorMessage, busy: false, step: 'idle' })),
  clearError: () =>
    set((state) => {
      const fileUuid = state.currentFileUuid
      if (!fileUuid) return {}
      return patchFileChat(state, fileUuid, { errorMessage: null })
    }),
  reset: () =>
    set((state) => {
      const fileUuid = state.currentFileUuid
      if (!fileUuid) return {}
      return patchFileChat(state, fileUuid, {
        busy: false,
        step: 'idle',
        streamText: '',
        errorMessage: null,
        toolCards: [],
      })
    }),
  addChatMessage: (message) =>
    set((state) => {
      const fileUuid = state.currentFileUuid
      if (!fileUuid) return {}
      const current = state.fileChats[fileUuid]
      return patchFileChat(state, fileUuid, {
        chatMessages: [...(current?.chatMessages ?? []), message],
        lastUserMessageAt: Date.now(),
      })
    }),
  setShowSessionList: (showSessionList) => set({ showSessionList }),
  setAttachedDocument: (attachedDocument) => set({ attachedDocument }),
  setInputDraft: (inputDraft) => set({ inputDraft }),

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
          chatMessages: stripTurnStateFromMessages(result.data.messages),
          busy: false,
          step: 'idle',
          streamText: '',
          errorMessage: null,
          toolCards: [],
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
    // Deleting a session may remove the file's last session: re-pull the full list to refresh the capsule bar.
    void useAiStore.getState().refreshCapsuleData()
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
  refreshCapsuleData: async () => {
    const workspaceSession = await window.mindlane?.workspace.getSession()
    const workspacePath = workspaceSession?.workspacePath ?? null
    const fileUuidPaths = workspaceSession?.fileUuidPaths ?? {}
    let allSessions: ChatSession[] = []
    if (workspacePath) {
      const result = await window.mindlane?.chat?.listSessions({
        workspacePath,
      })
      if (result?.ok) {
        retryCounts.delete('capsule')
        allSessions = result.data.sessions
      } else {
        // The main-process AI service may not be assembled yet: persist the
        // mapping first and retry the session pull later; never clear data that
        // is already ready (allSessions keeps its old value).
        useAiStore.setState({ workspacePath, fileUuidPaths })
        scheduleRetry('capsule', () => {
          void useAiStore.getState().refreshCapsuleData()
        })
        return
      }
    }
    useAiStore.setState({ workspacePath, fileUuidPaths, allSessions })
  },
  updateFileLocation: (fileUuid, filePath) =>
    set((state) => ({
      ...(state.currentFileUuid === fileUuid ? { currentFilePath: filePath } : {}),
      filePaths: { ...state.filePaths, [fileUuid]: filePath },
    })),

  /** Persisted mapping + in-memory path updated together (called via the bridge by the workspace store after rename/move). */
  updateFileUuidPath: (fileUuid, filePath) =>
    set((state) => ({
      ...(state.currentFileUuid === fileUuid ? { currentFilePath: filePath } : {}),
      filePaths: { ...state.filePaths, [fileUuid]: filePath },
      fileUuidPaths: { ...state.fileUuidPaths, [fileUuid]: filePath },
    })),

  registerStream: (fileUuid, sessionId, streamId) => {
    set((state) => {
      const current = state.fileChats[fileUuid] ?? createFileChatState(sessionId)
      const fileChats = {
        ...state.fileChats,
        [fileUuid]: {
          ...current,
          activeSessionId: sessionId,
          busy: true,
          step: 'chatting' as const,
          lastUserMessageAt: Date.now(),
        },
      }
      return {
        fileChats,
        sessionFileUuids: { ...state.sessionFileUuids, [sessionId]: fileUuid },
        activeStreamIds: { ...state.activeStreamIds, [sessionId]: streamId },
      }
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
      if (!fileUuid || !state.fileChats[fileUuid]) return state
      const current = state.fileChats[fileUuid]
      return patchFileChat(state, fileUuid, {
        stopRequested: true,
        // Stop: in-flight cards are marked canceled (unexecuted ones stay
        // unexecuted; already-applied ones keep their state).
        toolCards: markRunningCardsCanceled(current.toolCards),
      })
    })
  },

  // Owns the send handshake: await chatStream for the streamId first, then
  // registerStream with the origin ids captured before the await. All guards
  // read fresh state via get() instead of render-time snapshots.
  sendChatMessage: async (text) => {
    const doc = get().attachedDocument
    const fileUuid = get().currentFileUuid
    const busy = fileUuid ? (get().fileChats[fileUuid]?.busy ?? false) : false
    if ((!text && !doc) || busy) return false
    if (!selectChatReady(useSettingsStore.getState())) return false

    const message = text || `请根据「${doc?.filename}」生成思维导图`
    get().addChatMessage({
      role: 'user',
      content: message,
      ...(doc ? { attachment: { name: doc.filename, type: doc.type } } : {}),
    })

    // Checked before setBusy so a missing IPC bridge cannot wedge the UI in
    // the busy state.
    const api = window.mindlane?.ai
    if (!api) return true

    get().setBusy(true)
    get().setStep('chatting')

    const context = buildChatContext()
    const originFileUuid = get().currentFileUuid
    const originSessionId = currentChat(get())?.activeSessionId ?? ''
    get().setAttachedDocument(null)

    const result = await api.chatStream({
      threadId: originSessionId,
      message,
      context,
    })
    if (result.ok) {
      if (originFileUuid) {
        get().registerStream(originFileUuid, originSessionId, result.streamId)
      }
    } else if (originFileUuid) {
      get().setFileError(originFileUuid, result.error)
    }
    return true
  },
  stopChatStream: () => {
    const api = window.mindlane?.ai
    if (!api) return
    const state = get()
    const fileUuid = state.currentFileUuid
    const sessionId = fileUuid ? state.fileChats[fileUuid]?.activeSessionId : undefined
    if (!sessionId) return
    const streamId = state.activeStreamIds[sessionId]
    if (streamId) {
      get().markStreamStopping(sessionId)
      void api.stopStream(streamId)
    }
  },
}))

async function loadFileChat(fileUuid: string): Promise<void> {
  const workspacePath = useAiStore.getState().workspacePath
  if (!workspacePath) return
  const [workspaceSession, sessionsResult] = await Promise.all([
    window.mindlane?.workspace.getSession(),
    window.mindlane?.chat?.listSessions({ workspacePath, fileUuid, limit: 20, offset: 0 }),
  ])
  // On query failure we give up: at that point it is impossible to tell
  // "session does not exist" from "query error", and continuing would fabricate
  // a phantom id and overwrite a still-valid mapping in state.json.
  // AI not ready (not-ready) counts as a query error: retry with a delay so the
  // history does not stay permanently blank after opening a file.
  if (!sessionsResult?.ok) {
    scheduleRetry(`${workspacePath}\0${fileUuid}`, () => {
      // A stale request from a switched workspace is voided, so data from the
      // new workspace is never pulled in by mistake.
      if (useAiStore.getState().workspacePath !== workspacePath) return
      void useAiStore.getState().loadFileChat(fileUuid)
    })
    return
  }
  retryCounts.delete(`${workspacePath}\0${fileUuid}`)
  const sessions = sessionsResult.data.sessions
  const restoredSessionId = workspaceSession?.activeSessionIds?.[fileUuid]
  // state.json may point at a phantom session that never received a message
  // (e.g. a new conversation closed without chatting); fall back to the most
  // recent existing session instead of minting a new phantom.
  const activeSessionId =
    restoredSessionId && sessions.some((session) => session.id === restoredSessionId)
      ? restoredSessionId
      : (sessions[0]?.id ?? generateSessionId())
  let chatMessages: ChatMessage[] = []
  if (sessions.some((session) => session.id === activeSessionId)) {
    const loaded = await window.mindlane?.chat?.loadSession({
      workspacePath,
      sessionId: activeSessionId,
    })
    if (loaded?.ok) chatMessages = stripTurnStateFromMessages(loaded.data.messages)
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
    return {
      fileChats,
      loadedFileChats: { ...state.loadedFileChats, [fileUuid]: true },
      sessionFileUuids: { ...state.sessionFileUuids, [activeSessionId]: fileUuid },
    }
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

/** Subgraph virtual tools: `step` events map to the unfinished instances of these cards (palace has no stage process, only status transitions). */
const SUBGRAPH_TOOLS = ['generateMindmapFragment', 'generatePalace']

function isSubgraphTool(name: string): boolean {
  return SUBGRAPH_TOOLS.includes(name)
}

function markRunningCardsCanceled(toolCards: ToolCard[]): ToolCard[] {
  return toolCards.map((card) =>
    card.status === 'running' ? { ...card, status: 'canceled' } : card,
  )
}

export function reduceStreamEvent(chat: FileChatState, event: ChatStreamEvent): FileChatState {
  switch (event.type) {
    case 'token':
      return { ...chat, streamText: chat.streamText + event.payload }
    case 'message-start':
      return chat.streamText.trim()
        ? {
            ...chat,
            chatMessages: [...chat.chatMessages, { role: 'assistant', content: chat.streamText }],
            streamText: '',
          }
        : chat
    case 'tool-start': {
      const { id, name } = event.payload
      if (!name) return chat
      const card: ToolCard = { id, name, status: 'running' }
      const existingIndex = id ? chat.toolCards.findIndex((c) => c.id === id) : -1
      if (existingIndex >= 0) {
        const toolCards = [...chat.toolCards]
        toolCards[existingIndex] = card
        return { ...chat, toolCards }
      }
      return { ...chat, toolCards: [...chat.toolCards, card] }
    }
    case 'tool-end': {
      const { id, name, status } = event.payload
      const byId = id ? chat.toolCards.findIndex((card) => card.id === id) : -1
      const index = byId >= 0 ? byId : chat.toolCards.findIndex((card) => card.name === name)
      if (index < 0) return chat
      const toolCards = [...chat.toolCards]
      toolCards[index] = { ...toolCards[index]!, status }
      return { ...chat, toolCards }
    }
    case 'step': {
      const { step, completed, total } = event.payload
      const runningSubgraph = chat.toolCards.filter(
        (card) => card.status === 'running' && isSubgraphTool(card.name),
      )
      if (runningSubgraph.length === 0) return { ...chat, step }
      const target = runningSubgraph[runningSubgraph.length - 1]!
      return {
        ...chat,
        step,
        toolCards: chat.toolCards.map((card) =>
          card === target
            ? {
                ...card,
                step,
                ...(typeof completed === 'number' ? { completed } : {}),
                ...(typeof total === 'number' ? { total } : {}),
              }
            : card,
        ),
      }
    }
    case 'end': {
      const response = event.payload
      // Aborted ends carry content only: keep every streamed card in the final
      // message — finished ones with their real status, in-flight ones as
      // canceled — so the history records which tools ran before the stop.
      const canceledCalls = response.toolCalls?.length
        ? undefined
        : chat.toolCards.map((card) => ({
            name: card.name,
            args: {},
            result: '',
            ...(card.status === 'running'
              ? { status: 'canceled' as const }
              : { status: card.status }),
          }))
      const toolCalls = response.toolCalls ?? canceledCalls
      const messages = response.messages?.length
        ? response.messages
        : response.content || chat.streamText || (toolCalls?.length ?? 0) > 0
          ? [
              {
                role: 'assistant' as const,
                content: response.content || chat.streamText,
                ...(toolCalls?.length ? { toolCalls } : {}),
              },
            ]
          : []
      const { previous } = splitCurrentTurn(chat.chatMessages)
      return {
        ...chat,
        chatMessages: [...previous, ...messages],
        busy: false,
        stopRequested: false,
        step: 'idle',
        streamText: '',
        toolCards: [],
      }
    }
    case 'error':
      return {
        ...chat,
        busy: false,
        stopRequested: false,
        step: 'idle',
        streamText: '',
        toolCards: [],
        errorMessage: event.payload,
      }
  }
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
    let activeStreamIds = state.activeStreamIds
    if (event.type === 'end' || event.type === 'error') {
      activeStreamIds = { ...activeStreamIds }
      delete activeStreamIds[event.sessionId]
    }
    const fileChats = { ...state.fileChats, [fileUuid]: reduceStreamEvent(current, event) }
    return { fileChats, activeStreamIds }
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
  // By the time the stream ends or fails, the main process has already
  // persisted (or abandoned) the session: re-pull the full list so
  // conversations created this launch appear in the capsule bar immediately
  // instead of waiting for the next launch.
  if (event.type === 'end' || event.type === 'error') {
    void useAiStore.getState().refreshCapsuleData()
  }
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
      filePaths: { ...state.filePaths, [active.fileUuid]: active.filePath },
      sessionFileUuids: {
        ...state.sessionFileUuids,
        [activeSessionId]: active.fileUuid,
      },
    })
    const shouldLoadFileChat = !state.loadedFileChats[active.fileUuid]
    void (async () => {
      const workspaceSession = await window.mindlane?.workspace.getSession()
      const latestActive = registry.getActiveFile()
      if (latestActive?.fileUuid !== active.fileUuid || latestActive.filePath !== active.filePath) {
        return
      }
      const workspacePath = workspaceSession?.workspacePath ?? null
      useAiStore.setState({
        workspacePath,
        fileUuidPaths: workspaceSession?.fileUuidPaths ?? {},
      })
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
