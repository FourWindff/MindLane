import type { BaseChatModel } from '@langchain/core/language_models/chat_models'

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
