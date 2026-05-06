import { create } from 'zustand'

interface ProviderInfo {
  id: string
  displayName: string
  models: { id: string; displayName: string }[]
  capabilities: string[]
}

function capabilitiesForProvider(providers: ProviderInfo[], providerId: string): string[] {
  return providers.find((provider) => provider.id === providerId)?.capabilities ?? []
}

interface SettingsState {
  loaded: boolean
  activeChatProvider: string
  activeImageProvider: string
  apiKey: string
  chatModel: string
  autoSaveIntervalMs: number
  providers: ProviderInfo[]
  capabilities: string[]
  providerConfigs: Record<string, { apiKey: string; baseUrl?: string }>

  hydrate: (data: Partial<SettingsState>) => void
  setActiveChatProvider: (id: string) => void
  setActiveImageProvider: (id: string) => void
  setApiKey: (key: string) => void
  setChatModel: (model: string) => void
  setAutoSaveIntervalMs: (ms: number) => void
  setProviders: (providers: ProviderInfo[]) => void
  setCapabilities: (capabilities: string[]) => void
  setProviderApiKey: (providerId: string, apiKey: string) => void
  setProviderBaseUrl: (providerId: string, baseUrl: string) => void
}

function persistToBackend(partial: Record<string, unknown>) {
  window.mindlane?.settings.update(partial).catch(() => {})
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  loaded: false,
  activeChatProvider: 'dashscope',
  activeImageProvider: 'dashscope',
  apiKey: '',
  chatModel: 'qwen-turbo',
  autoSaveIntervalMs: 30_000,
  providers: [],
  capabilities: [],
  providerConfigs: {},

  hydrate: (data) => set({ ...data, loaded: true }),

  setActiveChatProvider: (id) => {
    const state = get()
    const provider = state.providers.find((p) => p.id === id)
    const defaultModel = provider?.models[0]?.id ?? ''
    const providerKey = state.providerConfigs[id]?.apiKey ?? ''
    set({
      activeChatProvider: id,
      chatModel: defaultModel,
      apiKey: providerKey,
      capabilities: provider?.capabilities ?? [],
    })
    persistToBackend({ activeProviders: { chat: id }, chatModel: defaultModel })
    loadCapabilities()
  },
  setActiveImageProvider: (id) => {
    set({ activeImageProvider: id })
    persistToBackend({ activeProviders: { image: id } })
  },
  setApiKey: (key) => {
    const providerId = get().activeChatProvider
    set((state) => ({
      apiKey: key,
      providerConfigs: {
        ...state.providerConfigs,
        [providerId]: { ...state.providerConfigs[providerId], apiKey: key },
      },
    }))
    persistToBackend({
      apiKey: key,
      providerConfigs: { [providerId]: { apiKey: key } },
    })
  },
  setChatModel: (model) => {
    set({ chatModel: model })
    persistToBackend({ chatModel: model })
  },
  setAutoSaveIntervalMs: (ms) => {
    set({ autoSaveIntervalMs: ms })
    persistToBackend({ editor: { autoSaveIntervalMs: ms } })
  },
  setProviders: (providers) =>
    set((state) => ({
      providers,
      capabilities:
        state.capabilities.length > 0
          ? state.capabilities
          : capabilitiesForProvider(providers, state.activeChatProvider),
    })),
  setCapabilities: (capabilities) => set({ capabilities }),
  setProviderApiKey: (providerId, apiKey) => {
    set((state) => ({
      providerConfigs: {
        ...state.providerConfigs,
        [providerId]: { ...state.providerConfigs[providerId], apiKey },
      },
    }))
    persistToBackend({ providerConfigs: { [providerId]: { apiKey } } })
  },
  setProviderBaseUrl: (providerId, baseUrl) => {
    set((state) => ({
      providerConfigs: {
        ...state.providerConfigs,
        [providerId]: { ...state.providerConfigs[providerId], apiKey: state.providerConfigs[providerId]?.apiKey ?? '', baseUrl },
      },
    }))
    persistToBackend({ providerConfigs: { [providerId]: { baseUrl } } })
  },
}))

export async function loadSettingsFromBackend(): Promise<void> {
  const settings = await window.mindlane?.settings.load()
  if (!settings) return

  const s = settings as {
    apiKey?: string
    chatModel?: string
    activeProviders?: { chat?: string; image?: string }
    providerConfigs?: Record<string, { apiKey: string; baseUrl?: string }>
    editor?: { autoSaveIntervalMs?: number }
  }

  const providerId = s.activeProviders?.chat ?? 'dashscope'
  const configs = s.providerConfigs ?? {}
  // 显示当前 provider 的 key，若无则回退到全局 apiKey
  const displayKey = configs[providerId]?.apiKey || s.apiKey || ''

  useSettingsStore.getState().hydrate({
    apiKey: displayKey,
    chatModel: s.chatModel ?? 'qwen-turbo',
    autoSaveIntervalMs: s.editor?.autoSaveIntervalMs ?? 30_000,
    activeChatProvider: providerId,
    activeImageProvider: s.activeProviders?.image ?? 'dashscope',
    providerConfigs: configs,
  })

  // Load providers from backend
  await loadProviders()
  // Load capabilities for current provider
  await loadCapabilities()
}

async function loadProviders(): Promise<void> {
  try {
    const result = await window.mindlane?.ai.getProviders?.()
    if (result?.ok && result.providers) {
      useSettingsStore.getState().setProviders(
        result.providers.map((p: { id: string; displayName: string; capabilities: string[]; models: { id: string; displayName: string }[] }) => ({
          id: p.id,
          displayName: p.displayName,
          models: p.models,
          capabilities: p.capabilities,
        })),
      )
    }
  } catch {
    // fallback: use existing providers
  }
}

async function loadCapabilities(): Promise<void> {
  try {
    const result = await window.mindlane?.ai.getCapabilities?.()
    if (result?.ok && result.capabilities) {
      useSettingsStore.getState().setCapabilities(result.capabilities)
      return
    }
  } catch {
    // ignore and fall back to local metadata
  }

  const state = useSettingsStore.getState()
  state.setCapabilities(capabilitiesForProvider(state.providers, state.activeChatProvider))
}
