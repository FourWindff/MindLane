import { ChatOpenAI } from '@langchain/openai'
import { LLMProvider, ProviderCapability, type ModelOption } from './base.js'

const OPENCODE_GO_BASE_URL = 'https://opencode.ai/zen/go/v1'

/**
 * OpenCode Go — low-cost subscription gateway for open coding models
 * (https://opencode.ai/go). API key from opencode.ai/auth works with any
 * agent. Uses the OpenAI-compatible endpoint at opencode.ai/docs/go.
 *
 * baseURL is the API root (https://opencode.ai/zen/go/v1); ChatOpenAI appends
 * `/chat/completions`, so the full endpoint must NOT be included here.
 *
 * Models served through the other Go endpoints are not listed here: Qwen 3.x
 * and MiniMax M2.5+ (/v1/messages, Anthropic-compatible) and Grok 4.5 /
 * GPT 5.6 Luna (/v1/responses). Add a second provider class if needed.
 */
export class OpenCodeGoProvider extends LLMProvider {
  static readonly id = 'opencode-go'
  static readonly displayName = 'OpenCode Go'
  static readonly capabilities: ProviderCapability[] = [ProviderCapability.Chat]
  static readonly defaultModels: ModelOption[] = [
    { id: 'glm-5.3', displayName: 'GLM-5.3', contextWindow: 1_000_000 },
    { id: 'glm-5.2', displayName: 'GLM-5.2', contextWindow: 1_000_000 },
    { id: 'glm-5.1', displayName: 'GLM-5.1', contextWindow: 1_000_000 },
    { id: 'kimi-k3', displayName: 'Kimi K3', contextWindow: 1_000_000 },
    { id: 'kimi-k2.7-code', displayName: 'Kimi K2.7 Code', contextWindow: 262_144 },
    { id: 'kimi-k2.6', displayName: 'Kimi K2.6', contextWindow: 262_144 },
    { id: 'deepseek-v4-pro', displayName: 'DeepSeek V4 Pro', contextWindow: 1_000_000 },
    { id: 'deepseek-v4-flash', displayName: 'DeepSeek V4 Flash', contextWindow: 1_000_000 },
    { id: 'mimo-v2.5', displayName: 'MiMo-V2.5', contextWindow: 131_072 },
    { id: 'mimo-v2.5-pro', displayName: 'MiMo-V2.5-Pro', contextWindow: 131_072 },
    { id: 'hy3', displayName: 'Hunyuan 3', contextWindow: 131_072 },
  ]

  constructor(config: { apiKey: string; chatModel: string; baseUrl?: string }) {
    const key = config.apiKey.trim()
    if (!key) throw new Error('API key is required')

    const baseURL = config.baseUrl?.trim() || OPENCODE_GO_BASE_URL
    const chatModelId = config.chatModel.trim()

    super(
      new ChatOpenAI({
        model: chatModelId,
        apiKey: key,
        temperature: 0.35,
        timeout: 60_000,
        maxRetries: 1,
        configuration: { baseURL },
      }),
      undefined,
      chatModelId,
    )
  }
}
