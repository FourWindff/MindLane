import { create } from 'zustand'

interface ProviderInfo {
  id: string
  displayName: string
  models: { id: string; displayName: string }[]
}

interface SettingsState {
  loaded: boolean
  activeChatProvider: string
  activeImageProvider: string
  apiKey: string
  chatModel: string
  autoSaveIntervalMs: number
  providers: ProviderInfo[]

  hydrate: (data: Partial<SettingsState>) => void
  setActiveChatProvider: (id: string) => void
  setActiveImageProvider: (id: string) => void
  setApiKey: (key: string) => void
  setChatModel: (model: string) => void
  setAutoSaveIntervalMs: (ms: number) => void
  setProviders: (providers: ProviderInfo[]) => void
}

function persistToBackend(partial: Record<string, unknown>) {
  window.mindlane?.settings.update(partial).catch(() => {})
}

export const useSettingsStore = create<SettingsState>((set) => ({
  loaded: false,
  activeChatProvider: 'dashscope',
  activeImageProvider: 'dashscope',
  apiKey: '',
  chatModel: 'qwen-turbo',
  autoSaveIntervalMs: 30_000,
  providers: [
    {
      id: 'dashscope',
      displayName: '通义千问 (百炼)',
      models: [
        { id: 'qwen-turbo', displayName: 'qwen-turbo' },
        { id: 'qwen-plus', displayName: 'qwen-plus' },
        { id: 'qwen-max', displayName: 'qwen-max' },
        { id: 'qwen-long', displayName: 'qwen-long' },
      ],
    },
  ],

  hydrate: (data) => set({ ...data, loaded: true }),

  setActiveChatProvider: (id) => {
    set({ activeChatProvider: id })
    persistToBackend({ activeProviders: { chat: id } })
  },
  setActiveImageProvider: (id) => {
    set({ activeImageProvider: id })
    persistToBackend({ activeProviders: { image: id } })
  },
  setApiKey: (key) => {
    set({ apiKey: key })
    persistToBackend({ apiKey: key })
  },
  setChatModel: (model) => {
    set({ chatModel: model })
    persistToBackend({ chatModel: model })
  },
  setAutoSaveIntervalMs: (ms) => {
    set({ autoSaveIntervalMs: ms })
    persistToBackend({ editor: { autoSaveIntervalMs: ms } })
  },
  setProviders: (providers) => set({ providers }),
}))

export async function loadSettingsFromBackend(): Promise<void> {
  const settings = await window.mindlane?.settings.load()
  if (!settings) return

  const s = settings as {
    apiKey?: string
    chatModel?: string
    activeProviders?: { chat?: string; image?: string }
    editor?: { autoSaveIntervalMs?: number }
  }

  useSettingsStore.getState().hydrate({
    apiKey: s.apiKey ?? '',
    chatModel: s.chatModel ?? 'qwen-turbo',
    autoSaveIntervalMs: s.editor?.autoSaveIntervalMs ?? 30_000,
    activeChatProvider: s.activeProviders?.chat ?? 'dashscope',
    activeImageProvider: s.activeProviders?.image ?? 'dashscope',
  })
}
