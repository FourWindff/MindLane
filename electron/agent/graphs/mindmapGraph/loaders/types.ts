import type { DocumentChunk, DocumentRef, MindmapInputSource } from '../../../state.js'

export type { DocumentChunk, MindmapInputSource }

export type LoadedDocument = {
  title?: string
  text: string
  chunks: DocumentChunk[]
  documentRef?: DocumentRef | null
  metadata?: Record<string, unknown>
}

export interface MindmapDocumentLoader {
  type: string
  supports(source: MindmapInputSource): boolean
  loadDocument(source: MindmapInputSource): Promise<LoadedDocument>
}

