import path from 'node:path'
import type { DocumentRef } from '../../src/shared/lib/fileFormat.js'

/** Extension (leading dot included) → document type. Also drives the open-dialog filter list. */
export const documentTypeByExtension: Record<string, DocumentRef['type']> = {
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.pptx': 'pptx',
  '.xlsx': 'xlsx',
  '.md': 'markdown',
  '.markdown': 'markdown',
}

export function detectDocumentType(filePath: string): DocumentRef['type'] | null {
  return documentTypeByExtension[path.extname(filePath).toLowerCase()] ?? null
}
