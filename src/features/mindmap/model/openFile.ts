import { createMindmapStore, type MindmapStore } from './store'
import { MindmapEditor } from './editor'
import type { MindLaneFile } from '@contracts/fileFormat'

/**
 * The view-side instance behind one open file: the projected store (fed by the
 * main-process document) and the editor facade that sends commands. The
 * authoritative document and its history live in the main-process document
 * service, keyed by fileUuid; the instance here lives as long as the file stays
 * open so switching the active file never rebuilds the view or the history.
 */
export class OpenFile {
  key: string
  readonly store: MindmapStore
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
    this.editor = new MindmapEditor(this.store)
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
  }

  dispose(): void {
    this.editor.cancelPendingDeletes()
    this.store.getState().dispose()
    this.aiWritingListeners.clear()
    this.aiWriting = false
  }
}
