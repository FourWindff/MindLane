import { useContext } from 'react'
import type { ShortcutRegistry } from './ShortcutRegistry'
import { ShortcutRegistryContext } from './ShortcutRegistryContext'

export function useShortcutRegistry(): ShortcutRegistry {
  const ctx = useContext(ShortcutRegistryContext)
  if (!ctx) {
    throw new Error('useShortcutRegistry 须在 ShortcutRegistryProvider 内使用')
  }
  return ctx.registry
}
