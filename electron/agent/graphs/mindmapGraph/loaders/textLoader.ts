import type { LoadedDocument, MindmapDocumentLoader, MindmapInputSource } from './types.js'

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
      chunks: [{
        id: 'chunk-1',
        index: 0,
        startPage: 0,
        endPage: 0,
        text,
      }],
    }
  }
}

export function findDocumentLoader(
  loaders: MindmapDocumentLoader[],
  source: MindmapInputSource,
): MindmapDocumentLoader | null {
  return loaders.find((loader) => loader.supports(source)) ?? null
}
