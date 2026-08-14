import { LLMProvider, ProviderCapability, type ModelOption } from './base.js'
import type { AppSettings, ProviderConfig } from '../../fs/types.js'

export type ProviderMeta = {
  id: string
  displayName: string
  capabilities: ProviderCapability[]
  defaultModels: ModelOption[]
}

/**
 * Provider 类须自声明全部 meta（id/displayName/capabilities/defaultModels），
 * 注册处与实例 getter 共用同一份声明，不再双写目录。
 */
type ProviderConstructor = (new (config: ProviderConfig & { chatModel: string }) => LLMProvider) & {
  id: string
  displayName: string
  capabilities: ProviderCapability[]
  defaultModels: ModelOption[]
}

type ProviderFactory = (config: ProviderConfig & { chatModel: string }) => LLMProvider

const factories = new Map<string, ProviderFactory>()
const metaMap = new Map<string, ProviderMeta>()

function registerProvider(ctor: ProviderConstructor): void {
  const meta: ProviderMeta = {
    id: ctor.id,
    displayName: ctor.displayName,
    capabilities: [...ctor.capabilities],
    defaultModels: ctor.defaultModels,
  }
  factories.set(ctor.id, (config) => new ctor(config))
  metaMap.set(ctor.id, meta)
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
import { DeepSeekProvider } from './deepseek.js'

registerProvider(DashScopeProvider)
registerProvider(KimiCodeProvider)
registerProvider(MiniMaxProvider)
registerProvider(DeepSeekProvider)
