import { LLMProvider, ProviderCapability, type ModelOption } from './base.js'
import type { AppSettings, ProviderConfig } from '../../fs/types.js'

type ProviderMeta = {
  id: string
  displayName: string
  capabilities: ProviderCapability[]
  defaultModels: ModelOption[]
}

/**
 * Provider classes must declare all of their meta themselves
 * (id/displayName/capabilities/defaultModels); the registration site and the
 * instance getters share that single declaration instead of duplicating the catalog.
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
    throw new Error(`unknown provider: ${providerId}`)
  }
  return new ctor(config)
}

export function getProviderMeta(providerId: string): ProviderMeta | undefined {
  const ctor = providers.get(providerId)
  return ctor ? metaOf(ctor) : undefined
}

/**
 * Single owner of the chat-provider resolution recipe: pick the provider,
 * resolve the apiKey from that provider's own config, and validate the model
 * against the provider's catalog. Pure function — throws on missing key, empty
 * model, or a model outside the catalog; no fallbacks.
 */
export function resolveChatProvider(settings: AppSettings): LLMProvider {
  const providerId = settings.activeProviders.chat || 'dashscope'
  const meta = getProviderMeta(providerId)
  if (!meta) {
    throw new Error(`unknown provider: ${providerId}`)
  }
  const providerConfig = settings.providerConfigs[providerId]
  const apiKey = providerConfig?.apiKey?.trim() ?? ''
  if (!apiKey) {
    throw new Error('API Key is missing')
  }
  const chatModel = settings.chatModel.trim()
  if (!chatModel) {
    throw new Error('Please select a model')
  }
  if (!meta.defaultModels.some((model) => model.id === chatModel)) {
    throw new Error(`model ${chatModel} does not belong to the current provider`)
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
