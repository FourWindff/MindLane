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
  stopRequested: boolean
  lastUserMessageAt: number
}

export type { ChatStreamEvent }

export interface ChatCapsuleEntry {
  fileUuid: string
  fileName: string
  status: 'generating' | 'stopping' | 'idle'
  /** 该文件最近一次会话的 updatedAt（毫秒），胶囊排序依据；无会话时为 0。 */
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
  /** 会话文件索引（持久映射）：fileUuid -> filePath，跨启动渲染胶囊条用。 */
  fileUuidPaths: Record<string, string>
  /** 当前 workspace 全量会话列表（无 fileUuid 的全量拉取），胶囊条成员与排序依据。 */
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
  /** 改名/移动后同步内存与持久映射（调用方另经桥落盘）。 */
  updateFileUuidPath: (fileUuid: string, filePath: string) => void
  registerStream: (fileUuid: string, sessionId: string, streamId: string) => void
  markStreamStopping: (sessionId: string) => void
  sendChatMessage: (text: string) => Promise<boolean>
  stopChatStream: () => void
  /** 恢复/切换 workspace 与 deleteSession 成功后重拉胶囊条持久输入（全量会话 + 映射）。 */
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
    activeTools: [],
    stopRequested: false,
    lastUserMessageAt: 0,
  }
}

const fileChatLoads = new Map<string, Promise<void>>()

// 读侧 IPC 的有限退避重试：AI 服务未就绪时 listSessions/loadSession 会返回
// not-ready，延迟重试避免启动早期拿到空结果后永久空白。按 key 计数，成功即清零。
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

/** 仅测试用：清空退避重试的模块级状态，避免真实 timer 跨测试泄漏。 */
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
const EMPTY_CHAT_ACTIVE_TOOLS: string[] = []

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
export function selectCurrentChatActiveTools(state: AiState): string[] {
  return currentChat(state)?.activeTools ?? EMPTY_CHAT_ACTIVE_TOOLS
}

function pathBasename(filePath: string | null | undefined): string | null {
  const name = filePath?.split(/[\\/]/).pop()
  return name ? name : null
}

/**
 * 展示剥离：会话加载到 UI 时去掉用户消息末尾的 `<EDITOR_STATE>` 块，
 * 让重载后的聊天历史干净可读。旧消息无块时原样返回（no-op）。
 */
function stripTurnStateFromMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) => {
    if (message.role !== 'user') return message
    const content = stripTurnState(message.content)
    return content === message.content ? message : { ...message, content }
  })
}

/**
 * 胶囊条读时投影：成员 = 有会话记录（且映射中有路径）∪ 流进行中 ∪ 当前文件；
 * 排序 = 当前文件置顶，其余按该文件最近一次会话的 updatedAt 降序。
 * 内存 `fileChats` 仅投影状态（busy/stopping/generating），不再单独决定成员。
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
    // 有会话但映射中无路径（文件已删/升级前从未打开过）的文件不显示。
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
        activeTools: [],
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
    // 删除会话可能让文件失去全部会话：重拉全量会话刷新胶囊条。
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
        // 主进程 AI 服务可能尚未装配完成：先落映射，稍后重试拉会话，
        // 不把已就绪的数据清空（allSessions 保持旧值）。
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

  /** 持久映射 + 内存路径同步更新（改名/移动后由 workspace store 经桥调用）。 */
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
      return patchFileChat(state, fileUuid, { stopRequested: true })
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
  // 查询失败时直接放弃：此时无法区分"会话不存在"与"查询出错"，
  // 继续往下走会生成幻影 id 并覆写 state.json 中仍然有效的映射。
  // AI 未就绪（not-ready）属于"查询出错"：延迟重试，避免打开文件后历史永久空白。
  if (!sessionsResult?.ok) {
    scheduleRetry(`${workspacePath}\0${fileUuid}`, () => {
      // 已切换 workspace 的旧请求作废，避免把新 workspace 的数据拉错。
      if (useAiStore.getState().workspacePath !== workspacePath) return
      void useAiStore.getState().loadFileChat(fileUuid)
    })
    return
  }
  retryCounts.delete(`${workspacePath}\0${fileUuid}`)
  const sessions = sessionsResult.data.sessions
  const restoredSessionId = workspaceSession?.activeSessionIds?.[fileUuid]
  // state.json 可能指向从未写入消息的幻影会话（如新建对话后未发言就退出），
  // 此时回退到最近的现有会话，而不是再生成一个新幻影。
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
      const name = event.payload.name
      return name ? { ...chat, activeTools: [...chat.activeTools, name] } : chat
    }
    case 'tool-end': {
      const name = event.payload.name
      return { ...chat, activeTools: chat.activeTools.filter((tool) => tool !== name) }
    }
    case 'step':
      return { ...chat, step: event.payload.step }
    case 'end': {
      const response = event.payload
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
      const { previous } = splitCurrentTurn(chat.chatMessages)
      return {
        ...chat,
        chatMessages: [...previous, ...messages],
        busy: false,
        stopRequested: false,
        step: 'idle',
        streamText: '',
        activeTools: [],
      }
    }
    case 'error':
      return {
        ...chat,
        busy: false,
        stopRequested: false,
        step: 'idle',
        streamText: '',
        activeTools: [],
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
  // 流结束/出错时主进程已完成（或放弃）会话持久化：重拉全量会话，
  // 让本启动内新建的对话立即出现在胶囊条，而不是等下次启动才补全。
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
