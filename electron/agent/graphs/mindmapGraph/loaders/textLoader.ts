import type { LoadedDocument, MindmapDocumentLoader, MindmapInputSource } from './types.js'

const TEXT_CHUNK_CHAR_LIMIT = 4000

export class TextDocumentLoader implements MindmapDocumentLoader {
  readonly type = 'text'

  supports(source: MindmapInputSource): boolean {
    return source.type === this.type
  }

  async loadDocument(source: MindmapInputSource): Promise<LoadedDocument> {
    const text = source.content ?? ''
    if (!text.trim()) {
      throw new Error('文本输入内容为空。')
    }

    return {
      text,
      chunks: chunkText(text),
    }
  }
}

export function chunkText(text: string, chunkCharLimit = TEXT_CHUNK_CHAR_LIMIT): LoadedDocument['chunks'] {
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

export function findDocumentLoader(
  loaders: MindmapDocumentLoader[],
  source: MindmapInputSource,
): MindmapDocumentLoader | null {
  return loaders.find((loader) => loader.supports(source)) ?? null
}
