import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import type { Document } from '@langchain/core/documents'

export const CHUNK_SIZE = 2000
export const CHUNK_OVERLAP = 0

/** Split Documents into ~2000-char chunks on semantic boundaries (paragraph → sentence); metadata is preserved */
export async function splitDocuments(
  docs: Document[],
  chunkSize: number = CHUNK_SIZE,
): Promise<Document[]> {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap: CHUNK_OVERLAP,
  })
  return splitter.splitDocuments(docs)
}
