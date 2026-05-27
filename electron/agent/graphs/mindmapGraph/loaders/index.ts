export interface DocumentPage {
  text: string
  index: number
}

export interface MindmapInputSource {
  type: 'pdf' | 'url' | 'text'
  path?: string
  url?: string
  content?: string
}

export interface DocumentLoader {
  load(source: MindmapInputSource): Promise<DocumentPage[]>
  supports(type: string): boolean
}

export interface DocumentLoaderRegistry {
  getLoader(type: string): DocumentLoader | undefined
}

export class DefaultDocumentLoaderRegistry implements DocumentLoaderRegistry {
  private loaders: DocumentLoader[] = []

  register(loader: DocumentLoader): void {
    this.loaders.push(loader)
  }

  getLoader(type: string): DocumentLoader | undefined {
    return this.loaders.find(l => l.supports(type))
  }
}
