import { LLMProvider, ProviderCapability, type ChatModelOption } from './base.js'
import type { AppSettings, ProviderConfig } from '../../fs/types.js'

type ProviderFactory = (config: ProviderConfig & { chatModel: string }) => LLMProvider

type ProviderMeta = {
  id: string
  displayName: string
  capabilities: ProviderCapability[]
  defaultModels: ChatModelOption[]
}

const factories = new Map<string, ProviderFactory>()
const metaMap = new Map<string, ProviderMeta>()

function registerProvider(meta: ProviderMeta, factory: ProviderFactory): void {
  factories.set(meta.id, factory)
  metaMap.set(meta.id, meta)
}

export function createProvider(
  providerId: string,
  config: ProviderConfig & { chatModel: string },
): LLMProvider {
  const factory = factories.get(providerId)
  if (!factory) {
    throw new Error(`未知的 provider: ${providerId}`)
  }
  return factory(config)
}

export function getProviderMeta(providerId: string): ProviderMeta | undefined {
  return metaMap.get(providerId)
}

/**
 * Single owner of the chat-provider resolution recipe: pick the provider,
 * resolve the apiKey (per-provider config overrides the global key), and
 * validate the model against the provider's catalog. Pure function — throws
 * on missing key, empty model, or a model outside the catalog; no fallbacks.
 */
export function resolveChatProvider(settings: AppSettings): LLMProvider {
  const providerId = settings.activeProviders.chat || 'dashscope'
  const meta = metaMap.get(providerId)
  if (!meta) {
    throw new Error(`未知的 provider: ${providerId}`)
  }
  const providerConfig = settings.providerConfigs[providerId]
  const apiKey = providerConfig?.apiKey?.trim() || settings.apiKey.trim()
  if (!apiKey) {
    throw new Error('未填写 API Key')
  }
  const chatModel = settings.chatModel.trim()
  if (!chatModel) {
    throw new Error('请选择模型')
  }
  if (!meta.defaultModels.some((model) => model.id === chatModel)) {
    throw new Error(`模型 ${chatModel} 不属于当前 provider`)
  }
  return createProvider(providerId, { apiKey, chatModel, baseUrl: providerConfig?.baseUrl })
}

export function getRegisteredProviders(): ProviderMeta[] {
  return Array.from(metaMap.values())
}

// --- Built-in provider registrations ---

import { DashScopeProvider } from './dashscope.js'
import { KimiCodeProvider } from './kimi-code.js'
import { MiniMaxProvider } from './minimax.js'

registerProvider(
  {
    id: 'dashscope',
    displayName: '通义千问 (百炼)',
    capabilities: [ProviderCapability.Chat, ProviderCapability.Vision, ProviderCapability.ImageGen],
    defaultModels: DashScopeProvider.defaultChatModels,
  },
  (config) =>
    new DashScopeProvider({
      apiKey: config.apiKey,
      chatModel: config.chatModel,
      baseUrl: config.baseUrl,
    }),
)

registerProvider(
  {
    id: 'kimi-code',
    displayName: 'Kimi Code',
    capabilities: [ProviderCapability.Chat],
    defaultModels: KimiCodeProvider.defaultChatModels,
  },
  (config) =>
    new KimiCodeProvider({
      apiKey: config.apiKey,
      chatModel: config.chatModel,
      baseUrl: config.baseUrl,
    }),
)

registerProvider(
  {
    id: 'minimax',
    displayName: 'MiniMax',
    capabilities: [ProviderCapability.Chat, ProviderCapability.ImageGen],
    defaultModels: MiniMaxProvider.defaultChatModels,
  },
  (config) =>
    new MiniMaxProvider({
      apiKey: config.apiKey,
      chatModel: config.chatModel,
      baseUrl: config.baseUrl,
    }),
)
