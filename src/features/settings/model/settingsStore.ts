import { create } from 'zustand'
import type { PalaceArtworkStyle } from '@contracts/palaceArtworkStyle'

interface ProviderInfo {
  id: string
  displayName: string
  models: { id: string; displayName: string }[]
  capabilities: string[]
}

/** Capabilities of the active provider: derived from the provider metadata, never stored twice. */
export function selectActiveCapabilities(
  state: Pick<SettingsState, 'providers' | 'activeChatProvider'>,
): string[] {
  return (
    state.providers.find((provider) => provider.id === state.activeChatProvider)?.capabilities ?? []
  )
}

interface SettingsState {
  loaded: boolean
  activeChatProvider: string
  chatModel: string
  palaceArtworkStyle: PalaceArtworkStyle
  autoSaveIntervalMs: number
  providers: ProviderInfo[]
  providerConfigs: Record<string, { apiKey: string; baseUrl?: string }>

  hydrate: (data: Partial<SettingsState>) => void
  setActiveChatProvider: (id: string) => void
  setApiKey: (key: string) => void
  setChatModel: (model: string) => void
  setPalaceArtworkStyle: (style: PalaceArtworkStyle) => void
  setAutoSaveIntervalMs: (ms: number) => void
  setProviders: (providers: ProviderInfo[]) => void
}

function persistToBackend(partial: Record<string, unknown>) {
  window.mindlane?.settings.update(partial).catch(() => {})
}

/**
 * API Key of the active provider: providerConfigs is the only source of secrets; there is no
 * global fallback key anymore.
 */
export function selectActiveApiKey(
  state: Pick<SettingsState, 'activeChatProvider' | 'providerConfigs'>,
): string {
  return state.providerConfigs[state.activeChatProvider]?.apiKey ?? ''
}

/**
 * Chat readiness: settings loaded, API Key filled for the active provider, model selected.
 * The ChatInputBar gate and the palace generation precheck share this one predicate.
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
  providerConfigs: {},

  hydrate: (data) => set({ ...data, loaded: true }),

  setActiveChatProvider: (id) => {
    set({ activeChatProvider: id, chatModel: '' })
    persistToBackend({ activeProviders: { chat: id }, chatModel: '' })
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
  setProviders: (providers) => set({ providers }),
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
