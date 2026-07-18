import type { Document } from '@langchain/core/documents'

/** Share of the model context window a batch may use; headroom covers the prompt template and model output */
const BUDGET_WINDOW_RATIO = 0.4
/** Rough conversion: ~2 chars ≈ 1 token (conservative for Chinese) */
const CHARS_PER_TOKEN = 2

/** Context budget in chars = contextWindow × 40% × 2; window fallback lives in the provider layer */
export function computeBudgetChars(contextWindow: number): number {
  return Math.floor(contextWindow * BUDGET_WINDOW_RATIO * CHARS_PER_TOKEN)
}

/**
 * Batcher (pure function): greedily packs chunks into leaf batches under the context budget.
 * A single chunk over budget gets its own batch (overflow allowed) — chunks are never split or dropped.
 */
export function batchDocuments(docs: Document[], budgetChars: number): Document[][] {
  const batches: Document[][] = []
  let current: Document[] = []
  let currentChars = 0

  for (const doc of docs) {
    const docChars = doc.pageContent.length
    if (current.length > 0 && currentChars + docChars > budgetChars) {
      batches.push(current)
      current = []
      currentChars = 0
    }
    current.push(doc)
    currentChars += docChars
  }

  if (current.length > 0) {
    batches.push(current)
  }
  return batches
}
