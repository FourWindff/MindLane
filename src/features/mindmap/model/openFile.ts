import { createMindmapStore, type MindmapStore } from './store'
import { MindmapHistory } from './history'
import { MindmapEditor } from './editor'
import type { MindLaneFile } from '@contracts/fileFormat'

/**
 * 单个打开文件对应的导图实例，包含独立的 store、history 和 editor。
 * 实例在文件打开期间保持存活，切换活动文件不会销毁历史栈。
 */
export class OpenFile {
  key: string
  readonly store: MindmapStore
  readonly history: MindmapHistory
  readonly editor: MindmapEditor

  /**
   * 「文件正在被 AI 写入」：打开的文件自己的瞬时状态，不进导图文档模型、
   * 不落盘、不参与脏检查。chat 侧投影写入（见 aiWritingProjection），导图侧订阅读取。
   */
  private aiWriting = false
  private aiWritingListeners = new Set<() => void>()

  constructor(key: string) {
    this.key = key
    this.store = createMindmapStore()
    this.history = new MindmapHistory()
    this.editor = new MindmapEditor(this.store, this.history)
  }

  isAiWriting(): boolean {
    return this.aiWriting
  }

  /**
   * 写这个标记只通知自己的订阅者，绝不触碰导图 store：否则自动保存会在
   * AI 忙闲切换时被误触发。
   */
  setAiWriting(value: boolean): void {
    if (this.aiWriting === value) return
    this.aiWriting = value
    for (const listener of this.aiWritingListeners) listener()
  }

  subscribeAiWriting(listener: () => void): () => void {
    this.aiWritingListeners.add(listener)
    return () => {
      this.aiWritingListeners.delete(listener)
    }
  }

  load(filePath: string, data: MindLaneFile, workspacePath: string | null): void {
    this.store.getState().loadFile(filePath, data, workspacePath)
    this.history.clear()
  }

  newFile(title?: string): void {
    this.store.getState().newFile(title)
    this.history.clear()
  }

  dispose(): void {
    this.editor.cancelPendingDeletes()
    this.history.clear()
    this.aiWritingListeners.clear()
    this.aiWriting = false
  }
}
