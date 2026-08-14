import { ChatAnthropic } from '@langchain/anthropic'
import { LLMProvider, ProviderCapability, type ModelOption } from './base.js'

const KIMI_CODE_BASE_URL = 'https://api.kimi.com/coding/'

export class KimiCodeProvider extends LLMProvider {
  static readonly id = 'kimi-code'
  static readonly displayName = 'Kimi Code'
  static readonly capabilities: ProviderCapability[] = [ProviderCapability.Chat]
  static readonly defaultModels: ModelOption[] = [
    { id: 'kimi-k2.5', displayName: 'Kimi K2.5', contextWindow: 262_144 },
    { id: 'kimi-k2', displayName: 'Kimi K2', contextWindow: 131_072 },
  ]

  constructor(config: { apiKey: string; chatModel: string; baseUrl?: string }) {
    const key = config.apiKey.trim()
    if (!key) throw new Error('未填写 API Key')

    const baseURL = config.baseUrl?.trim() || KIMI_CODE_BASE_URL
    const chatModelId = config.chatModel.trim()

    super(
      new ChatAnthropic({
        model: chatModelId,
        anthropicApiKey: key,
        temperature: 0.35,
        maxRetries: 1,
        clientOptions: { baseURL },
      }),
      undefined,
      chatModelId,
    )
  }
}
