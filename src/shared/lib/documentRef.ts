import path from 'node:path'
import type { DocumentRef } from './fileFormat'

export type ResolvedDocumentRef =
  | { ok: true; displayText: string; target: string; external: boolean }
  | { ok: false; displayText: string; error: string }

export function resolveDocumentRef(doc: DocumentRef, userDataPath: string): ResolvedDocumentRef {
  switch (doc.type) {
    case 'pdf':
      return { ok: true, displayText: doc.filename, target: doc.source, external: false }
    case 'url':
      return { ok: true, displayText: doc.source, target: doc.source, external: true }
    case 'text': {
      if (!doc.textPath) {
        return { ok: false, displayText: doc.source, error: '缓存文件路径缺失' }
      }
      return {
        ok: true,
        displayText: doc.source,
        target: path.join(userDataPath, doc.textPath),
        external: false,
      }
    }
  }
}
