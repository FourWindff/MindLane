import { MindmapInstance } from './mindmapInstance'

const DEFAULT_KEY = '__default__'

type Listener = () => void

/**
 * 管理工作区中所有打开文件的 MindmapInstance。
 * - 同一文件多次打开返回同一实例。
 * - 切换活动文件不会释放之前的实例。
 * - 关闭文件或切换工作区时调用 release 释放实例。
 * - 没有任何文件打开时提供一个默认实例，保证 UI 始终有可用 store。
 */
export class MindmapRegistry {
  private instances = new Map<string, MindmapInstance>()
  private defaultInstance = new MindmapInstance(DEFAULT_KEY)
  private activeKey: string | null = null
  private listeners = new Set<Listener>()

  getOrCreate(key: string): MindmapInstance {
    let instance = this.instances.get(key)
    if (!instance) {
      instance = new MindmapInstance(key)
      this.instances.set(key, instance)
    }
    return instance
  }

  get(key: string): MindmapInstance | undefined {
    return this.instances.get(key)
  }

  setActive(key: string | null): void {
    this.activeKey = key
    this.emit()
  }

  getActive(): MindmapInstance | null {
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

  getByFileUuid(fileUuid: string): MindmapInstance | undefined {
    for (const instance of this.instances.values()) {
      if (instance.store.getState().fileUuid === fileUuid) return instance
    }
    return undefined
  }

  getDefault(): MindmapInstance {
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

  releaseAll(): void {
    for (const instance of this.instances.values()) {
      instance.dispose()
    }
    this.instances.clear()
    this.activeKey = null
    this.resetDefault()
    this.emit()
  }

  resetDefault(): void {
    this.defaultInstance.dispose()
    this.defaultInstance = new MindmapInstance(DEFAULT_KEY)
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

export const mindmapRegistry = new MindmapRegistry()
