import { LLMProvider, ProviderCapability, type ChatModelOption } from './base.js'
import type { ProviderConfig } from '../../fs/types.js'

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
    capabilities: [
      ProviderCapability.Chat,
      ProviderCapability.Vision,
      ProviderCapability.ImageGen,
      ProviderCapability.Embeddings,
    ],
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
