import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { attachMetering } from './metering.js'

export enum ProviderCapability {
  Chat = 'chat',
  Vision = 'vision',
  ImageGen = 'imageGen',
}

class UnsupportedCapabilityError extends Error {
  constructor(capability: string) {
    super(`当前 provider 不支持 ${capability} 能力`)
    this.name = 'UnsupportedCapabilityError'
  }
}

export type ModelOption = { id: string; displayName: string; contextWindow?: number }

/** Conservative fallback window (32k tokens) for models without a declared contextWindow */
export const DEFAULT_CONTEXT_WINDOW = 32_768

export type DetectedAnchor = {
  order: number
  anchorVisual: string
  x: number
  y: number
}

export abstract class LLMProvider {
  /**
   * Provider 目录与能力的**单一声明源**（静态）：registry 注册与实例 getter
   * 都从这里读，不再在注册处重复维护第二份 defaultModels/capabilities。
   */
  static readonly id: string = ''
  static readonly displayName: string = ''
  static readonly capabilities: readonly ProviderCapability[] = []
  static readonly defaultModels: readonly ModelOption[] = []

  /** 聊天模型：单模型档位，不区分"聊天/推理"模型（见 ADR-0014 附注） */
  readonly model: BaseChatModel
  /** 视觉模型槽位（如 DashScope 的 qwen-vl-max）；无视觉能力的 provider 为 undefined */
  readonly visionModel: BaseChatModel | undefined
  /** 当前所选模型 id，用于在 models 目录中查 contextWindow */
  protected readonly modelId: string

  constructor(model: BaseChatModel, visionModel?: BaseChatModel, modelId?: string) {
    this.model = model
    this.visionModel = visionModel
    this.modelId = modelId ?? ''
    attachMetering(model)
    if (visionModel) attachMetering(visionModel)
  }

  get capabilities(): Set<ProviderCapability> {
    return new Set((this.constructor as typeof LLMProvider).capabilities)
  }

  get models(): ModelOption[] {
    return [...(this.constructor as typeof LLMProvider).defaultModels]
  }

  /** Context window (tokens) of the current model; falls back to 32k when undeclared */
  get contextWindow(): number {
    return (
      this.models.find((model) => model.id === this.modelId)?.contextWindow ??
      DEFAULT_CONTEXT_WINDOW
    )
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
