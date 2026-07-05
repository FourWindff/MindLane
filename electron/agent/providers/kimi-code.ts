import { ChatAnthropic } from '@langchain/anthropic'
import { LLMProvider, ProviderCapability, type ChatModelOption } from './base.js'

const KIMI_CODE_BASE_URL = 'https://api.kimi.com/coding/'

export class KimiCodeProvider extends LLMProvider {
  static readonly defaultChatModels: ChatModelOption[] = [
    { id: 'kimi-k2.5', displayName: 'Kimi K2.5' },
    { id: 'kimi-k2', displayName: 'Kimi K2' },
  ]

  get capabilities(): Set<ProviderCapability> {
    return new Set([ProviderCapability.Chat])
  }

  get chatModels() {
    return KimiCodeProvider.defaultChatModels
  }

  constructor(config: { apiKey: string; chatModel: string; baseUrl?: string }) {
    const key = config.apiKey.trim()
    if (!key) throw new Error('未填写 API Key')

    const baseURL = config.baseUrl?.trim() || KIMI_CODE_BASE_URL

    super(
      new ChatAnthropic({
        model: config.chatModel.trim() || 'kimi-k2.5',
        anthropicApiKey: key,
        temperature: 0.35,
        maxRetries: 1,
        clientOptions: { baseURL },
      }),
    )
  }
}
