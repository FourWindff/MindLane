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

interface AiState {
  busy: boolean
  step: AiPipelineStep
  progress: number
  streamText: string
  errorMessage: string | null

  setBusy: (busy: boolean) => void
  setStep: (step: AiPipelineStep) => void
  setProgress: (progress: number) => void
  appendStreamText: (text: string) => void
  resetStream: () => void
  setError: (msg: string) => void
  clearError: () => void
  reset: () => void
}

export const useAiStore = create<AiState>((set) => ({
  busy: false,
  step: 'idle',
  progress: 0,
  streamText: '',
  errorMessage: null,

  setBusy: (busy) => set({ busy }),
  setStep: (step) => set({ step }),
  setProgress: (progress) => set({ progress }),
  appendStreamText: (text) => set((s) => ({ streamText: s.streamText + text })),
  resetStream: () => set({ streamText: '' }),
  setError: (msg) => set({ errorMessage: msg, busy: false, step: 'idle' }),
  clearError: () => set({ errorMessage: null }),
  reset: () => set({ busy: false, step: 'idle', progress: 0, streamText: '', errorMessage: null }),
}))
