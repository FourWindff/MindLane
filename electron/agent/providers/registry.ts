import { LLMProvider, ProviderCapability, type ModelOption } from './base.js'
import type { AppSettings, ProviderConfig } from '../../fs/types.js'

type ProviderMeta = {
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

const providers = new Map<string, ProviderConstructor>()

function metaOf(ctor: ProviderConstructor): ProviderMeta {
  return {
    id: ctor.id,
    displayName: ctor.displayName,
    capabilities: [...ctor.capabilities],
    defaultModels: ctor.defaultModels,
  }
}

function registerProvider(ctor: ProviderConstructor): void {
  providers.set(ctor.id, ctor)
}

export function createProvider(
  providerId: string,
  config: ProviderConfig & { chatModel: string },
): LLMProvider {
  const ctor = providers.get(providerId)
  if (!ctor) {
    throw new Error(`未知的 provider: ${providerId}`)
  }
  return new ctor(config)
}

export function getProviderMeta(providerId: string): ProviderMeta | undefined {
  const ctor = providers.get(providerId)
  return ctor ? metaOf(ctor) : undefined
}

/**
 * Single owner of the chat-provider resolution recipe: pick the provider,
 * resolve the apiKey (per-provider config overrides the global key), and
 * validate the model against the provider's catalog. Pure function — throws
 * on missing key, empty model, or a model outside the catalog; no fallbacks.
 */
export function resolveChatProvider(settings: AppSettings): LLMProvider {
  const providerId = settings.activeProviders.chat || 'dashscope'
  const meta = getProviderMeta(providerId)
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
  return Array.from(providers.values(), metaOf)
}

// --- Built-in provider registrations ---

import { DashScopeProvider } from './dashscope.js'
import { KimiCodeProvider } from './kimi-code.js'
import { MiniMaxProvider } from './minimax.js'
import { DeepSeekProvider } from './deepseek.js'
import { OpenCodeGoProvider } from './opencode-go.js'

registerProvider(DashScopeProvider)
registerProvider(KimiCodeProvider)
registerProvider(MiniMaxProvider)
registerProvider(DeepSeekProvider)
registerProvider(OpenCodeGoProvider)
