import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { EmbeddingsInterface } from '@langchain/core/embeddings'
import { attachMetering } from './metering.js'

export enum ProviderCapability {
  Chat = 'chat',
  Vision = 'vision',
  ImageGen = 'imageGen',
  Embeddings = 'embeddings',
}

class UnsupportedCapabilityError extends Error {
  constructor(capability: string) {
    super(`当前 provider 不支持 ${capability} 能力`)
    this.name = 'UnsupportedCapabilityError'
  }
}

export type ChatModelOption = { id: string; displayName: string; contextWindow?: number }

/** Conservative fallback window (32k tokens) for models without a declared contextWindow */
export const DEFAULT_CONTEXT_WINDOW = 32_768

export type DetectedAnchor = {
  order: number
  anchorVisual: string
  x: number
  y: number
}

export abstract class LLMProvider {
  readonly reasoningModel: BaseChatModel
  readonly visionModel: BaseChatModel | undefined
  /** Id of the current reasoning model, used to look up contextWindow in chatModels */
  protected readonly chatModelId: string

  constructor(reasoningModel: BaseChatModel, visionModel?: BaseChatModel, chatModelId?: string) {
    this.reasoningModel = reasoningModel
    this.visionModel = visionModel
    this.chatModelId = chatModelId ?? ''
    attachMetering(reasoningModel)
    if (visionModel) attachMetering(visionModel)
  }

  abstract get capabilities(): Set<ProviderCapability>

  abstract get chatModels(): ChatModelOption[]

  /** Context window (tokens) of the current reasoning model; falls back to 32k when undeclared */
  get contextWindow(): number {
    return (
      this.chatModels.find((model) => model.id === this.chatModelId)?.contextWindow ??
      DEFAULT_CONTEXT_WINDOW
    )
  }

  createEmbeddings(): EmbeddingsInterface {
    throw new UnsupportedCapabilityError('embeddings')
  }

  generateImage(_input: {
    prompt: string
    size?: string
    n?: number
  }): Promise<{ urls: string[] }> {
    void _input
    throw new UnsupportedCapabilityError('imageGen')
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
  } catch {
    /* ignore */
  }
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
