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
