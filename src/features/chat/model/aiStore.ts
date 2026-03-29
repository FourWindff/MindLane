import { create } from 'zustand'

export type AiPipelineStep =
  | 'idle'
  | 'analyzing'
  | 'planning'
  | 'generating-image'
  | 'building'
  | 'reading-doc'
  | 'extracting'
  | 'generating-map'
  | 'chatting'

interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  toolCalls?: Array<{
    name: string
    args: Record<string, unknown>
    result: string
  }>
}

interface AiState {
  busy: boolean
  step: AiPipelineStep
  progress: number
  streamText: string
  errorMessage: string | null

  threadId: string
  chatMessages: ChatMessage[]
  workspacePath: string | null

  setBusy: (busy: boolean) => void
  setStep: (step: AiPipelineStep) => void
  setProgress: (progress: number) => void
  appendStreamText: (text: string) => void
  resetStream: () => void
  setError: (msg: string) => void
  clearError: () => void
  reset: () => void

  setThreadId: (id: string) => void
  addChatMessage: (msg: ChatMessage) => void
  setChatMessages: (msgs: ChatMessage[]) => void
}

export const useAiStore = create<AiState>((set) => ({
  busy: false,
  step: 'idle',
  progress: 0,
  streamText: '',
  errorMessage: null,
  threadId: '',
  chatMessages: [],
  workspacePath: null,

  setBusy: (busy) => set({ busy }),
  setStep: (step) => set({ step }),
  setProgress: (progress) => set({ progress }),
  appendStreamText: (text) => set((s) => ({ streamText: s.streamText + text })),
  resetStream: () => set({ streamText: '' }),
  setError: (msg) => set({ errorMessage: msg, busy: false, step: 'idle' }),
  clearError: () => set({ errorMessage: null }),
  reset: () => set({ busy: false, step: 'idle', progress: 0, streamText: '', errorMessage: null }),

  setThreadId: (id) => set({ threadId: id }),
  addChatMessage: (msg) => set((s) => ({ chatMessages: [...s.chatMessages, msg] })),
  setChatMessages: (msgs) => set({ chatMessages: msgs }),
}))

export async function loadWorkspaceChat(workspacePath: string): Promise<void> {
  const api = window.mindlane?.chat
  if (!api) return

  const result = await api.loadHistory({ workspacePath })
  if (result.ok) {
    useAiStore.setState({
      threadId: result.data.threadId,
      chatMessages: result.data.messages as ChatMessage[],
      workspacePath,
    })
  }
}

export async function saveChatHistory(): Promise<void> {
  const state = useAiStore.getState()
  if (!state.workspacePath || state.chatMessages.length === 0) return

  const api = window.mindlane?.chat
  if (!api) return

  await api.saveHistory({
    workspacePath: state.workspacePath,
    messages: state.chatMessages,
  })
}
