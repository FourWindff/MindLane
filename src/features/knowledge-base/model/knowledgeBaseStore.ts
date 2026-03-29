import { create } from 'zustand'

export interface IndexedDoc {
  id: string
  filename: string
  filePath: string
  indexedAt: string
  chunkCount: number
}

interface IndexProgress {
  phase: 'loading' | 'splitting' | 'embedding' | 'done' | 'error'
  filename: string
  progress: number
  error?: string
}

interface KnowledgeBaseState {
  documents: IndexedDoc[]
  indexing: boolean
  currentProgress: IndexProgress | null

  setDocuments: (docs: IndexedDoc[]) => void
  addDocuments: (docs: IndexedDoc[]) => void
  removeDocument: (docId: string) => void
  setIndexing: (indexing: boolean) => void
  setProgress: (progress: IndexProgress | null) => void
}

export const useKnowledgeBaseStore = create<KnowledgeBaseState>((set) => ({
  documents: [],
  indexing: false,
  currentProgress: null,

  setDocuments: (docs) => set({ documents: docs }),
  addDocuments: (docs) =>
    set((s) => ({
      documents: [...s.documents, ...docs],
    })),
  removeDocument: (docId) =>
    set((s) => ({
      documents: s.documents.filter((d) => d.id !== docId),
    })),
  setIndexing: (indexing) => set({ indexing }),
  setProgress: (progress) => set({ currentProgress: progress }),
}))
