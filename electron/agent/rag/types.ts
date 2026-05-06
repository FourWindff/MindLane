export interface ChunkMetadata {
  docId: string
  filename: string
  source: string
  pageNumber?: number
  sectionTitle?: string
  path: string[]
  nodeId?: string
  nodeLevel?: number
  charCount: number
  indexedAt: string
}

export interface Chunk {
  id: string
  content: string
  level: number
  parentId?: string
  summary?: string
  metadata: ChunkMetadata
}

export interface ScoredChunk {
  chunk: Chunk
  score: number
  rank?: number
  source?: 'vector' | 'bm25'
}

export interface Citation {
  id: number
  source: string
  page?: number
  path?: string[]
  chunkId: string
}

export interface SearchOptions {
  topK?: number
  minScore?: number
  rerank?: boolean
}

export interface RetrievalResult {
  chunks: ScoredChunk[]
  citations: Citation[]
  context: string
}

export interface QueryRewriteResult {
  originalQuery: string
  searchQueries: string[]
}
