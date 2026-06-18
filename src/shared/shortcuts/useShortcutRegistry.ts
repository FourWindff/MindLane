import { useContext } from 'react'
import type { ShortcutRegistry } from './ShortcutRegistry'
import { ShortcutRegistryContext } from './shortcutRegistryContext'

export function useShortcutRegistry(): ShortcutRegistry {
  const ctx = useContext(ShortcutRegistryContext)
  if (!ctx) {
    throw new Error('useShortcutRegistry 须在 ShortcutRegistryProvider 内使用')
  }
  return ctx.registry
}
