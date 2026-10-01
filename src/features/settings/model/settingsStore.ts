import { create } from 'zustand'
import type { PalaceArtworkStyle } from '@contracts/palaceArtworkStyle'

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
  chatModel: string
  palaceArtworkStyle: PalaceArtworkStyle
  autoSaveIntervalMs: number
  providers: ProviderInfo[]
  capabilities: string[]
  providerConfigs: Record<string, { apiKey: string; baseUrl?: string }>

  hydrate: (data: Partial<SettingsState>) => void
  setActiveChatProvider: (id: string) => void
  setApiKey: (key: string) => void
  setChatModel: (model: string) => void
  setPalaceArtworkStyle: (style: PalaceArtworkStyle) => void
  setAutoSaveIntervalMs: (ms: number) => void
  setProviders: (providers: ProviderInfo[]) => void
  setCapabilities: (capabilities: string[]) => void
}

function persistToBackend(partial: Record<string, unknown>) {
  window.mindlane?.settings.update(partial).catch(() => {})
}

/**
 * 当前 provider 的 API Key：providerConfigs 是密钥唯一来源，不再有全局兜底 key。
 */
export function selectActiveApiKey(
  state: Pick<SettingsState, 'activeChatProvider' | 'providerConfigs'>,
): string {
  return state.providerConfigs[state.activeChatProvider]?.apiKey ?? ''
}

/**
 * 对话就绪判定：settings 已加载、当前 provider 已填 API Key、已选模型。
 * ChatInputBar 门控与 palace 生成预检共用这一份判定。
 */
export function selectChatReady(
  state: Pick<SettingsState, 'loaded' | 'activeChatProvider' | 'providerConfigs' | 'chatModel'>,
): boolean {
  return state.loaded && selectActiveApiKey(state).trim() !== '' && state.chatModel.trim() !== ''
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  loaded: false,
  activeChatProvider: 'dashscope',
  chatModel: '',
  palaceArtworkStyle: 'vector',
  autoSaveIntervalMs: 30_000,
  providers: [],
  capabilities: [],
  providerConfigs: {},

  hydrate: (data) => set({ ...data, loaded: true }),

  setActiveChatProvider: (id) => {
    const state = get()
    const provider = state.providers.find((p) => p.id === id)
    set({
      activeChatProvider: id,
      chatModel: '',
      capabilities: provider?.capabilities ?? [],
    })
    persistToBackend({ activeProviders: { chat: id }, chatModel: '' })
    loadCapabilities()
  },
  setApiKey: (key) => {
    const providerId = get().activeChatProvider
    set((state) => ({
      providerConfigs: {
        ...state.providerConfigs,
        [providerId]: { ...state.providerConfigs[providerId], apiKey: key },
      },
    }))
    persistToBackend({
      providerConfigs: { [providerId]: { apiKey: key } },
    })
  },
  setChatModel: (model) => {
    set({ chatModel: model })
    persistToBackend({ chatModel: model })
  },
  setPalaceArtworkStyle: (style) => {
    set({ palaceArtworkStyle: style })
    persistToBackend({ palaceArtworkStyle: style })
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
}))

export async function loadSettingsFromBackend(): Promise<void> {
  const settings = await window.mindlane?.settings.load()
  if (!settings) return

  const s = settings as {
    chatModel?: string
    palaceArtworkStyle?: PalaceArtworkStyle
    activeProviders?: { chat?: string }
    providerConfigs?: Record<string, { apiKey: string; baseUrl?: string }>
    editor?: { autoSaveIntervalMs?: number }
  }

  const providerId = s.activeProviders?.chat ?? 'dashscope'
  const configs = s.providerConfigs ?? {}

  useSettingsStore.getState().hydrate({
    chatModel: s.chatModel ?? '',
    palaceArtworkStyle: s.palaceArtworkStyle ?? 'vector',
    autoSaveIntervalMs: s.editor?.autoSaveIntervalMs ?? 30_000,
    activeChatProvider: providerId,
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
        result.providers.map(
          (p: {
            id: string
            displayName: string
            capabilities: string[]
            models: { id: string; displayName: string }[]
          }) => ({
            id: p.id,
            displayName: p.displayName,
            models: p.models,
            capabilities: p.capabilities,
          }),
        ),
      )
    }
  } catch {
    // Keep the local provider metadata initialized in the store.
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
