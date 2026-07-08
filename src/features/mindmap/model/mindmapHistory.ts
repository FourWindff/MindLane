import type { MindmapSnapshot, MindmapTransaction } from './types'

const DEFAULT_MAX_SIZE = 10

/**
 * 管理单文件导图的历史栈。撤销栈与重做栈各自最多保留 `maxSize` 条记录。
 *
 * 采用“命令 + 执行前快照”模型：
 * - `undo` 返回最新事务的 `before` 快照。
 * - `redo` 仅将事务移回撤销栈；调用方需要重新执行 `commands` 以获得确定性的新布局。
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
