import { ChatOpenAI } from '@langchain/openai'
import { LLMProvider, ProviderCapability, type ModelOption } from './base.js'

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com'

/**
 * DeepSeek V4 (chatDeepSeek mode)
 *
 * The official API has thinking mode **enabled by default**, and in thinking mode
 * any follow-up request that binds tools must send reasoning_content back in full,
 * otherwise it returns 400 — langchain's ChatOpenAI only captures it and never
 * sends it back, which trips up the main agent's tool loop. So we explicitly set
 * `thinking: {type: 'disabled'}` and connect in non-thinking mode (i.e. the
 * successor of the old `deepseek-chat` model name; that alias was retired on
 * 2026-07-24). See ADR-0014 for the trade-offs of thinking-mode access (Anthropic
 * endpoint + ChatAnthropic's thinking block round-trip) and the follow-up path.
 */
export class DeepSeekProvider extends LLMProvider {
  static readonly id = 'deepseek'
  static readonly displayName = 'DeepSeek (V4)'
  static readonly capabilities: ProviderCapability[] = [ProviderCapability.Chat]
  static readonly defaultModels: ModelOption[] = [
    { id: 'deepseek-v4-flash', displayName: 'DeepSeek V4 Flash', contextWindow: 1_000_000 },
    { id: 'deepseek-v4-pro', displayName: 'DeepSeek V4 Pro', contextWindow: 1_000_000 },
  ]

  constructor(config: { apiKey: string; chatModel: string; baseUrl?: string }) {
    const key = config.apiKey.trim()
    if (!key) throw new Error('API Key is missing')

    const baseURL = config.baseUrl?.trim() || DEEPSEEK_BASE_URL
    const chatModelId = config.chatModel.trim()

    super(
      new ChatOpenAI({
        model: chatModelId,
        apiKey: key,
        temperature: 0.35,
        timeout: 60_000,
        maxRetries: 1,
        configuration: { baseURL },
        // Thinking mode is on by default; chatDeepSeek = explicitly disabled (see the class comment and ADR-0014)
        modelKwargs: { thinking: { type: 'disabled' } },
      }),
      undefined,
      chatModelId,
    )
  }
}
