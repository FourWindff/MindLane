import { NodeTypeDescriptor } from '../types'
import { DocumentNodeComponent } from './DocumentNodeComponent'

export type DocumentNodeData = {
  filename: string
  excerpt: string
  fullTextPath?: string
  [key: string]: unknown
}
class DocumentDescriptor extends NodeTypeDescriptor<DocumentNodeData> {
  readonly typeId = 'document'
  readonly displayName = '文档'
  readonly group = 'core' as const
  readonly component = DocumentNodeComponent
  readonly userCreatable = false

  defaultData(): DocumentNodeData {
    return { filename: '', excerpt: '' }
  }

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
