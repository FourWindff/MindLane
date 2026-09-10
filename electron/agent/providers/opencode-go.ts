import crypto from 'node:crypto'
import { ChatOpenAI } from '@langchain/openai'
import { LLMProvider, ProviderCapability, type ModelOption } from './base.js'
import { currentSessionId } from '../../shared/runContext.js'

const OPENCODE_GO_BASE_URL = 'https://opencode.ai/zen/go/v1'

/**
 * Conversation id for calls made outside a stream (e.g. Nodes-to-Palace),
 * stable for the whole process so the gateway can still route these.
 */
const FALLBACK_SESSION_ID = crypto.randomUUID()

/** Identify ourselves instead of the generic SDK user agent (opencode.ai/docs/go). */
const USER_AGENT = 'MindLaneAgent/1.0'

/**
 * Stamp the OpenCode Go gateway headers onto an outbound request:
 * `x-opencode-session` (required since the gateway routing update;
 * conversation-scoped when the call runs inside a stream) and our own
 * User-Agent in place of the generic SDK name.
 */
export function withGatewayHeaders(
  init: RequestInit | undefined,
  sessionId: string | undefined,
): RequestInit {
  const headers = new Headers(init?.headers)
  headers.set('x-opencode-session', sessionId ?? FALLBACK_SESSION_ID)
  headers.set('User-Agent', USER_AGENT)
  return { ...init, headers }
}

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
        configuration: {
          baseURL,
          // Inject the gateway headers at request time: the session header
          // must be stable per conversation, so it is resolved from the
          // runner's AsyncLocalStorage context rather than frozen at
          // construction (the model instance is shared across conversations).
          fetch: (url, init) => fetch(url, withGatewayHeaders(init, currentSessionId())),
        },
      }),
      undefined,
      chatModelId,
    )
  }
}
