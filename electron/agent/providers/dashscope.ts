import { ChatOpenAI } from '@langchain/openai'
import { setTimeout as sleep } from 'node:timers/promises'
import { LLMProvider, ProviderCapability, type ModelOption } from './base.js'
import { withRetry, withTimeout } from './middleware/index.js'

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

// Timeout for a single fetch call, so a request can never hang (HTTP 30s)
const HTTP_TIMEOUT_MS = 30_000
// Overall timeout for the whole generateImage call (including 60 polls)
const TOTAL_TIMEOUT_MS = 120_000
const POLL_INTERVAL_MS = 1500
const POLL_MAX_TIMES = 60

export class DashScopeProvider extends LLMProvider {
  static readonly id = 'dashscope'
  static readonly displayName = 'Qwen (Model Studio)'
  static readonly capabilities: ProviderCapability[] = [
    ProviderCapability.Chat,
    ProviderCapability.Vision,
    ProviderCapability.ImageGen,
  ]
  static readonly defaultModels: ModelOption[] = [
    { id: 'qwen-turbo', displayName: 'qwen-turbo', contextWindow: 1_000_000 },
    { id: 'qwen-plus', displayName: 'qwen-plus', contextWindow: 131_072 },
    { id: 'qwen-max', displayName: 'qwen-max', contextWindow: 32_768 },
    { id: 'qwen-long', displayName: 'qwen-long', contextWindow: 10_000_000 },
  ]

  private readonly apiKey: string

  constructor(config: {
    apiKey: string
    chatModel: string
    visionModel?: string
    baseUrl?: string
  }) {
    const key = config.apiKey.trim()
    if (!key) throw new Error('API Key is missing')

    const baseURL = config.baseUrl?.trim() || DASHSCOPE_COMPAT_BASE
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
      new ChatOpenAI({
        model: config.visionModel?.trim() || 'qwen-vl-max',
        apiKey: key,
        temperature: 0,
        timeout: 60_000,
        maxRetries: 1,
        configuration: { baseURL },
      }),
      chatModelId,
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
      throw new Error('Please enter an image description')
    }

    // The total timeout guards the whole flow; both the poll sleeps and the fetches can be interrupted by it.
    return withTimeout(
      async (totalSignal) => {
        const createData = await withRetry(() =>
          withTimeout(
            async (signal) => {
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
                signal: AbortSignal.any([totalSignal, signal]),
              })
              const data = (await res.json().catch(() => null)) as TaskBody | null
              if (!res.ok) {
                throw new Error(errMsg(data, `failed to create task: HTTP ${res.status}`))
              }
              return data
            },
            HTTP_TIMEOUT_MS,
            { signal: totalSignal },
          ),
        )

        const taskId = createData?.output?.task_id
        if (typeof taskId !== 'string') {
          throw new Error(errMsg(createData, 'no task_id returned'))
        }

        const taskUrl = `https://dashscope.aliyuncs.com/api/v1/tasks/${encodeURIComponent(taskId)}`
        for (let i = 0; i < POLL_MAX_TIMES; i++) {
          // Interruptible sleep (a poll interval that cannot be canceled would hang stop requests)
          await sleep(POLL_INTERVAL_MS, undefined, { signal: totalSignal })

          const pollData = await withRetry(() =>
            withTimeout(
              async (signal) => {
                const res = await fetch(taskUrl, {
                  headers: { Authorization: `Bearer ${this.apiKey}` },
                  signal: AbortSignal.any([totalSignal, signal]),
                })
                const data = (await res.json().catch(() => null)) as TaskBody | null
                if (!res.ok) {
                  throw new Error(errMsg(data, `failed to query task: HTTP ${res.status}`))
                }
                return data
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
              throw new Error('task succeeded but returned no image URL')
            }
            return { urls }
          }
          if (status === 'FAILED' || status === 'UNKNOWN' || status === 'CANCELED') {
            throw new Error(
              String(
                pollData?.output?.message ??
                  pollData?.message ??
                  pollData?.output?.code ??
                  'text-to-image failed',
              ),
            )
          }
        }

        throw new Error('text-to-image timed out, please try again later')
      },
      TOTAL_TIMEOUT_MS,
      { timeoutMessage: 'text-to-image timed out, please try again later' },
    )
  }
}
