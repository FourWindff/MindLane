import { eventComboFromCode, isTypingTarget } from './matchKeydown'
import type { ShortcutRegistration } from './types'

/**
 * 应用级快捷键注册表：与 React 无关的模块级单例（单窗口单 React root）。
 * 同一 `id` 再次 register 会覆盖旧条目；首次注册时懒挂一次 document 监听（capture）。
 */
const entries: ShortcutRegistration[] = []
const listeners = new Set<() => void>()
let snapshot: readonly ShortcutRegistration[] = []
let keyboardAttached = false

function refreshSnapshot(): void {
  snapshot = [...entries]
}

function emit(): void {
  listeners.forEach((listener) => listener())
}

function removeById(id: string): void {
  const index = entries.findIndex((entry) => entry.id === id)
  if (index !== -1) entries.splice(index, 1)
}

function ensureKeyboard(): void {
  if (keyboardAttached || typeof document === 'undefined') return
  keyboardAttached = true
  document.addEventListener(
    'keydown',
    (event) => {
      if (event instanceof KeyboardEvent) dispatch(event)
    },
    true,
  )
}

/** 注册或覆盖快捷键，返回取消注册函数。 */
function register(entry: ShortcutRegistration): () => void {
  ensureKeyboard()
  removeById(entry.id)
  entries.push(entry)
  refreshSnapshot()
  emit()
  return () => {
    removeById(entry.id)
    refreshSnapshot()
    emit()
  }
}

/** 处理一次键盘事件；若已消费返回 true（已 preventDefault/stopPropagation）。 */
function dispatch(e: KeyboardEvent): boolean {
  if (e.repeat) return false
  const typing = isTypingTarget(e.target)
  const combo = eventComboFromCode(e)

  for (const entry of entries) {
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

export const shortcutRegistry = {
  /** 供 `useSyncExternalStore` 订阅注册变化（帮助面板） */
  subscribe(onChange: () => void): () => void {
    listeners.add(onChange)
    return () => {
      listeners.delete(onChange)
    }
  },

  /** 当前已注册列表快照（引用仅在变更时更新） */
  getSnapshot(): readonly ShortcutRegistration[] {
    return snapshot
  },

  register,

  dispatch,
}
