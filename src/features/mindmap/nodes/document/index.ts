import { NodeTypeDescriptor } from '../types'
import { DocumentNodeComponent } from './DocumentNodeComponent'

export type DocumentNodeData = {
  filename: string
  excerpt: string
  fullTextPath?: string
}
class DocumentDescriptor extends NodeTypeDescriptor<DocumentNodeData> {
  readonly typeId = 'document'
  readonly component = DocumentNodeComponent

  serialize(data: DocumentNodeData) {
    return {
      filename: data.filename,
      excerpt: data.excerpt,
      ...(data.fullTextPath != null && { fullTextPath: data.fullTextPath }),
    }
  }

  deserialize(raw: unknown): DocumentNodeData {
    return raw as DocumentNodeData
  }
}

export const documentDescriptor = new DocumentDescriptor()
