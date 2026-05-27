import { create } from 'zustand'

function generateThreadId(): string {
  return `thread_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
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

import type { ChatToolCall, DocumentRef } from '@/shared/lib/fileFormat'

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  toolCalls?: ChatToolCall[]
  /** Optional attachment reference for this message */
  attachment?: { name: string; type: 'pdf' | 'url' | 'text' }
}

export interface ChatSession {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
}

interface AiState {
  busy: boolean
  step: AiPipelineStep
  streamText: string
  errorMessage: string | null

  threadId: string
  chatMessages: ChatMessage[]
  workspacePath: string | null

  // Sessions
  sessions: ChatSession[]
  showSessionList: boolean

  // Float panel
  isMinimized: boolean

  // Attachment
  attachedDocument: DocumentRef | null
  setAttachedDocument: (doc: DocumentRef | null) => void

  setBusy: (busy: boolean) => void
  setStep: (step: AiPipelineStep) => void
  appendStreamText: (text: string) => void
  resetStream: () => void
  setError: (msg: string) => void
  clearError: () => void
  reset: () => void

  setThreadId: (id: string) => void
  addChatMessage: (msg: ChatMessage) => void
  setChatMessages: (msgs: ChatMessage[]) => void
  startNewChat: () => void

  // Session management
  setSessions: (sessions: ChatSession[]) => void
  setShowSessionList: (show: boolean) => void
  loadSession: (sessionId: string) => Promise<void>
  deleteSession: (sessionId: string) => Promise<void>

  // Float panel
  setIsMinimized: (val: boolean) => void
}

export const useAiStore = create<AiState>((set, get) => ({
  busy: false,
  step: 'idle',
  streamText: '',
  errorMessage: null,
  threadId: '',
  chatMessages: [],
  workspacePath: null,
  sessions: [],
  showSessionList: false,
  isMinimized: false,
  attachedDocument: null,

  setBusy: (busy) => set({ busy }),
  setStep: (step) => set({ step }),
  appendStreamText: (text) => set((s) => ({ streamText: s.streamText + text })),
  resetStream: () => set({ streamText: '' }),
  setError: (msg) => set({ errorMessage: msg, busy: false, step: 'idle' }),
  clearError: () => set({ errorMessage: null }),
  reset: () => set({ busy: false, step: 'idle', streamText: '', errorMessage: null }),

  setThreadId: (id) => set({ threadId: id }),
  addChatMessage: (msg) => set((s) => ({ chatMessages: [...s.chatMessages, msg] })),
  setChatMessages: (msgs) => set({ chatMessages: msgs }),
  startNewChat: () => set({
    threadId: generateThreadId(),
    chatMessages: [],
    busy: false,
    step: 'idle',
    streamText: '',
    errorMessage: null,
    showSessionList: false,
    attachedDocument: null,
  }),

  setSessions: (sessions) => set({ sessions }),
  setShowSessionList: (show) => set({ showSessionList: show }),
  setIsMinimized: (val) => set({ isMinimized: val }),
  setAttachedDocument: (doc) => set({ attachedDocument: doc }),

  loadSession: async (sessionId: string) => {
    const state = get()
    if (!state.workspacePath) return

    const result = await window.mindlane?.chat?.loadSession({
      workspacePath: state.workspacePath,
      sessionId,
    })

    if (result?.ok) {
      set({
        threadId: result.data.sessionId,
        chatMessages: result.data.messages as ChatMessage[],
        showSessionList: false,
        busy: false,
        step: 'idle',
        streamText: '',
        errorMessage: null,
        attachedDocument: null,
      })
    }
  },

  deleteSession: async (sessionId: string) => {
    const state = get()
    if (!state.workspacePath) return

    const result = await window.mindlane?.chat?.deleteSession({
      workspacePath: state.workspacePath,
      sessionId,
    })

    if (result?.ok) {
      // Refresh session list (default page 1, 20 items)
      const listResult = await window.mindlane?.chat?.listSessions({
        workspacePath: state.workspacePath,
        limit: 20,
        offset: 0,
      })
      if (listResult?.ok) {
        set({ sessions: listResult.data.sessions })
      }
      // If deleted the current session, start a new chat
      if (state.threadId === sessionId) {
        get().startNewChat()
      }
    }
  },
}))

export async function saveChatHistory(): Promise<void> {
  const state = useAiStore.getState()
  if (!state.workspacePath) return

  const api = window.mindlane?.chat
  if (!api) return

  // Use new saveSession API for multi-session support
  if ('saveSession' in api && api.saveSession) {
    await api.saveSession({
      workspacePath: state.workspacePath,
      sessionId: state.threadId || generateThreadId(),
      messages: state.chatMessages,
    })
    // Refresh sessions list after saving
    if ('listSessions' in api && api.listSessions) {
      const sessionsResult = await api.listSessions({ workspacePath: state.workspacePath, limit: 20, offset: 0 })
      if (sessionsResult?.ok && sessionsResult.data) {
        useAiStore.setState({ sessions: sessionsResult.data.sessions })
      }
    }
  } else {
    // Fallback to legacy API
    await api.saveHistory({
      workspacePath: state.workspacePath,
      messages: state.chatMessages,
    })
  }
}

export async function loadWorkspaceChat(workspacePath: string): Promise<void> {
  const api = window.mindlane?.chat
  if (!api) return

  // Load session list first
  if ('listSessions' in api && api.listSessions) {
    const sessionsResult = await api.listSessions({ workspacePath, limit: 20, offset: 0 })
    if (sessionsResult?.ok && sessionsResult.data) {
      useAiStore.setState({ sessions: sessionsResult.data.sessions })
    }
  }

  // Then load the most recent session
  const result = await api.loadHistory({ workspacePath })
  if (result.ok) {
    useAiStore.setState({
      threadId: result.data.threadId,
      chatMessages: result.data.messages as ChatMessage[],
      workspacePath,
    })
  }
}
