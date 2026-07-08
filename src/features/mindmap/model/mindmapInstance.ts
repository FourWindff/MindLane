import { createMindmapStore, type MindmapStore } from './mindmapStore'
import { MindmapHistory } from './mindmapHistory'
import { MindmapEditor } from './mindmapEditor'
import type { MindLaneFile } from '@/shared/lib/fileFormat'

/**
 * 单个打开文件对应的导图实例，包含独立的 store、history 和 editor。
 * 实例在文件打开期间保持存活，切换活动文件不会销毁历史栈。
 */
export class MindmapInstance {
  key: string
  readonly store: MindmapStore
  readonly history: MindmapHistory
  readonly editor: MindmapEditor

  constructor(key: string) {
    this.key = key
    this.store = createMindmapStore()
    this.history = new MindmapHistory()
    this.editor = new MindmapEditor(this.store, this.history)
  }

  load(filePath: string, data: MindLaneFile): void {
    this.store.getState().loadFile(filePath, data)
    this.history.clear()
  }

  newFile(title?: string): void {
    this.store.getState().newFile(title)
    this.history.clear()
  }

  dispose(): void {
    this.editor.cancelPendingDeletes()
    this.history.clear()
  }
}
