/**
 * Per-file undo/redo stack of the document service (ADR-0002 principle: one
 * history per open file, capped so memory stays bounded).
 *
 * After the document authority moved into the main process, this is the only
 * history stack; the renderer holds no transactions.
 */

import type {
  MindmapSnapshot,
  MindmapTransaction,
} from '../../../contracts/mindmapDocument/types.js'

const DEFAULT_MAX_SIZE = 10

export class DocumentHistory {
  private undoStack: MindmapTransaction[] = []
  private redoStack: MindmapTransaction[] = []

  constructor(private maxSize = DEFAULT_MAX_SIZE) {}

  record(transaction: MindmapTransaction): void {
    this.undoStack.push(transaction)
    if (this.undoStack.length > this.maxSize) {
      this.undoStack.shift()
    }
    this.redoStack = []
  }

  undo(): MindmapSnapshot | null {
    const transaction = this.undoStack.pop()
    if (!transaction) return null
    this.redoStack.push(transaction)
    if (this.redoStack.length > this.maxSize) {
      this.redoStack.shift()
    }
    return transaction.before
  }

  redo(): MindmapTransaction | null {
    const transaction = this.redoStack.pop()
    if (!transaction) return null
    this.undoStack.push(transaction)
    return transaction
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0
  }

  clear(): void {
    this.undoStack = []
    this.redoStack = []
  }
}
