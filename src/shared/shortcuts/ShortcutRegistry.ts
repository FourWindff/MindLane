import { eventComboFromCode, isTypingTarget } from './matchKeydown'
import type { ShortcutRegistration } from './types'

type DocumentLike = Pick<Document, 'addEventListener' | 'removeEventListener'>

/**
 * 与 React 无关的快捷键注册表：可独立测试，也可在非 React 环境使用。
 * 同一 `id` 再次 register 会覆盖旧条目。
 */
export class ShortcutRegistry {
  private entries: ShortcutRegistration[] = []
  private listeners = new Set<() => void>()
  private snapshot: ShortcutRegistration[] = []
  private keyboardCleanup: (() => void) | null = null

  /** 供 `useSyncExternalStore` 订阅列表变化（帮助面板等） */
  subscribe = (onChange: () => void): (() => void) => {
    this.listeners.add(onChange)
    return () => this.listeners.delete(onChange)
  }

  /** 当前已注册列表快照（引用仅在变更时更新） */
  getSnapshot = (): readonly ShortcutRegistration[] => this.snapshot

  /**
   * 注册或覆盖快捷键，返回取消注册函数。
   */
  register = (entry: ShortcutRegistration): (() => void) => {
    this.entries = this.entries.filter((e) => e.id !== entry.id)
    this.entries.push(entry)
    this.refreshSnapshot()
    this.emit()
    return () => {
      this.entries = this.entries.filter((e) => e.id !== entry.id)
      this.refreshSnapshot()
      this.emit()
    }
  }

  /**
   * 批量注册，返回一次性全部注销函数。
   */
  registerAll = (list: ShortcutRegistration[]): (() => void) => {
    const unregisters = list.map((item) => this.register(item))
    return () => unregisters.forEach((u) => u())
  }

  /**
   * 处理一次键盘事件；若已消费返回 true（已 preventDefault/stopPropagation）。
   */
  dispatch = (e: KeyboardEvent): boolean => {
    if (e.repeat) return false
    const typing = isTypingTarget(e.target)
    const combo = eventComboFromCode(e)
    const sorted = [...this.entries].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
    for (const entry of sorted) {
      if (entry.combo !== combo) continue
      if (entry.preventWhenTyping && typing) continue
      if (entry.enabled && !entry.enabled()) continue

      const result = entry.handler(e)
      if (result === false) continue

      e.preventDefault()
      e.stopPropagation()
      return true
    }
    return false
  }

  /**
   * 在目标文档上监听 keydown（capture）。重复调用会先卸载上一处监听。
   */
  attachKeyboard = (
    target: DocumentLike = typeof document !== 'undefined'
      ? document
      : (null as unknown as DocumentLike),
  ): (() => void) => {
    this.keyboardCleanup?.()
    if (!target?.addEventListener) {
      return () => {}
    }
    const onKeyDown = (e: Event) => {
      if (e instanceof KeyboardEvent) this.dispatch(e)
    }
    target.addEventListener('keydown', onKeyDown, true)
    const off = () => target.removeEventListener('keydown', onKeyDown, true)
    this.keyboardCleanup = off
    return off
  }

  detachKeyboard = (): void => {
    this.keyboardCleanup?.()
    this.keyboardCleanup = null
  }

  private refreshSnapshot(): void {
    this.snapshot = [...this.entries]
  }

  private emit(): void {
    this.listeners.forEach((l) => l())
  }
}

export function createShortcutRegistry(): ShortcutRegistry {
  return new ShortcutRegistry()
}
