import { createMindmapStore, type MindmapStore } from './store'
import { MindmapHistory } from './history'
import { MindmapEditor } from './editor'
import type { MindLaneFile } from '@contracts/fileFormat'

/**
 * The mindmap instance behind one open file, with its own store, history and editor.
 * The instance lives as long as the file stays open, so switching the active file never
 * destroys the history stack.
 */
export class OpenFile {
  key: string
  readonly store: MindmapStore
  readonly history: MindmapHistory
  readonly editor: MindmapEditor

  /**
   * "The AI is writing to this file": a transient flag owned by the open file. It never enters
   * the mindmap document model, is never persisted and does not take part in the dirty check.
   * The chat side projects writes into it (see aiWritingProjection); the mindmap side subscribes.
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
   * Writing this flag notifies only its own subscribers and never touches the mindmap store:
   * otherwise autosave would fire spuriously on every AI busy/idle toggle.
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
