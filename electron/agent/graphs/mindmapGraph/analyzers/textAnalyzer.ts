import { MindmapInputAnalyzer } from './types.js'
import type { LoadedDocument, MindmapInputSource } from './types.js'

const TEXT_CHUNK_CHAR_LIMIT = 4000

export class TextInputAnalyzer extends MindmapInputAnalyzer<string, string> {
  readonly type = 'text' as const

  protected resolveInput(source: MindmapInputSource): string {
    return source.content ?? ''
  }

  async load(content: string): Promise<string> {
    if (!content.trim()) {
      throw new Error('文本输入内容为空。')
    }

    return content
  }

  protected getText(raw: string): string {
    return raw
  }

  protected chunk(raw: string): LoadedDocument['chunks'] {
    return this.chunkText(raw)
  }

  private chunkText(
    text: string,
    chunkCharLimit = TEXT_CHUNK_CHAR_LIMIT,
  ): LoadedDocument['chunks'] {
    const normalizedLimit = Math.max(1000, chunkCharLimit)
    const chunks: LoadedDocument['chunks'] = []

    for (let offset = 0; offset < text.length; offset += normalizedLimit) {
      const chunk = text.slice(offset, offset + normalizedLimit)

      chunks.push({
        id: `chunk-${chunks.length + 1}`,
        index: chunks.length,
        startPage: 0,
        endPage: 0,
        text: chunk,
      })
    }

    return chunks
  }
}

export function findInputAnalyzer(
  analyzers: MindmapInputAnalyzer<unknown, unknown>[],
  source: MindmapInputSource,
): MindmapInputAnalyzer<unknown, unknown> | null {
  return analyzers.find((analyzer) => analyzer.supports(source)) ?? null
}
