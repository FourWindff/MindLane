import { create } from 'zustand'
import type { DocumentRef } from '@/shared/lib/fileFormat'

interface DocumentState {
  documents: DocumentRef[]
  importProgress: number | null

  setDocuments: (docs: DocumentRef[]) => void
  addDocument: (doc: DocumentRef) => void
  setImportProgress: (progress: number | null) => void
}

export const useDocumentStore = create<DocumentState>((set) => ({
  documents: [],
  importProgress: null,

  setDocuments: (docs) => set({ documents: docs }),
  addDocument: (doc) => set((s) => ({ documents: [...s.documents, doc] })),
  setImportProgress: (progress) => set({ importProgress: progress }),
}))
