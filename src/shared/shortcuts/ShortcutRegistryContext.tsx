import { useEffect, useMemo, type ReactNode } from 'react'
import { createShortcutRegistry } from './ShortcutRegistry'
import { ShortcutRegistryContext } from './shortcutRegistryContext'

export function ShortcutRegistryProvider({ children }: { children: ReactNode }) {
  const registry = useMemo(() => createShortcutRegistry(), [])

  useEffect(() => registry.attachKeyboard(), [registry])

  const value = useMemo(() => ({ registry }), [registry])

  return (
    <ShortcutRegistryContext.Provider value={value}>{children}</ShortcutRegistryContext.Provider>
  )
}
