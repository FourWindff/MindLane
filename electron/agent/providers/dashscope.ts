import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai'
import type { EmbeddingsInterface } from '@langchain/core/embeddings'
import { LLMProvider, ProviderCapability, type ChatModelOption } from './base.js'
import { withRetry, withTimeout, sleepWithAbort, linkSignals } from './middleware/index.js'

const DASHSCOPE_COMPAT_BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
const IMAGE_SYNTH_URL =
  'https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis'

type TaskBody = {
  output?: {
    task_id?: string
    task_status?: string
    results?: Array<{ url?: string; code?: string; message?: string }>
    code?: string
    message?: string
  }
  code?: string
  message?: string
}

function errMsg(body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const o = body as Record<string, unknown>
    if (typeof o.message === 'string') return o.message
    const err = o.error
    if (
      err &&
      typeof err === 'object' &&
      typeof (err as { message?: string }).message === 'string'
    ) {
      return (err as { message: string }).message
    }
    if (typeof o.code === 'string' && typeof o.message === 'string') {
      return `${o.code}: ${o.message}`
    }
  }
  return fallback
}

// 单次 fetch 调用的超时，避免被卡死（HTTP 30s）
const HTTP_TIMEOUT_MS = 30_000
// 整个 generateImage（包含 60 次轮询）的总超时
const TOTAL_TIMEOUT_MS = 120_000
const POLL_INTERVAL_MS = 1500
const POLL_MAX_TIMES = 60

export class DashScopeProvider extends LLMProvider {
  private readonly apiKey: string
  private readonly baseURL: string

  static readonly defaultChatModels: ChatModelOption[] = [
    { id: 'qwen-turbo', displayName: 'qwen-turbo' },
    { id: 'qwen-plus', displayName: 'qwen-plus' },
    { id: 'qwen-max', displayName: 'qwen-max' },
    { id: 'qwen-long', displayName: 'qwen-long' },
  ]

  get capabilities(): Set<ProviderCapability> {
    return new Set([
      ProviderCapability.Chat,
      ProviderCapability.Vision,
      ProviderCapability.ImageGen,
      ProviderCapability.Embeddings,
    ])
  }

  get chatModels() {
    return DashScopeProvider.defaultChatModels
  }

  constructor(config: {
    apiKey: string
    chatModel: string
    visionModel?: string
    baseUrl?: string
  }) {
    const key = config.apiKey.trim()
    if (!key) throw new Error('未填写 API Key')

    const baseURL = config.baseUrl?.trim() || DASHSCOPE_COMPAT_BASE
    super(
      new ChatOpenAI({
        model: config.chatModel.trim() || 'qwen-turbo',
        apiKey: key,
        temperature: 0.35,
        timeout: 60_000,
        maxRetries: 1,
        configuration: { baseURL },
      }),
      new ChatOpenAI({
        model: config.visionModel?.trim() || 'qwen-vl-max',
        apiKey: key,
        temperature: 0,
        timeout: 60_000,
        maxRetries: 1,
        configuration: { baseURL },
      }),
    )
    this.apiKey = key
    this.baseURL = baseURL
  }

  createEmbeddings(): EmbeddingsInterface {
    return new OpenAIEmbeddings({
      model: 'text-embedding-v3',
      apiKey: this.apiKey,
      batchSize: 10,
      configuration: { baseURL: this.baseURL },
    })
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

    // 用总超时给整个流程兜底，轮询 sleep / fetch 都可被该 signal 中断。
    return withTimeout(
      async (totalSignal) => {
        const createData = await withRetry(() =>
          withTimeout(
            async (signal) => {
              const linked = linkSignals([totalSignal, signal])
              try {
                const res = await fetch(IMAGE_SYNTH_URL, {
                  method: 'POST',
                  headers: {
                    Authorization: `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                    'X-DashScope-Async': 'enable',
                  },
                  body: JSON.stringify({
                    model: 'wanx-v1',
                    input: { prompt },
                    parameters: {
                      style: '<auto>',
                      size: input.size ?? '1024*1024',
                      n: Math.min(4, Math.max(1, input.n ?? 1)),
                    },
                  }),
                  signal: linked.signal,
                })
                const data = (await res.json().catch(() => null)) as TaskBody | null
                if (!res.ok) {
                  throw new Error(errMsg(data, `创建任务失败 HTTP ${res.status}`))
                }
                return data
              } finally {
                linked.cleanup()
              }
            },
            HTTP_TIMEOUT_MS,
            { signal: totalSignal },
          ),
        )

        const taskId = createData?.output?.task_id
        if (typeof taskId !== 'string') {
          throw new Error(errMsg(createData, '未返回 task_id'))
        }

        const taskUrl = `https://dashscope.aliyuncs.com/api/v1/tasks/${encodeURIComponent(taskId)}`
        for (let i = 0; i < POLL_MAX_TIMES; i++) {
          // 可被中断的 sleep（替代裸 setTimeout，避免轮询卡死无法取消）
          await sleepWithAbort(POLL_INTERVAL_MS, totalSignal)

          const pollData = await withRetry(() =>
            withTimeout(
              async (signal) => {
                const linked = linkSignals([totalSignal, signal])
                try {
                  const res = await fetch(taskUrl, {
                    headers: { Authorization: `Bearer ${this.apiKey}` },
                    signal: linked.signal,
                  })
                  const data = (await res.json().catch(() => null)) as TaskBody | null
                  if (!res.ok) {
                    throw new Error(errMsg(data, `查询任务失败 HTTP ${res.status}`))
                  }
                  return data
                } finally {
                  linked.cleanup()
                }
              },
              HTTP_TIMEOUT_MS,
              { signal: totalSignal },
            ),
          )

          const status = pollData?.output?.task_status
          if (status === 'SUCCEEDED') {
            const urls = (pollData?.output?.results ?? [])
              .map((item) => item?.url)
              .filter((url): url is string => typeof url === 'string' && url.length > 0)
            if (urls.length === 0) {
              throw new Error('任务成功但未返回图片 URL')
            }
            return { urls }
          }
          if (status === 'FAILED' || status === 'UNKNOWN' || status === 'CANCELED') {
            throw new Error(
              String(
                pollData?.output?.message ??
                  pollData?.message ??
                  pollData?.output?.code ??
                  '文生图失败',
              ),
            )
          }
        }

        throw new Error('文生图超时，请稍后重试')
      },
      TOTAL_TIMEOUT_MS,
      { timeoutMessage: '文生图超时，请稍后重试' },
    )
  }
}
