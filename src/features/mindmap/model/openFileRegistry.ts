import { OpenFile } from './openFile'

const DEFAULT_KEY = '__default__'

type Listener = () => void

/**
 * Manages the OpenFile of every file open in the workspace.
 * - Opening the same file twice returns the same instance.
 * - Switching the active file never releases the previous instance.
 * - Closing a file or switching workspace calls release to drop the instance.
 * - With no file open it provides a default instance so the UI always has a usable store.
 */
export class OpenFileRegistry {
  private instances = new Map<string, OpenFile>()
  // Lazily created so module init never constructs an OpenFile (a store plus
  // three collaborators) before the first file is opened.
  private defaultInstance: OpenFile | null = null
  private activeKey: string | null = null
  private listeners = new Set<Listener>()

  getOrCreate(key: string): OpenFile {
    let instance = this.instances.get(key)
    if (!instance) {
      instance = new OpenFile(key)
      this.instances.set(key, instance)
    }
    return instance
  }

  get(key: string): OpenFile | undefined {
    return this.instances.get(key)
  }

  /** Every non-default open file, in insertion order. */
  list(): OpenFile[] {
    return [...this.instances.values()]
  }

  setActive(key: string | null): void {
    this.activeKey = key
    this.emit()
  }

  getActive(): OpenFile | null {
    if (!this.activeKey) return null
    return this.instances.get(this.activeKey) ?? null
  }

  getActiveFile(): { fileUuid: string; filePath: string; fileTitle: string } | null {
    const active = this.getActive()
    if (!active) return null
    const state = active.store.getState()
    if (!state.hasDocumentOpen || !state.filePath) return null
    return {
      fileUuid: state.fileUuid,
      filePath: state.filePath,
      fileTitle: state.fileTitle,
    }
  }

  getByFileUuid(fileUuid: string): OpenFile | undefined {
    for (const instance of this.instances.values()) {
      if (instance.store.getState().fileUuid === fileUuid) return instance
    }
    return undefined
  }

  getDefault(): OpenFile {
    if (!this.defaultInstance) {
      this.defaultInstance = new OpenFile(DEFAULT_KEY)
    }
    return this.defaultInstance
  }

  release(key: string): void {
    const instance = this.instances.get(key)
    if (instance) {
      instance.dispose()
      this.instances.delete(key)
    }
    if (this.activeKey === key) {
      this.activeKey = null
    }
    this.emit()
  }

  resetDefault(): void {
    this.defaultInstance?.dispose()
    this.defaultInstance = new OpenFile(DEFAULT_KEY)
    this.emit()
  }

  renameKey(oldKey: string, newKey: string): void {
    const instance = this.instances.get(oldKey)
    if (!instance) return
    this.instances.delete(oldKey)
    this.instances.set(newKey, instance)
    instance.key = newKey
    if (this.activeKey === oldKey) {
      this.activeKey = newKey
    }
    this.emit()
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener()
    }
  }
}

export const openFileRegistry = new OpenFileRegistry()
