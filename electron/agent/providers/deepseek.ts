import { ChatOpenAI } from '@langchain/openai'
import { LLMProvider, ProviderCapability, type ModelOption } from './base.js'

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com'

/**
 * DeepSeek V4（chatDeepSeek 模式）
 *
 * 官方 API 思考模式**默认开启**，且思考模式下绑定工具的后续请求必须完整回传
 * reasoning_content，否则返回 400——langchain 的 ChatOpenAI 只捕获不回传，
 * 主 agent 的工具循环会踩坑。因此这里显式 `thinking: {type: 'disabled'}`，
 * 以非思考模式接入（即旧 `deepseek-chat` 模型名的继承者，该别名已于 2026-07-24
 * 停用）。思考模式接入（Anthropic 端点 + ChatAnthropic 的 thinking 块回传）的
 * 取舍与后续路径见 ADR-0014。
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
    if (!key) throw new Error('未填写 API Key')

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
        // 思考模式默认开启；chatDeepSeek = 显式关闭（见类注释与 ADR-0014）
        modelKwargs: { thinking: { type: 'disabled' } },
      }),
      undefined,
      chatModelId,
    )
  }
}
