import path from 'node:path'
import type { DocumentRef } from '../../contracts/fileFormat.js'

type ResolvedDocumentRef =
  { ok: true; target: string; external: boolean } | { ok: false; error: string }

export function resolveDocumentRef(doc: DocumentRef, userDataPath: string): ResolvedDocumentRef {
  switch (doc.type) {
    case 'pdf':
    case 'docx':
    case 'pptx':
    case 'xlsx':
    case 'markdown':
      return { ok: true, target: doc.source, external: false }
    case 'url':
      return { ok: true, target: doc.source, external: true }
    case 'text': {
      if (!doc.textPath) {
        return { ok: false, error: 'Cached file path is missing' }
      }
      return {
        ok: true,
        target: path.join(userDataPath, doc.textPath),
        external: false,
      }
    }
  }
}
