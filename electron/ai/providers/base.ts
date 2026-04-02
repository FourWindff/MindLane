import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { HumanMessage } from '@langchain/core/messages'

export type ChatModelOption = { id: string; displayName: string }

export type DetectedAnchor = {
  order: number
  anchorVisual: string
  x: number
  y: number
}

export abstract class LLMProvider {
  readonly reasoningModel: BaseChatModel
  readonly visionModel: BaseChatModel | undefined

  constructor(reasoningModel: BaseChatModel, visionModel?: BaseChatModel) {
    this.reasoningModel = reasoningModel
    this.visionModel = visionModel
  }

  abstract get chatModels(): ChatModelOption[]

  abstract generateImage(input: {
    prompt: string
    size?: string
    n?: number
  }): Promise<{ urls: string[] }>

  async locateAnchors(input: {
    imageUrl: string
    anchors: Array<{ order: number; anchorVisual: string }>
  }): Promise<DetectedAnchor[]> {
    if (!this.visionModel) {
      throw new Error('No vision model configured')
    }
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

    const response = await this.visionModel.invoke([
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
  }
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
