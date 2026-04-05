import { ChatOpenAI } from '@langchain/openai'
import { LLMProvider, type ChatModelOption } from './base.js'

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
    if (err && typeof err === 'object' && typeof (err as { message?: string }).message === 'string') {
      return (err as { message: string }).message
    }
    if (typeof o.code === 'string' && typeof o.message === 'string') {
      return `${o.code}: ${o.message}`
    }
  }
  return fallback
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class DashScopeProvider extends LLMProvider {
  private readonly apiKey: string

  static readonly defaultChatModels: ChatModelOption[] = [
    { id: 'qwen-turbo', displayName: 'qwen-turbo' },
    { id: 'qwen-plus', displayName: 'qwen-plus' },
    { id: 'qwen-max', displayName: 'qwen-max' },
    { id: 'qwen-long', displayName: 'qwen-long' },
  ]

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

    const createRes = await fetch(IMAGE_SYNTH_URL, {
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
    })

    const createData = (await createRes.json().catch(() => null)) as TaskBody | null
    if (!createRes.ok) {
      throw new Error(errMsg(createData, `创建任务失败 HTTP ${createRes.status}`))
    }
    const taskId = createData?.output?.task_id
    if (typeof taskId !== 'string') {
      throw new Error(errMsg(createData, '未返回 task_id'))
    }

    const taskUrl = `https://dashscope.aliyuncs.com/api/v1/tasks/${encodeURIComponent(taskId)}`
    for (let i = 0; i < 60; i++) {
      await sleep(1500)
      const pollRes = await fetch(taskUrl, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      })
      const pollData = (await pollRes.json().catch(() => null)) as TaskBody | null
      if (!pollRes.ok) {
        throw new Error(errMsg(pollData, `查询任务失败 HTTP ${pollRes.status}`))
      }
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
  }
}
