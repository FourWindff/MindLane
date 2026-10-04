import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { logger } from '../../shared/logger.js'
import { attachMetering } from './metering.js'

export enum ProviderCapability {
  Chat = 'chat',
  Vision = 'vision',
  ImageGen = 'imageGen',
}

class UnsupportedCapabilityError extends Error {
  constructor(capability: string) {
    super(`the current provider does not support the ${capability} capability`)
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
   * Single static source of truth for the provider catalog and capabilities:
   * both the registry registration and the instance getters read from here, so
   * defaultModels/capabilities are no longer duplicated at the registration site.
   */
  static readonly id: string = ''
  static readonly displayName: string = ''
  static readonly capabilities: readonly ProviderCapability[] = []
  static readonly defaultModels: readonly ModelOption[] = []

  /** Chat model: a single model slot, with no separate "chat/reasoning" models (see the ADR-0014 note) */
  readonly model: BaseChatModel
  /** Vision model slot (e.g. DashScope's qwen-vl-max); undefined for providers without vision capability */
  readonly visionModel: BaseChatModel | undefined
  /** Currently selected model id, used to look up contextWindow in the models catalog */
  protected readonly modelId: string

  constructor(model: BaseChatModel, visionModel?: BaseChatModel, modelId?: string) {
    this.model = model
    this.visionModel = visionModel
    this.modelId = modelId ?? ''
    // A model without a declared contextWindow falls back to the conservative
    // default; warn once at construction so the guess is visible in logs.
    if (this.modelId && !this.findModel(this.modelId)?.contextWindow) {
      logger
        .withContext('provider')
        .warn(
          'model %s declares no contextWindow; falling back to %d tokens',
          this.modelId,
          DEFAULT_CONTEXT_WINDOW,
        )
    }
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
    return this.findModel(this.modelId)?.contextWindow ?? DEFAULT_CONTEXT_WINDOW
  }

  private findModel(modelId: string): ModelOption | undefined {
    return this.models.find((model) => model.id === modelId)
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
    throw new Error(`failed to download image: HTTP ${res.status}`)
  }
  const buffer = Buffer.from(await res.arrayBuffer())
  const mime = guessMime(remoteUrl, res.headers.get('content-type'))
  return `data:${mime};base64,${buffer.toString('base64')}`
}
