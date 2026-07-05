import { ChatAnthropic } from '@langchain/anthropic'
import { LLMProvider, ProviderCapability, type ChatModelOption } from './base.js'
import { withRetry, withTimeout } from './middleware/index.js'

const HTTP_TIMEOUT_MS = 30_000

const MINIMAX_ANTHROPIC_BASE_URL = 'https://api.minimaxi.com/anthropic'
const MINIMAX_IMAGE_URL = 'https://api.minimaxi.com/v1/image_generation'
const DEFAULT_CHAT_MODEL = 'MiniMax-M2.7'
const DEFAULT_IMAGE_MODEL = 'image-01'

const SUPPORTED_ASPECT_RATIOS = ['1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16'] as const

type MiniMaxImageResponse = {
  base_resp?: {
    status_code?: number
    status_msg?: string
  }
  data?: {
    image_urls?: Array<string | { url?: string }>
  }
  message?: string
  error?: {
    message?: string
  }
}

function errMsg(body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const payload = body as MiniMaxImageResponse
    const statusCode = payload.base_resp?.status_code
    if (typeof statusCode === 'number' && statusCode !== 0) {
      return payload.base_resp?.status_msg || fallback
    }
    if (typeof payload.message === 'string' && payload.message) return payload.message
    if (typeof payload.error?.message === 'string' && payload.error.message)
      return payload.error.message
  }
  return fallback
}

function mapSizeToAspectRatio(size?: string): string {
  const trimmed = size?.trim()
  if (!trimmed) return '1:1'

  const matched = trimmed.match(/(\d+)\D+(\d+)/)
  if (!matched) return '1:1'

  const width = Number(matched[1])
  const height = Number(matched[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return '1:1'
  }

  const ratio = width / height
  let best = '1:1'
  let minDelta = Number.POSITIVE_INFINITY

  for (const candidate of SUPPORTED_ASPECT_RATIOS) {
    const [w, h] = candidate.split(':').map(Number)
    const delta = Math.abs(ratio - w / h)
    if (delta < minDelta) {
      minDelta = delta
      best = candidate
    }
  }

  return best
}

function extractImageUrls(body: MiniMaxImageResponse | null): string[] {
  const imageUrls = body?.data?.image_urls ?? []
  return imageUrls
    .map((item) => {
      if (typeof item === 'string') return item
      return typeof item?.url === 'string' ? item.url : ''
    })
    .filter((item): item is string => item.length > 0)
}

export class MiniMaxProvider extends LLMProvider {
  static readonly defaultChatModels: ChatModelOption[] = [
    { id: 'MiniMax-M2.7', displayName: 'MiniMax M2.7' },
    { id: 'MiniMax-M2.5', displayName: 'MiniMax M2.5' },
    { id: 'MiniMax-M2.1', displayName: 'MiniMax M2.1' },
    { id: 'MiniMax-M2', displayName: 'MiniMax M2' },
  ]

  private readonly apiKey: string

  get capabilities(): Set<ProviderCapability> {
    return new Set([ProviderCapability.Chat, ProviderCapability.ImageGen])
  }

  get chatModels() {
    return MiniMaxProvider.defaultChatModels
  }

  constructor(config: { apiKey: string; chatModel: string; baseUrl?: string }) {
    const key = config.apiKey.trim()
    if (!key) throw new Error('未填写 API Key')

    const baseURL = config.baseUrl?.trim() || MINIMAX_ANTHROPIC_BASE_URL

    super(
      new ChatAnthropic({
        model: config.chatModel.trim() || DEFAULT_CHAT_MODEL,
        anthropicApiKey: key,
        temperature: 0.35,
        maxRetries: 1,
        clientOptions: { baseURL },
      }),
    )

    this.apiKey = key
  }

  async generateImage(input: {
    prompt: string
    size?: string
    n?: number
  }): Promise<{ urls: string[] }> {
    const prompt = input.prompt.trim()
    if (!prompt) {
      throw new Error('请输入画面描述')
    }

    const payload = await withRetry(() =>
      withTimeout(async (signal) => {
        const response = await fetch(MINIMAX_IMAGE_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: DEFAULT_IMAGE_MODEL,
            prompt,
            aspect_ratio: mapSizeToAspectRatio(input.size),
            response_format: 'url',
            n: Math.min(4, Math.max(1, input.n ?? 1)),
          }),
          signal,
        })

        const body = (await response.json().catch(() => null)) as MiniMaxImageResponse | null
        if (!response.ok) {
          throw new Error(errMsg(body, `创建图片失败：HTTP ${response.status}`))
        }
        return body
      }, HTTP_TIMEOUT_MS),
    )

    const urls = extractImageUrls(payload)
    if (urls.length === 0) {
      throw new Error(errMsg(payload, '图片生成成功但未返回图片 URL'))
    }

    return { urls }
  }
}
