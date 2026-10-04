import { eventComboFromCode, isTypingTarget } from './matchKeydown'
import type { ShortcutRegistration } from './types'

/**
 * App-level shortcut registry: a module-level singleton with no React dependency (single window,
 * single React root). Registering the same `id` again replaces the old entry; the first
 * registration lazily attaches one document listener (capture).
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

/** Register or replace a shortcut, returning an unregister function. */
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

/** Handle one keyboard event; returns true if consumed (preventDefault/stopPropagation already called). */
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
  /** For `useSyncExternalStore` to subscribe to registration changes (help panel) */
  subscribe(onChange: () => void): () => void {
    listeners.add(onChange)
    return () => {
      listeners.delete(onChange)
    }
  },

  /** Snapshot of the current registrations (reference only changes on changes) */
  getSnapshot(): readonly ShortcutRegistration[] {
    return snapshot
  },

  register,

  dispatch,
}
