import type { MindmapSnapshot, MindmapTransaction } from './types'

const DEFAULT_MAX_SIZE = 10

/**
 * Manages the history stacks of one open mindmap file. The undo and redo stacks each
 * keep at most `maxSize` entries.
 *
 * Uses a "commands + pre-execution snapshot" model:
 * - `undo` returns the `before` snapshot of the newest transaction.
 * - `redo` only moves the transaction back to the undo stack; the caller re-runs
 *   `commands` to get a deterministic new layout.
 */
export class MindmapHistory {
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
