import type { DocumentChunk, DocumentRef, MindmapInputSource } from '../../../state.js'

export type { DocumentChunk, MindmapInputSource }

export type LoadedDocument = {
  title?: string
  text: string
  chunks: DocumentChunk[]
  documentRef?: DocumentRef | null
  metadata?: Record<string, unknown>
}

export abstract class MindmapInputAnalyzer<TInput, TRaw> {
  abstract readonly type: MindmapInputSource['type']

  supports(source: MindmapInputSource): boolean {
    return source.type === this.type
  }

  async loadDocument(source: MindmapInputSource): Promise<LoadedDocument> {
    if (!this.supports(source)) {
      throw new Error(`不支持的输入类型: ${source.type}`)
    }

    const input = this.resolveInput(source)
    const raw = await this.load(input)

    return {
      text: this.getText(raw),
      chunks: this.chunk(raw),
    }
  }

  protected abstract resolveInput(source: MindmapInputSource): TInput
  abstract load(input: TInput): Promise<TRaw>
  protected abstract getText(raw: TRaw): string
  protected abstract chunk(raw: TRaw): DocumentChunk[]
}
