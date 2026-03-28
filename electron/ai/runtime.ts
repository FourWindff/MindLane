import { ChatOpenAI } from '@langchain/openai'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { HumanMessage } from '@langchain/core/messages'

const DASHSCOPE_COMPAT_BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
const IMAGE_SYNTH_URL =
  'https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis'

export const DEFAULT_CHAT_MODELS = [
  { id: 'qwen-turbo', displayName: 'qwen-turbo' },
  { id: 'qwen-plus', displayName: 'qwen-plus' },
  { id: 'qwen-max', displayName: 'qwen-max' },
  { id: 'qwen-long', displayName: 'qwen-long' },
] as const

export type DetectedAnchor = {
  order: number
  anchorVisual: string
  x: number
  y: number
}

export interface AiRuntime {
  reasoningModel: BaseChatModel
  visionModel?: BaseChatModel
  generateImage(input: { prompt: string; size?: string; n?: number }): Promise<{ urls: string[] }>
  locateAnchors(input: {
    imageUrl: string
    anchors: Array<{ order: number; anchorVisual: string }>
  }): Promise<DetectedAnchor[]>
}

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

function contentToString(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === 'string') return block
        if (block && typeof block === 'object' && 'text' in block) {
          return String((block as { text?: unknown }).text ?? '')
        }
        return ''
      })
      .join('')
  }
  return ''
}

function parseJsonArray(text: string): unknown[] {
  const match = text.match(/\[[\s\S]*\]/)
  if (!match) throw new Error('未找到 JSON 数组')
  const parsed = JSON.parse(match[0]) as unknown
  if (!Array.isArray(parsed)) throw new Error('返回内容不是 JSON 数组')
  return parsed
}

function normalizeCoord(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  if (value >= 0 && value <= 1) return value
  if (value >= 0 && value <= 1000) return value / 1000
  if (value >= 0 && value <= 100) return value / 100
  return null
}

function normalizeBoxCenter(box: unknown): { x: number; y: number } | null {
  if (!Array.isArray(box) || box.length < 4) return null
  const [x1Raw, y1Raw, x2Raw, y2Raw] = box
  const x1 = normalizeCoord(x1Raw)
  const y1 = normalizeCoord(y1Raw)
  const x2 = normalizeCoord(x2Raw)
  const y2 = normalizeCoord(y2Raw)
  if (x1 == null || y1 == null || x2 == null || y2 == null) return null
  return {
    x: Math.min(1, Math.max(0, (x1 + x2) / 2)),
    y: Math.min(1, Math.max(0, (y1 + y2) / 2)),
  }
}

function normalizeDetectedAnchors(raw: unknown[], anchors: Array<{ order: number; anchorVisual: string }>): DetectedAnchor[] {
  const fallbackMap = new Map(anchors.map((anchor) => [anchor.order, anchor.anchorVisual]))
  const out: DetectedAnchor[] = []

  for (const row of raw) {
    if (!row || typeof row !== 'object') continue
    const obj = row as Record<string, unknown>
    const order = typeof obj.order === 'number' ? Math.floor(obj.order) : NaN
    if (!Number.isFinite(order) || order < 1) continue

    const directX = normalizeCoord(obj.x)
    const directY = normalizeCoord(obj.y)
    const center =
      directX != null && directY != null
        ? { x: directX, y: directY }
        : normalizeBoxCenter(obj.bbox ?? obj.box ?? obj.bounds)

    if (!center) continue

    const anchorVisual =
      (typeof obj.anchorVisual === 'string' && obj.anchorVisual.trim()) ||
      (typeof obj.anchor_visual === 'string' && obj.anchor_visual.trim()) ||
      fallbackMap.get(order) ||
      ''

    out.push({
      order,
      anchorVisual,
      x: Math.min(1, Math.max(0, center.x)),
      y: Math.min(1, Math.max(0, center.y)),
    })
  }

  return out.sort((a, b) => a.order - b.order)
}

export function createDashScopeRuntime(config: {
  apiKey: string
  chatModel: string
  visionModel?: string
  baseUrl?: string
}): AiRuntime {
  const key = config.apiKey.trim()
  if (!key) {
    throw new Error('未填写 API Key')
  }

  const baseURL = config.baseUrl?.trim() || DASHSCOPE_COMPAT_BASE
  const reasoningModel = new ChatOpenAI({
    model: config.chatModel.trim() || 'qwen-turbo',
    apiKey: key,
    temperature: 0.35,
    timeout: 60_000,
    maxRetries: 1,
    configuration: { baseURL },
  })

  const visionModel = new ChatOpenAI({
    model: config.visionModel?.trim() || 'qwen-vl-max',
    apiKey: key,
    temperature: 0,
    timeout: 60_000,
    maxRetries: 1,
    configuration: { baseURL },
  })

  return {
    reasoningModel,
    visionModel,
    async generateImage(input) {
      const prompt = input.prompt.trim()
      if (!prompt) {
        throw new Error('请输入画面描述')
      }

      const createRes = await fetch(IMAGE_SYNTH_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
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
          headers: { Authorization: `Bearer ${key}` },
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
    },
    async locateAnchors(input) {
      if (!input.imageUrl.trim()) {
        throw new Error('缺少图片 URL')
      }
      if (input.anchors.length === 0) {
        return []
      }

      const anchorList = input.anchors
        .map((anchor) => `${anchor.order}. ${anchor.anchorVisual}`)
        .join('\n')

      const prompt = [
        '你是精确的图片视觉定位助手。请仔细查看这张图片，找到每个视觉锚点对应物体的精确中心位置。',
        '',
        '定位规则：',
        '1. 找到锚点描述的物体在图中的实际位置，给出其视觉中心的 x/y 归一化坐标（0 到 1 之间的小数，精确到小数点后两位）。',
        '2. x 表示从左（0）到右（1），y 表示从上（0）到下（1）。',
        '3. 每个坐标必须定位到该物体本身的视觉中心，不要估算偏移。',
        '4. 任意两个锚点的坐标距离应不小于 0.08；如果两个物体确实紧挨，分别定位到各自物体的中心即可。',
        '5. 如果某个锚点在图中不容易精确识别，给出最合理的位置估计，不要省略。',
        '',
        '严格返回 JSON 数组，不要输出任何额外文字：',
        '[{"order":1,"anchorVisual":"...","x":0.12,"y":0.34}, ...]',
        '',
        '锚点列表：',
        anchorList,
      ].join('\n')

      const response = await visionModel.invoke([
        new HumanMessage({
          content: [
            { type: 'image_url', image_url: { url: input.imageUrl } },
            { type: 'text', text: prompt },
          ],
        }),
      ])

      const content = contentToString(response.content).trim()
      if (!content) {
        throw new Error('视觉模型未返回内容')
      }

      const parsed = parseJsonArray(content)
      return normalizeDetectedAnchors(parsed, input.anchors)
    },
  }
}

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
}

function guessMime(url: string, contentType: string | null): string {
  if (contentType) {
    const cleaned = contentType.split(';')[0]?.trim().toLowerCase()
    if (cleaned && cleaned.startsWith('image/')) return cleaned
  }
  try {
    const pathname = new URL(url).pathname.toLowerCase()
    for (const [ext, mime] of Object.entries(MIME_BY_EXT)) {
      if (pathname.endsWith(ext)) return mime
    }
  } catch { /* ignore */ }
  return 'image/png'
}

export async function urlToDataUrl(remoteUrl: string): Promise<string> {
  if (!remoteUrl.trim() || remoteUrl.startsWith('data:')) return remoteUrl

  const res = await fetch(remoteUrl)
  if (!res.ok) {
    throw new Error(`下载图片失败：HTTP ${res.status}`)
  }
  const buffer = Buffer.from(await res.arrayBuffer())
  const mime = guessMime(remoteUrl, res.headers.get('content-type'))
  return `data:${mime};base64,${buffer.toString('base64')}`
}
